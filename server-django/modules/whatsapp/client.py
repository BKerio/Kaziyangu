"""
Thin wrapper over the Meta WhatsApp Cloud API.

Outgoing messages are plain dicts:
    {'type': 'text', 'text': ...}
    {'type': 'buttons', 'text': ..., 'buttons': [{'id', 'title'}], 'header'?: ..., 'footer'?: ...}
    {'type': 'list', 'text': ..., 'buttonLabel': ..., 'rows': [...] | 'sections': [...], 'header'?, 'footer'?}

A rejected send returns False (and is logged); a network failure raises, the
same as `fetch` rejecting in the Node client.
"""
import re

import httpx

from core.env import EnvConfig
from core.logger import logger

from .config import require_whatsapp_env

GRAPH_API_VERSION = 'v20.0'

# Cloud API field limits - anything longer is rejected outright, so every
# outgoing field is trimmed to fit rather than risking a silently lost reply.
LIMITS = {
    'text': 4096, 'body': 1024, 'header': 60, 'footer': 60, 'buttonTitle': 20,
    'listButton': 20, 'sectionTitle': 24, 'rowTitle': 24, 'rowDescription': 72,
}

_BSUID_RE = re.compile(r'^[A-Z]{2}\.[A-Za-z0-9]{1,128}$')
_TIMEOUT = httpx.Timeout(30.0)


def fit(text: str, limit: int) -> str:
    return text if len(text) <= limit else f'{text[:limit - 1]}…'


def is_business_scoped_user_id(value: str | None) -> bool:
    """A business-scoped user id: country code, a dot, then letters/digits - e.g. "KE.13491208655302741918"."""
    return bool(value) and bool(_BSUID_RE.match(value))


class WhatsAppClient:
    def __init__(self, config: EnvConfig) -> None:
        self.creds = require_whatsapp_env(config)

    def _api_base(self) -> str:
        return f'https://graph.facebook.com/{GRAPH_API_VERSION}/{self.creds.phone_number_id}'

    def _post(self, body: dict) -> bool:
        res = httpx.post(
            f'{self._api_base()}/messages',
            json=body,
            headers={'Authorization': f'Bearer {self.creds.token}'},
            timeout=_TIMEOUT,
        )
        if res.is_error:
            logger.error('WhatsApp API error', status=res.status_code, body=res.text)
        return res.is_success

    @staticmethod
    def _address(to: str) -> dict:
        # A sender who hides their number behind a username is addressed by
        # their business-scoped user id via `recipient`, with `to` left out.
        return {'recipient': to} if is_business_scoped_user_id(to) else {'to': to}

    def send_message(self, to: str, message: dict) -> bool:
        return self._post({'messaging_product': 'whatsapp', **self._address(to), **build_payload(message)})

    def send_template(self, to: str, name: str, language: str, body_params: list[str],
                      max_param_length: int = 200, quick_reply_payloads: list[str] | None = None) -> bool:
        """
        An approved message template - the only kind WhatsApp delivers outside
        the 24-hour window after someone last wrote to us. Body parameters
        can't contain newlines or tabs, so they're flattened.
        """
        components = [{
            'type': 'body',
            'parameters': [{'type': 'text', 'text': fit(re.sub(r'\s+', ' ', p).strip(), max_param_length)} for p in body_params],
        }]
        # A quick-reply button can carry a hidden payload that comes back when tapped.
        for index, payload in enumerate(quick_reply_payloads or []):
            components.append({
                'type': 'button', 'sub_type': 'quick_reply', 'index': str(index),
                'parameters': [{'type': 'payload', 'payload': payload}],
            })
        return self._post({
            'messaging_product': 'whatsapp',
            **self._address(to),
            'type': 'template',
            'template': {'name': name, 'language': {'code': language}, 'components': components},
        })

    def mark_as_read(self, message_id: str) -> None:
        try:
            self._post({'messaging_product': 'whatsapp', 'status': 'read', 'message_id': message_id})
        except Exception:  # noqa: BLE001 - read receipts are non-critical
            pass

    def download_media(self, media_id: str) -> tuple[bytes, str] | None:
        """
        Two-step Graph download: look up the media's short-lived URL by id,
        then fetch the bytes - both with the bearer token. None (logged) on failure.
        """
        headers = {'Authorization': f'Bearer {self.creds.token}'}
        try:
            meta_res = httpx.get(f'https://graph.facebook.com/{GRAPH_API_VERSION}/{media_id}', headers=headers, timeout=_TIMEOUT)
            if meta_res.is_error:
                logger.error('WhatsApp media lookup failed', status=meta_res.status_code, mediaId=media_id)
                return None
            meta = meta_res.json()
            file_res = httpx.get(meta['url'], headers=headers, timeout=_TIMEOUT, follow_redirects=True)
            if file_res.is_error:
                logger.error('WhatsApp media download failed', status=file_res.status_code, mediaId=media_id)
                return None
            return file_res.content, meta.get('mime_type') or ''
        except Exception as err:  # noqa: BLE001
            logger.error('WhatsApp media download errored', err, mediaId=media_id)
            return None


def _chrome(message: dict) -> dict:
    out = {}
    if message.get('header'):
        out['header'] = {'type': 'text', 'text': fit(message['header'], LIMITS['header'])}
    if message.get('footer'):
        out['footer'] = {'text': fit(message['footer'], LIMITS['footer'])}
    return out


def build_payload(message: dict) -> dict:
    if message['type'] == 'text':
        return {'type': 'text', 'text': {'body': fit(message['text'], LIMITS['text'])}}

    if message['type'] == 'buttons':
        return {
            'type': 'interactive',
            'interactive': {
                'type': 'button',
                **_chrome(message),
                'body': {'text': fit(message['text'], LIMITS['body'])},
                'action': {
                    # The API allows at most three reply buttons.
                    'buttons': [
                        {'type': 'reply', 'reply': {'id': b['id'], 'title': fit(b['title'], LIMITS['buttonTitle'])}}
                        for b in message['buttons'][:3]
                    ],
                },
            },
        }

    sections = message.get('sections') or [{'title': 'Options', 'rows': message.get('rows', [])}]
    return {
        'type': 'interactive',
        'interactive': {
            'type': 'list',
            **_chrome(message),
            'body': {'text': fit(message['text'], LIMITS['body'])},
            'action': {
                'button': fit(message['buttonLabel'], LIMITS['listButton']),
                'sections': [
                    {
                        'title': fit(section['title'], LIMITS['sectionTitle']),
                        'rows': [
                            {
                                'id': row['id'],
                                'title': fit(row['title'], LIMITS['rowTitle']),
                                **({'description': fit(row['description'], LIMITS['rowDescription'])} if row.get('description') else {}),
                            }
                            for row in section['rows']
                        ],
                    }
                    for section in sections
                ],
            },
        },
    }
