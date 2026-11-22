"""
Read-only overview of the WhatsApp Business setup for the Settings page: the
phone number, business account, access token health, templates, messaging
limit and recent usage. The token never leaves the server - only a hint.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx

from core.dates import iso, utcnow
from core.env import env
from modules.campaigns.models import CampaignRecipient
from modules.reminders.models import TaskReminderLog

GRAPH = 'https://graph.facebook.com/v25.0'
# Meta's figures change slowly; caching keeps the page snappy and under rate limits.
CACHE_SECONDS = 60

# Unique people the business may start conversations with per rolling 24h.
TIER_LIMITS = {
    'TIER_50': 50, 'TIER_250': 250, 'TIER_1K': 1_000, 'TIER_10K': 10_000, 'TIER_100K': 100_000, 'TIER_UNLIMITED': None,
}


def _graph(path: str, token: str, params: dict | None = None) -> dict:
    """An error becomes `{ error }` rather than failing the whole overview."""
    try:
        res = httpx.get(f'{GRAPH}/{path}', params=params or {}, headers={'Authorization': f'Bearer {token}'}, timeout=30)
        try:
            body = res.json()
        except ValueError:
            body = {}
        if res.is_success:
            return body if isinstance(body, dict) else {}
        message = ((body or {}).get('error') or {}).get('message') if isinstance(body, dict) else None
        return {'error': message or f'HTTP {res.status_code}'}
    except Exception as err:  # noqa: BLE001
        return {'error': str(err) or 'Request failed'}


class WhatsAppStatusService:
    def __init__(self) -> None:
        self._cache: tuple[float, dict] | None = None
        self._lock = threading.Lock()

    def overview(self, refresh: bool = False) -> dict:
        with self._lock:
            if not refresh and self._cache and time.monotonic() - self._cache[0] < CACHE_SECONDS:
                return self._cache[1]

        token, phone_id, waba_id = env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_BUSINESS_ACCOUNT_ID
        configured = {
            'token': bool(token),
            'phoneNumberId': phone_id,
            'businessAccountId': waba_id,
            'tokenHint': f'…{token[-6:]}' if token else None,
        }
        if not token or not phone_id:
            return {'configured': configured, 'error': 'WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set in the server .env'}

        now = int(time.time())
        month_ago = now - 30 * 86_400

        with ThreadPoolExecutor(max_workers=5) as pool:
            phone_f = pool.submit(_graph, phone_id, token, {
                'fields': 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,name_status,'
                          'status,code_verification_status,platform_type',
            })
            waba_f = pool.submit(_graph, waba_id, token, {
                'fields': 'name,account_review_status,business_verification_status,currency,ownership_type',
            }) if waba_id else None
            token_f = pool.submit(_graph, 'debug_token', token, {'input_token': token})
            templates_f = pool.submit(_graph, f'{waba_id}/message_templates', token, {
                'fields': 'name,status,category,language', 'limit': '50',
            }) if waba_id else None
            analytics_f = pool.submit(_graph, waba_id, token, {
                'fields': f'analytics.start({month_ago}).end({now}).granularity(DAY)',
            }) if waba_id else None

            phone = phone_f.result()
            waba = waba_f.result() if waba_f else {'error': 'WHATSAPP_BUSINESS_ACCOUNT_ID is not set'}
            token_info = token_f.result()
            templates = templates_f.result() if templates_f else {'data': []}
            analytics = analytics_f.result() if analytics_f else {}

        tier = phone.get('messaging_limit_tier') if isinstance(phone.get('messaging_limit_tier'), str) else None
        limit = TIER_LIMITS.get(tier) if tier in TIER_LIMITS else None
        used = self._business_initiated_last_24h()

        points = ((analytics.get('analytics') or {}).get('data_points')) or []
        sent_30d = sum(_number(p.get('sent')) for p in points)
        delivered_30d = sum(_number(p.get('delivered')) for p in points)

        td = token_info.get('data') or {}
        expires = td.get('expires_at')
        data = {
            'configured': configured,
            'fetchedAt': iso(utcnow()),
            'phone': {'error': phone['error']} if phone.get('error') else {
                'number': phone.get('display_phone_number'),
                'verifiedName': phone.get('verified_name'),
                'status': phone.get('status'),
                'qualityRating': phone.get('quality_rating'),
                'nameStatus': phone.get('name_status'),
                'verification': phone.get('code_verification_status'),
                'platform': phone.get('platform_type'),
                'throughput': (phone.get('throughput') or {}).get('level'),
            },
            'businessAccount': {'error': waba['error']} if waba.get('error') else {
                'id': waba_id,
                'name': waba.get('name'),
                'reviewStatus': waba.get('account_review_status'),
                'businessVerification': waba.get('business_verification_status'),
                'currency': waba.get('currency'),
            },
            'token': {'error': token_info['error']} if token_info.get('error') else {
                'valid': bool(td.get('is_valid')),
                'type': td.get('type'),
                'app': td.get('application'),
                'expiresAt': iso(datetime.fromtimestamp(expires, timezone.utc)) if expires else None,
                'scopes': [s for s in (td.get('scopes') or []) if s.startswith('whatsapp')],
            },
            'messaging': {
                'tier': tier,
                'limit': limit,
                'usedLast24h': used,
                'remaining': None if limit is None else max(0, limit - used),
                'sent30d': sent_30d if points else None,
                'delivered30d': delivered_30d if points else None,
            },
            'templates': {'error': templates['error']} if templates.get('error') else [
                {'name': t.get('name'), 'status': t.get('status'), 'category': t.get('category'), 'language': t.get('language')}
                for t in (templates.get('data') or [])
            ],
        }

        with self._lock:
            self._cache = (time.monotonic(), data)
        return data

    @staticmethod
    def _business_initiated_last_24h() -> int:
        """
        Unique people this system messaged first (reminders and campaign
        notices) in the last 24 h - what counts against Meta's messaging limit.
        """
        since = utcnow() - timedelta(hours=24)
        reminder_users = TaskReminderLog.objects.filter(channel='WHATSAPP', status='SENT', sent_at__gte=since) \
            .values_list('reminder__user_id', flat=True)
        campaign_users = CampaignRecipient.objects.filter(channel='WHATSAPP', status='SENT', sent_at__gte=since) \
            .values_list('user_id', flat=True)
        return len(set(reminder_users) | set(campaign_users))


def _number(value) -> float:
    try:
        return float(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0
