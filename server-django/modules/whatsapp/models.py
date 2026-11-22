from django.db import models

from core.db import IdModel
from core.dates import utcnow


class BotSession(IdModel):
    """
    One row per WhatsApp sender, tracking where they are in the task-logging
    conversation (`flow`) plus their partial answers (`data`).
    """

    phone = models.TextField(unique=True)
    flow = models.TextField(default='idle')
    data = models.JSONField(default=dict)
    expires_at = models.DateTimeField()
    updated_at = models.DateTimeField(default=utcnow)

    class Meta:
        db_table = 'bot_sessions'

    def save(self, *args, **kwargs):
        self.updated_at = utcnow()
        super().save(*args, **kwargs)
