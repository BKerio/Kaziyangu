from django.contrib.postgres.fields import ArrayField
from django.db import models

from core.db import EnumArrayField, IdModel, TimestampedModel
from core.dates import utcnow
from core.enums import ReminderChannel, ReminderStatus


class TaskReminder(TimestampedModel):
    """
    An opt-in nudge for a single WorkTask, sent on one or more channels at each
    of the times in `remind_at`, until they've all gone out or the task is
    COMPLETED_CLOSED. Rows created before `remind_at` existed have it empty and
    keep the old cadence: 30 minutes before `due_at`, then every 10 minutes
    until `repeat_count` sends. See service.py.
    """

    # When the task is actually due - a deadline, not the day work is logged.
    due_at = models.DateTimeField()
    channels = EnumArrayField()
    # The exact moments to send (ascending, at or before due_at).
    remind_at = ArrayField(models.DateTimeField(), default=list)
    repeat_count = models.IntegerField(default=1)
    sent_count = models.IntegerField(default=0)
    status = models.TextField(choices=ReminderStatus.choices, default=ReminderStatus.SCHEDULED)
    # Next time the scheduler should fire; null once DONE/CANCELLED.
    next_run_at = models.DateTimeField(null=True, blank=True)
    task = models.OneToOneField('tasks.WorkTask', on_delete=models.CASCADE, related_name='reminder')
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='task_reminders')

    class Meta:
        db_table = 'task_reminders'
        indexes = [models.Index(fields=['next_run_at']), models.Index(fields=['user'])]


class TaskReminderLog(IdModel):
    """One row per send attempt (one per channel per fire)."""

    channel = models.TextField(choices=ReminderChannel.choices)
    status = models.TextField()  # SENT | FAILED
    error = models.TextField(null=True, blank=True)
    sent_at = models.DateTimeField(default=utcnow)
    reminder = models.ForeignKey(TaskReminder, on_delete=models.CASCADE, related_name='logs')

    class Meta:
        db_table = 'task_reminder_logs'
        indexes = [models.Index(fields=['reminder'])]
