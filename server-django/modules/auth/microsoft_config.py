"""
"Login with Outlook" is entirely opt-in: with any of these unset the routes
stay unregistered rather than failing on first use.
"""
from dataclasses import dataclass

from core.env import EnvConfig


def is_microsoft_auth_enabled(config: EnvConfig) -> bool:
    return bool(
        config.MICROSOFT_CLIENT_ID and config.MICROSOFT_TENANT_ID
        and config.MICROSOFT_CLIENT_VALUE and config.MICROSOFT_REDIRECT_URI
    )


@dataclass(frozen=True)
class MicrosoftOAuthCredentials:
    client_id: str
    tenant_id: str
    client_secret: str
    redirect_uri: str


def require_microsoft_auth_env(config: EnvConfig) -> MicrosoftOAuthCredentials:
    if not is_microsoft_auth_enabled(config):
        raise RuntimeError(
            'Microsoft login is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, '
            'MICROSOFT_CLIENT_VALUE, and MICROSOFT_REDIRECT_URI.'
        )
    return MicrosoftOAuthCredentials(
        client_id=config.MICROSOFT_CLIENT_ID,
        tenant_id=config.MICROSOFT_TENANT_ID,
        client_secret=config.MICROSOFT_CLIENT_VALUE,
        redirect_uri=config.MICROSOFT_REDIRECT_URI,
    )
