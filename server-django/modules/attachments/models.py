from django.db import models

from core.db import TimestampedModel
from core.enums import AttendanceStatus, ReportStatus, WorkMode


class Attendance(TimestampedModel):
    date = models.DateField()
    status = models.TextField(choices=AttendanceStatus.choices, default=AttendanceStatus.PRESENT)
    check_in_time = models.TextField(null=True, blank=True)
    check_out_time = models.TextField(null=True, blank=True)
    work_mode = models.TextField(choices=WorkMode.choices, default=WorkMode.ON_SITE)
    notes = models.TextField(null=True, blank=True)
    verified_by_supervisor = models.BooleanField(default=False)
    attachee = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='attendance_records')

    class Meta:
        db_table = 'attendance_records'
        indexes = [models.Index(fields=['attachee']), models.Index(fields=['date'])]


class TaskReport(TimestampedModel):
    """An attachee logbook entry, reviewed and graded by their supervisor."""

    date = models.DateField()
    title = models.TextField()
    description = models.TextField()
    learnings = models.TextField(null=True, blank=True)
    category = models.TextField(null=True, blank=True)
    hours_spent = models.FloatField(default=0)
    status = models.TextField(choices=ReportStatus.choices, default=ReportStatus.PENDING)
    rating = models.IntegerField(null=True, blank=True)
    feedback = models.TextField(null=True, blank=True)
    supervisor_name = models.TextField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    attachee = models.ForeignKey('accounts.User', on_delete=models.PROTECT, related_name='task_reports')

    class Meta:
        db_table = 'task_reports'
        indexes = [models.Index(fields=['attachee']), models.Index(fields=['date'])]
