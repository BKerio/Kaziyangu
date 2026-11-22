"""
Thin wrapper over the Microsoft identity platform's OAuth2 authorization code
flow (v2.0) plus the few Graph calls the app needs. Every method returns None
(and logs) on failure instead of raising.
"""
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from core.env import EnvConfig
from core.logger import logger

from .microsoft_config import require_microsoft_auth_env

# openid+profile+email for the id token; offline_access for a refresh token;
# User.Read/Mail.Read/Calendars.Read for Graph's /me, /me/messages, /me/events.
SCOPES = ' '.join(['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'])
_TIMEOUT = httpx.Timeout(30.0)


@dataclass
class MicrosoftTokens:
    access_token: str
    refresh_token: str | None  # None = keep the one you already have
    scope: str


class MicrosoftOAuthService:
    def __init__(self, config: EnvConfig) -> None:
        self.creds = require_microsoft_auth_env(config)

    def _auth_base(self) -> str:
        return f'https://login.microsoftonline.com/{self.creds.tenant_id}/oauth2/v2.0'

    def build_authorization_url(self, state: str) -> str:
        params = {
            'client_id': self.creds.client_id,
            'response_type': 'code',
            'redirect_uri': self.creds.redirect_uri,
            'response_mode': 'query',
            'scope': SCOPES,
            'state': state,
        }
        return f'{self._auth_base()}/authorize?{urlencode(params)}'

    def _request_token(self, grant: dict) -> MicrosoftTokens | None:
        try:
            res = httpx.post(
                f'{self._auth_base()}/token',
                data={'client_id': self.creds.client_id, 'client_secret': self.creds.client_secret, 'scope': SCOPES, **grant},
                timeout=_TIMEOUT,
            )
            if res.is_error:
                logger.error('Microsoft token request failed', status=res.status_code, body=res.text)
                return None
            data = res.json()
            return MicrosoftTokens(
                access_token=data['access_token'],
                refresh_token=data.get('refresh_token'),
                scope=data.get('scope') or SCOPES,
            )
        except Exception as err:  # noqa: BLE001
            logger.error('Microsoft token request errored', err)
            return None

    def exchange_code_for_tokens(self, code: str) -> MicrosoftTokens | None:
        return self._request_token({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': self.creds.redirect_uri})

    def refresh_access_token(self, refresh_token: str) -> MicrosoftTokens | None:
        return self._request_token({'grant_type': 'refresh_token', 'refresh_token': refresh_token})

    def fetch_profile(self, access_token: str) -> dict | None:
        try:
            res = httpx.get('https://graph.microsoft.com/v1.0/me',
                            headers={'Authorization': f'Bearer {access_token}'}, timeout=_TIMEOUT)
            if res.is_error:
                logger.error('Microsoft profile lookup failed', status=res.status_code)
                return None
            data = res.json()
            email = data.get('mail') or data.get('userPrincipalName')
            if not email:
                return None
            return {'email': email, 'name': data.get('displayName') or email}
        except Exception as err:  # noqa: BLE001
            logger.error('Microsoft profile lookup errored', err)
            return None

    def fetch_calendar_events(self, access_token: str, from_iso: str, to_iso: str) -> list[dict] | None:
        """Events between two ISO instants, start/end normalized to UTC."""
        try:
            params = {
                'startDateTime': from_iso,
                'endDateTime': to_iso,
                '$orderby': 'start/dateTime',
                # No pagination follow-up, so a low cap would silently drop the
                # later end of the window on a busy calendar.
                '$top': '250',
            }
            res = httpx.get(
                'https://graph.microsoft.com/v1.0/me/calendarView',
                params=params,
                headers={'Authorization': f'Bearer {access_token}', 'Prefer': 'outlook.timezone="UTC"'},
                timeout=_TIMEOUT,
            )
            if res.is_error:
                logger.error('Microsoft calendar lookup failed', status=res.status_code)
                return None
            events = []
            for e in res.json().get('value', []):
                events.append({
                    'id': e['id'],
                    'subject': e.get('subject') or '(No subject)',
                    # Graph's UTC preference returns timestamps without an offset - they're already UTC.
                    'start': f"{e['start']['dateTime']}Z",
                    'end': f"{e['end']['dateTime']}Z",
                    'isAllDay': e.get('isAllDay', False),
                    'location': (e.get('location') or {}).get('displayName') or None,
                    'webLink': e.get('webLink'),
                })
            return events
        except Exception as err:  # noqa: BLE001
            logger.error('Microsoft calendar lookup errored', err)
            return None

    def fetch_unread_count(self, access_token: str) -> int | None:
        """Unread count in the signed-in user's own inbox (same Mail.Read scope - never another mailbox)."""
        try:
            res = httpx.get(
                'https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=_TIMEOUT,
            )
            if res.is_error:
                logger.error('Microsoft unread-mail lookup failed', status=res.status_code)
                return None
            return res.json().get('unreadItemCount') or 0
        except Exception as err:  # noqa: BLE001
            logger.error('Microsoft unread-mail lookup errored', err)
            return None
