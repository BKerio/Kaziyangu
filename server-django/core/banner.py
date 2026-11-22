"""The startup banner `python manage.py serve` prints once the server is accepting connections."""
import os
import sys
from urllib.parse import urlsplit

import django

from .env import env

_LOGO = r"""
     _ _
  __| (_) __ _ _ __   __ _  ___
 / _` | |/ _` | '_ \ / _` |/ _ \
| (_| | | (_| | | | | (_| | (_) |
 \__,_|/ |\__,_|_| |_|\__, |\___/
     |__/             |___/
"""

_GREEN = '\033[38;5;35m'  # Django green
_DIM = '\033[2m'
_BOLD = '\033[1m'
_RESET = '\033[0m'


def _use_color() -> bool:
    if os.environ.get('NO_COLOR'):
        return False
    if sys.platform == 'win32':
        os.system('')  # switches the Windows console into ANSI mode
    return sys.stdout.isatty() or bool(os.environ.get('TERM'))


def _integrations() -> str:
    enabled = [
        name for name, on in (
            ('WhatsApp', env.WHATSAPP_TOKEN and env.WHATSAPP_PHONE_NUMBER_ID and env.WHATSAPP_VERIFY_TOKEN),
            ('Outlook', env.MICROSOFT_CLIENT_ID and env.MICROSOFT_TENANT_ID and env.MICROSOFT_CLIENT_VALUE and env.MICROSOFT_REDIRECT_URI),
            ('SMS', env.ADVANTA_SMS_URL and env.ADVANTA_API_KEY and env.ADVANTA_PARTNER_ID and env.ADVANTA_SHORTCODE),
            ('Email', env.SMTP_HOST and env.SMTP_PORT and env.SMTP_USER and env.SMTP_PASS),
        ) if on
    ]
    return ', '.join(enabled) if enabled else 'none configured'


def print_banner(host: str, port: int) -> None:
    color = _use_color()
    green, dim, bold, reset = (_GREEN, _DIM, _BOLD, _RESET) if color else ('', '', '', '')
    shown_host = 'localhost' if host in ('0.0.0.0', '::', '') else host
    url = f'http://{shown_host}:{port}'
    db = urlsplit(env.DATABASE_URL)

    rows = [
        ('API', url),
        ('Socket.io', f'{url}/socket.io/'),
        ('Database', f"{db.hostname or '?'}{db.path or ''}"),
        ('Mode', env.NODE_ENV),
        ('Integrations', _integrations()),
    ]
    lines = [f'{green}{_LOGO.rstrip()}{reset}', '',
             f'  {bold}Org Task Management API{reset} {dim}is running - Django {django.get_version()}{reset}', '']
    lines += [f'  {dim}{label:<13}{reset}{value}' for label, value in rows]
    lines += ['', f'  {dim}Press Ctrl+C to stop{reset}', '']
    print('\n'.join(lines), flush=True)
