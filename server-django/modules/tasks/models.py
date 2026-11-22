from django.db import models

from core.db import CreatedModel, TimestampedModel
from core.enums import Organization, TaskCategory, TaskStatus, TaskVertical


class WorkTask(TimestampedModel):
    """One row per daily task log entry (the "Master_Daily tasks" sheet)."""

    # The calendar day this task was worked, independent of created_at.
    date = models.DateField()
    vertical = models.TextField(choices=TaskVertical.choices)
    category = models.TextField(choices=TaskCategory.choices)
    description = models.TextField()
    # Which group entity this task is logged against.
    organization = models.TextField(choices=Organization.choices, null=True, blank=True)
    customer_project = models.TextField(null=True, blank=True)
    # "HH:mm" (24h) labels, as the sheet records them.
    start_time = models.TextField(null=True, blank=True)
    end_time = models.TextField(null=True, blank=True)
    hours_spent = models.FloatField(default=0)
    status = models.TextField(choices=TaskStatus.choices, default=TaskStatus.NOT_STARTED)
    percent_complete = models.IntegerField(default=0)  # 0-100
    key_deliverable = models.TextField(null=True, blank=True)
    blockers_notes = models.TextField(null=True, blank=True)
    # The "Resource Name" the task is logged against.
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='tasks')

    class Meta:
        db_table = 'work_tasks'
        indexes = [models.Index(fields=['user']), models.Index(fields=['date']), models.Index(fields=['vertical'])]


class TaskAttachment(CreatedModel):
    """A screenshot, PDF or Word file attached to a task as proof of work. Files live on disk."""

    file_name = models.TextField()
    mime_type = models.TextField()
    bytes = models.IntegerField()
    storage_key = models.TextField()  # relative path under the attachments root
    task = models.ForeignKey(WorkTask, on_delete=models.CASCADE, related_name='attachments')
    uploaded_by = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='uploaded_attachments')

    class Meta:
        db_table = 'task_attachments'
        indexes = [models.Index(fields=['task'])]
