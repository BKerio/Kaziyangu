"""The WhatsApp bot is opt-in: with any of these three unset, no webhook routes are registered."""
from dataclasses import dataclass

from core.env import EnvConfig


def is_whatsapp_enabled(config: EnvConfig) -> bool:
    return bool(config.WHATSAPP_TOKEN and config.WHATSAPP_PHONE_NUMBER_ID and config.WHATSAPP_VERIFY_TOKEN)


@dataclass(frozen=True)
class WhatsAppCredentials:
    token: str
    phone_number_id: str
    verify_token: str


def require_whatsapp_env(config: EnvConfig) -> WhatsAppCredentials:
    if not is_whatsapp_enabled(config):
        raise RuntimeError('WhatsApp is not configured. Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN.')
    return WhatsAppCredentials(config.WHATSAPP_TOKEN, config.WHATSAPP_PHONE_NUMBER_ID, config.WHATSAPP_VERIFY_TOKEN)
