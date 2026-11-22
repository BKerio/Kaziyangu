"""
The link between a User and their Microsoft account: the encrypted refresh
token, and the on-demand exchange of it for a short-lived access token.
"""
from core.crypto import decrypt_secret, encrypt_secret
from core.db import update_row
from core.logger import logger

from .microsoft_oauth import MicrosoftOAuthService
from .models import MicrosoftAccount


class MicrosoftAccountService:
    def __init__(self, oauth: MicrosoftOAuthService) -> None:
        self.oauth = oauth

    def is_connected(self, user_id: str) -> bool:
        return MicrosoftAccount.objects.filter(user_id=user_id).exists()

    def save_tokens(self, user_id: str, refresh_token: str | None, scope: str) -> None:
        if not refresh_token:
            logger.warn('Microsoft token exchange returned no refresh token - offline_access may not have been granted',
                        userId=user_id)
            return
        MicrosoftAccount.objects.update_or_create(
            user_id=user_id, defaults={'refresh_token_enc': encrypt_secret(refresh_token), 'scope': scope}
        )

    def disconnect(self, user_id: str) -> None:
        MicrosoftAccount.objects.filter(user_id=user_id).delete()

    def get_valid_access_token(self, user_id: str) -> str | None:
        """
        A fresh access token from the stored refresh token, or None if the
        account isn't linked or the token was revoked - in which case the dead
        link is removed so the UI can prompt reconnecting.
        """
        account = MicrosoftAccount.objects.filter(user_id=user_id).first()
        if account is None:
            return None

        refresh_token = decrypt_secret(account.refresh_token_enc)
        tokens = self.oauth.refresh_access_token(refresh_token)
        if tokens is None:
            MicrosoftAccount.objects.filter(user_id=user_id).delete()
            return None

        # Microsoft may rotate the refresh token; persist whatever came back.
        update_row(
            MicrosoftAccount, account.id,
            refresh_token_enc=encrypt_secret(tokens.refresh_token or refresh_token), scope=tokens.scope,
        )
        return tokens.access_token
