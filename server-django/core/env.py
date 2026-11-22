"""
Environment variable loading & validation (backend/src/lib/env.ts).

Runs once at import time, applies defaults, and raises with a clear message if
a required variable is missing - so the app refuses to start rather than fail
confusingly later. Same variable names as the Node backend.
"""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

REQUIRED = ('DATABASE_URL', 'JWT_SECRET')


def _optional(name: str) -> str | None:
    value = (os.environ.get(name) or '').strip()
    return value or None


@dataclass(frozen=True)
class EnvConfig:
    PORT: str
    HOST: str
    NODE_ENV: str
    LOG_LEVEL: str
    CORS_ORIGIN: str
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_EXPIRES_IN: str
    # Django-only extras (all optional).
    SECRET_KEY: str | None
    ALLOWED_HOSTS: list[str]
    UPLOADS_DIR: str | None
    # WhatsApp bot (Meta Cloud API) - the bot stays disabled until the first
    # three are set; see modules/whatsapp/config.py.
    WHATSAPP_TOKEN: str | None
    WHATSAPP_PHONE_NUMBER_ID: str | None
    WHATSAPP_VERIFY_TOKEN: str | None
    # Only needed for the Settings page's account/usage overview.
    WHATSAPP_BUSINESS_ACCOUNT_ID: str | None
    # "Login with Outlook" - disabled until all four are set.
    MICROSOFT_CLIENT_ID: str | None
    MICROSOFT_TENANT_ID: str | None
    MICROSOFT_CLIENT_VALUE: str | None
    MICROSOFT_REDIRECT_URI: str | None
    # Task reminders - SMS (Advanta), opt-in.
    ADVANTA_SMS_URL: str | None
    ADVANTA_API_KEY: str | None
    ADVANTA_PARTNER_ID: str | None
    ADVANTA_SHORTCODE: str | None
    # Task reminders - Email (SMTP), opt-in.
    SMTP_HOST: str | None
    SMTP_PORT: str | None
    SMTP_USER: str | None
    SMTP_PASS: str | None
    SMTP_FROM: str | None


def load_env() -> EnvConfig:
    missing = [key for key in REQUIRED if not os.environ.get(key)]
    if missing:
        raise RuntimeError(f"Missing required environment variable(s): {', '.join(missing)}")

    jwt_secret = os.environ['JWT_SECRET']
    if len(jwt_secret) < 16:
        raise RuntimeError('JWT_SECRET must be at least 16 characters long')

    node_env = os.environ.get('NODE_ENV') or 'development'
    if node_env not in ('development', 'production', 'test'):
        raise RuntimeError(f'NODE_ENV must be one of development|production|test, got "{node_env}"')

    allowed_hosts = [h.strip() for h in (os.environ.get('ALLOWED_HOSTS') or '*').split(',') if h.strip()]

    return EnvConfig(
        PORT=os.environ.get('PORT') or '3000',
        HOST=os.environ.get('HOST') or '0.0.0.0',
        NODE_ENV=node_env,
        LOG_LEVEL=os.environ.get('LOG_LEVEL') or 'info',
        CORS_ORIGIN=os.environ.get('CORS_ORIGIN') or '*',
        DATABASE_URL=os.environ['DATABASE_URL'],
        JWT_SECRET=jwt_secret,
        JWT_EXPIRES_IN=os.environ.get('JWT_EXPIRES_IN') or '7d',
        SECRET_KEY=_optional('SECRET_KEY'),
        ALLOWED_HOSTS=allowed_hosts or ['*'],
        UPLOADS_DIR=_optional('UPLOADS_DIR'),
        WHATSAPP_TOKEN=_optional('WHATSAPP_TOKEN'),
        WHATSAPP_PHONE_NUMBER_ID=_optional('WHATSAPP_PHONE_NUMBER_ID'),
        WHATSAPP_VERIFY_TOKEN=_optional('WHATSAPP_VERIFY_TOKEN'),
        WHATSAPP_BUSINESS_ACCOUNT_ID=_optional('WHATSAPP_BUSINESS_ACCOUNT_ID'),
        MICROSOFT_CLIENT_ID=_optional('MICROSOFT_CLIENT_ID'),
        MICROSOFT_TENANT_ID=_optional('MICROSOFT_TENANT_ID'),
        # Azure shows a client secret's "Secret ID" and its "Value" - only the
        # Value is a usable OAuth client secret, so that's the one read here.
        MICROSOFT_CLIENT_VALUE=_optional('MICROSOFT_CLIENT_VALUE'),
        MICROSOFT_REDIRECT_URI=_optional('MICROSOFT_REDIRECT_URI'),
        ADVANTA_SMS_URL=_optional('ADVANTA_SMS_URL'),
        ADVANTA_API_KEY=_optional('ADVANTA_API_KEY'),
        ADVANTA_PARTNER_ID=_optional('ADVANTA_PARTNER_ID'),
        ADVANTA_SHORTCODE=_optional('ADVANTA_SHORTCODE'),
        SMTP_HOST=_optional('SMTP_HOST'),
        SMTP_PORT=_optional('SMTP_PORT'),
        SMTP_USER=_optional('SMTP_USER'),
        SMTP_PASS=_optional('SMTP_PASS'),
        SMTP_FROM=_optional('SMTP_FROM'),
    )


env: EnvConfig = load_env()


def cors_origins() -> list[str]:
    """CORS_ORIGIN as a list - '*' or one or more comma-separated origins."""
    return [o.strip() for o in env.CORS_ORIGIN.split(',') if o.strip()] or ['*']


def frontend_origin() -> str | None:
    """The first configured origin when it's a real URL (used for redirects and links)."""
    first = cors_origins()[0]
    return first if first.startswith('http') else None
