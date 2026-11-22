"""
Central write/read point for the system-wide activity trail (AuditLog).
Every mutating service method calls `record()` right after its mutation.
"""
from typing import Any

from core.dates import parse_instant
from core.http import meta, paginate
from core.logger import logger
from core.serialize import pick, plain, to_dict

from .models import AuditLog


def _sanitize(value: Any) -> Any:
    """JSON round-trip (Dates -> ISO strings) and strip `passwordHash` - the trail never stores a credential."""
    if value is None:
        return None
    data = plain(value)
    if isinstance(data, dict):
        data.pop('passwordHash', None)
    return data


def record(
    actor_id: str,
    action: str,
    subject_type: str,
    subject_id: str,
    summary: str | None = None,
    old_values: Any = None,
    new_values: Any = None,
) -> None:
    """Writes one audit entry. Never raises - a logging failure must never break the request it describes."""
    try:
        AuditLog.objects.create(
            user_id=actor_id,
            action=action,
            subject_type=subject_type,
            subject_id=subject_id,
            summary=summary,
            old_values=_sanitize(old_values),
            new_values=_sanitize(new_values),
        )
    except Exception as err:  # noqa: BLE001
        logger.error('Failed to write audit log entry', err, action=action, subjectType=subject_type, subjectId=subject_id)


def list_logs(user_id=None, action=None, subject_type=None, from_=None, to=None, page=1, limit=20) -> dict:
    qs = AuditLog.objects.select_related('user').order_by('-created_at')
    if user_id:
        qs = qs.filter(user_id=user_id)
    if action:
        qs = qs.filter(action=action)
    if subject_type:
        qs = qs.filter(subject_type=subject_type)
    if from_:
        start = parse_instant(from_)
        if start:
            qs = qs.filter(created_at__gte=start)
    if to:
        end = parse_instant(to)
        if end:
            qs = qs.filter(created_at__lte=end)

    rows, total = paginate(qs, page, limit)
    data = [{**to_dict(log), 'user': pick(log.user, 'id', 'name', 'email', 'role')} for log in rows]
    return {'data': data, 'meta': meta(total, page, limit)}
