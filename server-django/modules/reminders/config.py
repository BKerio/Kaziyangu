"""
Each reminder channel is independently opt-in: an unconfigured channel doesn't
break reminder creation, it just no-ops (and logs) when a send is attempted.
"""
from dataclasses import dataclass

from core.env import EnvConfig


def is_sms_enabled(config: EnvConfig) -> bool:
    return bool(config.ADVANTA_SMS_URL and config.ADVANTA_API_KEY and config.ADVANTA_PARTNER_ID and config.ADVANTA_SHORTCODE)


def is_email_enabled(config: EnvConfig) -> bool:
    return bool(config.SMTP_HOST and config.SMTP_PORT and config.SMTP_USER and config.SMTP_PASS)


@dataclass(frozen=True)
class AdvantaCredentials:
    url: str
    api_key: str
    partner_id: str
    shortcode: str


def require_advanta_env(config: EnvConfig) -> AdvantaCredentials:
    if not is_sms_enabled(config):
        raise RuntimeError('SMS is not configured. Set ADVANTA_SMS_URL, ADVANTA_API_KEY, ADVANTA_PARTNER_ID, and ADVANTA_SHORTCODE.')
    return AdvantaCredentials(config.ADVANTA_SMS_URL, config.ADVANTA_API_KEY, config.ADVANTA_PARTNER_ID, config.ADVANTA_SHORTCODE)


@dataclass(frozen=True)
class SmtpCredentials:
    host: str
    port: int
    user: str
    password: str
    sender: str


def require_smtp_env(config: EnvConfig) -> SmtpCredentials:
    if not is_email_enabled(config):
        raise RuntimeError('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.')
    return SmtpCredentials(
        host=config.SMTP_HOST, port=int(config.SMTP_PORT), user=config.SMTP_USER, password=config.SMTP_PASS,
        sender=config.SMTP_FROM or config.SMTP_USER,
    )
