from django.db import models

from core.db import CreatedModel


class AuditLog(CreatedModel):
    action = models.TextField()  # CREATE, UPDATE, DELETE, LOGIN, LOGIN_FAILED, REGISTER
    subject_type = models.TextField()  # WORK_TASK, USER, OPPORTUNITY, ...
    subject_id = models.TextField()
    # Short human-readable line, so the Audit Logs page never needs a
    # per-subjectType join just to be readable.
    summary = models.TextField(null=True, blank=True)
    old_values = models.JSONField(null=True, blank=True)
    new_values = models.JSONField(null=True, blank=True)
    user = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='audit_logs')

    class Meta:
        db_table = 'audit_logs'
        indexes = [models.Index(fields=['subject_type', 'subject_id'])]
