from django.db import models

from core.db import TimestampedModel
from core.enums import Department, Role


class User(TimestampedModel):
    email = models.TextField(unique=True)
    password_hash = models.TextField()
    name = models.TextField()
    phone = models.TextField(null=True, blank=True)
    # WhatsApp's business-scoped user id ("KE.1234…") - how the bot recognises
    # someone who uses a WhatsApp username and hides their phone number.
    whatsapp_user_id = models.TextField(null=True, blank=True, unique=True)
    role = models.TextField(choices=Role.choices, default=Role.STAFF)
    is_active = models.BooleanField(default=True)
    department = models.TextField(choices=Department.choices, null=True, blank=True)

    # ── Attachee profile fields (only populated when role = ATTACHEE) ──────────
    registration_no = models.TextField(null=True, blank=True)
    course = models.TextField(null=True, blank=True)
    organization = models.TextField(null=True, blank=True)  # host company
    attachment_start = models.DateField(null=True, blank=True)
    attachment_end = models.DateField(null=True, blank=True)

    # The staff member assigned to supervise this attachee - verifies their
    # attendance and reviews their logbook entries.
    supervisor = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='supervised_attachees'
    )

    class Meta:
        db_table = 'users'
        indexes = [models.Index(fields=['supervisor']), models.Index(fields=['phone'])]

    def __str__(self) -> str:
        return f'{self.name} <{self.email}>'


class MicrosoftAccount(TimestampedModel):
    """
    A user's linked Microsoft (Outlook) account. Holds only the encrypted
    refresh token; short-lived access tokens are re-derived on every use and
    never persisted (see microsoft_account.py).
    """

    refresh_token_enc = models.TextField()
    scope = models.TextField()
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='microsoft_account')

    class Meta:
        db_table = 'microsoft_accounts'
