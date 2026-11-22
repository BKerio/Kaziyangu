"""
Admin broadcasts to staff over WhatsApp and SMS. Sending runs after the
request returns; the page polls GET /campaigns/:id for progress.
"""
import queue
import re
import threading

from django.db import close_old_connections, connection, transaction
from django.db.models import Q

from core.background import run_in_background
from core.dates import utcnow
from core.db import update_row
from core.env import env
from core.errors import BadRequestError, NotFoundError
from core.http import meta
from core.logger import logger
from core.serialize import pick, to_dict
from modules.audit import service as audit
from modules.auth.models import User
from modules.reminders.config import is_sms_enabled
from modules.reminders.sms_client import AdvantaSmsClient
from modules.whatsapp.client import WhatsAppClient
from modules.whatsapp.config import is_whatsapp_enabled
from modules.whatsapp.user_lookup import to_whatsapp_number

from .models import Campaign, CampaignRecipient

# WhatsApp's template body tops out at 1024 characters including the fixed
# text around the parameters, so the message itself is capped well under it.
MAX_MESSAGE_LENGTH = 700
MAX_TITLE_LENGTH = 60

# WhatsApp campaigns send a short utility "you have a notice" template (body
# params {{1}} first name, {{2}} notice title, plus a "View Notice"
# quick-reply). The full message is sent only when the person taps the
# button, as an ordinary reply - so the template keeps Utility pricing.
NOTICE_TEMPLATE = 'staff_notice'
NOTICE_TEMPLATE_LANGUAGE = 'en'
NOTICE_PAYLOAD_PREFIX = 'notice_'

# Sends run a few at a time - fast for a staff-sized list, gentle on the gateways.
SEND_CONCURRENCY = 4

_whatsapp = WhatsAppClient(env) if is_whatsapp_enabled(env) else None
_sms = AdvantaSmsClient(env) if is_sms_enabled(env) else None


def _has_phone(phone: str | None) -> bool:
    return len(re.sub(r'\D', '', phone or '')) >= 9


def _first_name(name: str) -> str:
    return name.split(' ')[0] or name


def _personalise(text: str, name: str) -> str:
    """Fills {name} with the recipient's first name."""
    first = _first_name(name)
    return re.sub(r'\{name\}', lambda _: first, text, flags=re.IGNORECASE)


def notice_text(title: str, message: str, name: str) -> str:
    """The full notice as shown in the chat."""
    return (f'*{title}*\n\nHello {_first_name(name)},\n\n{_personalise(message, name)}\n\n'
            '_Sent by Millenium Solutions management_')


def available_channels() -> list[str]:
    return (['WHATSAPP'] if _whatsapp else []) + (['SMS'] if _sms else [])


def list_people() -> list[dict]:
    """Everyone who can be chosen as a recipient, for the people picker."""
    users = User.objects.filter(is_active=True).order_by('name')
    return [{**pick(u, 'id', 'name', 'role', 'department'), 'hasPhone': _has_phone(u.phone)} for u in users]


def _resolve_audience(audience: dict) -> list[User]:
    """The active users an audience resolves to."""
    qs = User.objects.filter(is_active=True).order_by('name')
    if audience['everyone']:
        return list(qs)

    roles, departments, user_ids = audience['roles'], audience['departments'], audience['userIds']
    clauses = []
    if roles or departments:
        clause = Q()
        if roles:
            clause &= Q(role__in=roles)
        if departments:
            clause &= Q(department__in=departments)
        clauses.append(clause)
    if user_ids:
        clauses.append(Q(id__in=user_ids))
    if not clauses:
        return []

    combined = clauses[0]
    for clause in clauses[1:]:
        combined |= clause
    return list(qs.filter(combined))


def preview_audience(audience: dict) -> dict:
    people = _resolve_audience(audience)
    reachable = [p for p in people if _has_phone(p.phone)]
    return {
        'count': len(people),
        'reachable': len(reachable),
        'missingPhone': [p.name for p in people if not _has_phone(p.phone)],
        'sample': [p.name for p in people[:8]],
    }


def create(actor_id: str, data: dict) -> dict:
    title, message = data['title'].strip(), data['message'].strip()
    if not title:
        raise BadRequestError('Add a title')
    if not message:
        raise BadRequestError('Write a message')
    if len(title) > MAX_TITLE_LENGTH:
        raise BadRequestError(f'Keep the title under {MAX_TITLE_LENGTH} characters')
    if len(message) > MAX_MESSAGE_LENGTH:
        raise BadRequestError(f'Keep the message under {MAX_MESSAGE_LENGTH} characters')

    available = available_channels()
    channels = list(dict.fromkeys(data['channels']))
    if not channels:
        raise BadRequestError('Choose at least one channel')
    unavailable = [c for c in channels if c not in available]
    if unavailable:
        raise BadRequestError(f"{', '.join(unavailable)} is not configured on the server")

    people = _resolve_audience(data['audience'])
    if not people:
        raise BadRequestError('No one matches the chosen audience')

    with transaction.atomic():
        campaign = Campaign.objects.create(
            title=title, message=message, channels=channels, audience=data['audience'],
            recipient_count=len(people), created_by_id=actor_id,
        )
        CampaignRecipient.objects.bulk_create([
            CampaignRecipient(
                campaign_id=campaign.id, user_id=p.id, name=p.name, channel=channel,
                **({} if _has_phone(p.phone) else {'status': 'FAILED', 'error': 'No phone number on profile'}),
            )
            for p in people for channel in channels
        ])

    noun = 'person' if len(people) == 1 else 'people'
    audit.record(actor_id, 'CREATE', 'CAMPAIGN', campaign.id,
                 summary=f"Sent campaign \"{title}\" to {len(people)} {noun} via {' and '.join(channels)}",
                 new_values={'title': title, 'channels': channels, 'audience': data['audience'], 'recipientCount': len(people)})

    phones = {p.id: (p.name, p.phone) for p in people}
    run_in_background(lambda: _deliver(campaign.id, title, message, phones), name=f'campaign-{campaign.id}')
    return to_dict(campaign)


