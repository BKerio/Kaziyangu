from django.db import models

from core.db import IdModel
from core.dates import utcnow


class OutOfOffice(IdModel):
    """One row per person per day they've marked themselves out of office."""

    date = models.DateField()
    reason = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=utcnow)
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='out_of_office_days')

    class Meta:
        db_table = 'out_of_office'
        constraints = [models.UniqueConstraint(fields=['user', 'date'], name='out_of_office_user_id_date_key')]
        indexes = [models.Index(fields=['date'])]
