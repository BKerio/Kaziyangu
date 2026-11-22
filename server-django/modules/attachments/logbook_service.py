"""Attachee logbook (task report) submissions + supervisor grading/review."""
from core.dates import parse_date, utcnow
from core.db import update_row
from core.enums import ReportStatus, Role
from core.errors import BadRequestError, NotFoundError
from core.http import meta, paginate
from core.jwt import Actor
from core.serialize import pick, snake_keys, to_dict
from modules.audit import service as audit
from modules.auth.models import User

from .models import TaskReport
from .supervisor_access import assert_can_manage_attachee

_UPDATABLE = ('title', 'description', 'learnings', 'category', 'hoursSpent', 'status', 'rating', 'feedback', 'supervisorName')


def serialize(report: TaskReport) -> dict:
    return {**to_dict(report), 'attachee': pick(report.attachee, 'id', 'name', 'registrationNo', 'organization')}


def _qs():
    return TaskReport.objects.select_related('attachee')


def _date(value):
    parsed = parse_date(value)
    if parsed is None:
        raise BadRequestError('Invalid date')
    return parsed


def list_reports(attachee_id=None, supervisor_id=None, status=None, page=1, limit=20) -> dict:
    qs = _qs()
    if attachee_id:
        qs = qs.filter(attachee_id=attachee_id)
    if supervisor_id:
        qs = qs.filter(attachee__supervisor_id=supervisor_id)
    if status:
        qs = qs.filter(status=status)
    rows, total = paginate(qs.order_by('-date', '-created_at'), page, limit)
    return {'data': [serialize(r) for r in rows], 'meta': meta(total, page, limit)}


def create(data: dict, actor_id: str) -> dict:
    if not User.objects.filter(id=data['attacheeId'], role=Role.ATTACHEE).exists():
        raise NotFoundError('Attachee')
    report = TaskReport.objects.create(
        attachee_id=data['attacheeId'],
        date=_date(data['date']),
        title=data['title'],
        description=data['description'],
        learnings=data.get('learnings'),
        category=data.get('category'),
        hours_spent=data.get('hoursSpent', 0),
        status=ReportStatus.PENDING,
    )
    created = serialize(_qs().get(id=report.id))
    audit.record(actor_id, 'CREATE', 'TASK_REPORT', report.id, summary=f'Submitted logbook entry: {report.title}',
                 new_values=created)
    return created


def update(report_id: str, data: dict, actor: Actor) -> dict:
    """Content edits and/or a supervisor's review (status/rating/feedback)."""
    report = TaskReport.objects.filter(id=report_id).first()
    if report is None:
        raise NotFoundError('Task report')
    assert_can_manage_attachee(report.attachee_id, actor)

    is_review = any(k in data for k in ('status', 'rating', 'feedback'))
    old = to_dict(report)
    changes = snake_keys({k: data[k] for k in _UPDATABLE if k in data})
    if 'date' in data:
        changes['date'] = _date(data['date'])
    if is_review:
        changes['reviewed_at'] = utcnow()
    update_row(TaskReport, report_id, **changes)

    updated = serialize(_qs().get(id=report_id))
    audit.record(actor.user_id, 'UPDATE', 'TASK_REPORT', report_id,
                 summary=f"{'Reviewed' if is_review else 'Updated'} logbook entry: {updated['title']}",
                 old_values=old, new_values=updated)
    return updated


def delete(report_id: str, actor_id: str) -> None:
    report = TaskReport.objects.filter(id=report_id).first()
    if report is None:
        raise NotFoundError('Task report')
    old = to_dict(report)
    report.delete()
    audit.record(actor_id, 'DELETE', 'TASK_REPORT', report_id, summary=f'Deleted logbook entry: {report.title}', old_values=old)
