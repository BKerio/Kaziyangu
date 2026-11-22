from django.contrib.postgres.fields import ArrayField
from django.db import models

from core.db import CreatedModel, IdModel


class Campaign(CreatedModel):
    """An announcement an admin broadcasts to a chosen group of staff over WhatsApp and/or SMS."""

    title = models.TextField()
    message = models.TextField()
    channels = ArrayField(models.TextField())  # "WHATSAPP" | "SMS"
    # The audience as chosen ({ everyone, roles, departments, userIds }).
    audience = models.JSONField()
    # SENDING -> SENT (all delivered) / PARTIAL (some failed) / FAILED (none delivered)
    status = models.TextField(default='SENDING')
    recipient_count = models.IntegerField(default=0)
    sent_count = models.IntegerField(default=0)
    failed_count = models.IntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='campaigns_created')

    class Meta:
        db_table = 'campaigns'
        indexes = [models.Index(fields=['created_at'])]


class CampaignRecipient(IdModel):
    """One row per person per channel. A snapshot of the person, so history survives renames/deletes."""

    user_id = models.TextField()
    name = models.TextField()
    channel = models.TextField()
    status = models.TextField(default='PENDING')  # PENDING | SENT | FAILED
    error = models.TextField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    # When they tapped "View Notice" on WhatsApp and the full message was shown.
    read_at = models.DateTimeField(null=True, blank=True)
    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name='recipients')

    class Meta:
        db_table = 'campaign_recipients'
        indexes = [models.Index(fields=['campaign'])]