def _send_one(job: CampaignRecipient, title: str, message: str, person: tuple[str, str | None] | None) -> None:
    ok, error = False, None
    try:
        name, phone = person if person else (None, None)
        if not phone:
            error = 'No phone number on profile'
        elif job.channel == 'WHATSAPP' and _whatsapp:
            to = to_whatsapp_number(phone)
            ok = _whatsapp.send_template(to, NOTICE_TEMPLATE, NOTICE_TEMPLATE_LANGUAGE, [_first_name(name), title],
                                         max_param_length=MAX_TITLE_LENGTH,
                                         quick_reply_payloads=[f'{NOTICE_PAYLOAD_PREFIX}{job.id}'])
            # Until the template is approved, the full message still reaches
            # anyone who has messaged the bot in the last 24 hours.
            if not ok:
                ok = _whatsapp.send_message(to, {'type': 'text', 'text': notice_text(title, message, name)})
            if not ok:
                error = 'WhatsApp rejected the message (template not approved yet, or outside the 24-hour window)'
        elif job.channel == 'SMS' and _sms:
            ok = _sms.send_sms(to_whatsapp_number(phone), f'{title}: {_personalise(message, name)}')
            if not ok:
                error = 'SMS gateway rejected the message'
        else:
            error = f'{job.channel} is not configured'
    except Exception as err:  # noqa: BLE001
        error = str(err) or 'Send failed'

    update_row(CampaignRecipient, job.id, status='SENT' if ok else 'FAILED',
               error=None if ok else error, sent_at=utcnow() if ok else None)


def _deliver(campaign_id: str, title: str, message: str, people: dict[str, tuple[str, str | None]]) -> None:
    jobs: queue.Queue = queue.Queue()
    for job in CampaignRecipient.objects.filter(campaign_id=campaign_id, status='PENDING'):
        jobs.put(job)

    def worker() -> None:
        close_old_connections()
        try:
            while True:
                try:
                    job = jobs.get_nowait()
                except queue.Empty:
                    return
                try:
                    _send_one(job, title, message, people.get(job.user_id))
                except Exception as err:  # noqa: BLE001
                    logger.error('Campaign recipient send crashed', err, campaignId=campaign_id)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(SEND_CONCURRENCY)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    sent = CampaignRecipient.objects.filter(campaign_id=campaign_id, status='SENT').count()
    failed = CampaignRecipient.objects.filter(campaign_id=campaign_id, status='FAILED').count()
    status = 'SENT' if failed == 0 else ('FAILED' if sent == 0 else 'PARTIAL')
    update_row(Campaign, campaign_id, sent_count=sent, failed_count=failed, status=status, completed_at=utcnow())


def open_notice(recipient_id: str, user_id: str) -> dict | None:
    """"View Notice" tapped: the full message, provided it really was sent to this user. Marks it read once."""
    recipient = CampaignRecipient.objects.select_related('campaign').filter(id=recipient_id).first()
    if recipient is None or recipient.user_id != user_id:
        return None
    if recipient.read_at is None:
        update_row(CampaignRecipient, recipient_id, read_at=utcnow())
    return {'title': recipient.campaign.title, 'message': recipient.campaign.message}


def _serialize(campaign: Campaign) -> dict:
    return {**to_dict(campaign), 'createdBy': pick(campaign.created_by, 'id', 'name')}


def list_campaigns(page: int, limit: int) -> dict:
    qs = Campaign.objects.select_related('created_by').order_by('-created_at')
    skip = (page - 1) * limit
    rows = list(qs[skip:skip + limit])
    total = Campaign.objects.count()
    return {'data': [_serialize(c) for c in rows], 'meta': meta(total, page, limit)}


def get(campaign_id: str) -> dict:
    campaign = Campaign.objects.select_related('created_by').filter(id=campaign_id).first()
    if campaign is None:
        raise NotFoundError('Campaign')
    recipients = [to_dict(r) for r in campaign.recipients.order_by('status', 'name')]
    data = {**_serialize(campaign), 'recipients': recipients}
    # Live counts while it's still sending.
    if campaign.status == 'SENDING':
        data['sentCount'] = sum(1 for r in recipients if r['status'] == 'SENT')
        data['failedCount'] = sum(1 for r in recipients if r['status'] == 'FAILED')
    return data
