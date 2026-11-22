"""Attendance logging + supervisor verification for attachees."""
from core.dates import iso_day, parse_date
from core.db import update_row
from core.enums import AttendanceStatus, Role, WorkMode
from core.errors import BadRequestError, NotFoundError
from core.http import meta, paginate
from core.jwt import Actor
from core.serialize import pick, snake_keys, to_dict
from modules.audit import service as audit
from modules.auth.models import User

from .models import Attendance
from .supervisor_access import assert_can_manage_attachee

_UPDATABLE = ('status', 'checkInTime', 'checkOutTime', 'workMode', 'notes', 'verifiedBySupervisor')


def serialize(record: Attendance) -> dict:
    return {**to_dict(record), 'attachee': pick(record.attachee, 'id', 'name', 'registrationNo', 'organization')}


def _qs():
    return Attendance.objects.select_related('attachee')


def _date(value):
    parsed = parse_date(value)
    if parsed is None:
        raise BadRequestError('Invalid date')
    return parsed


def list_records(attachee_id=None, supervisor_id=None, status=None, from_=None, to=None, page=1, limit=20) -> dict:
    qs = _qs()
    if attachee_id:
        qs = qs.filter(attachee_id=attachee_id)
    if supervisor_id:
        qs = qs.filter(attachee__supervisor_id=supervisor_id)
    if status:
        qs = qs.filter(status=status)
    if from_:
        qs = qs.filter(date__gte=_date(from_))
    if to:
        qs = qs.filter(date__lte=_date(to))
    rows, total = paginate(qs.order_by('-date', '-created_at'), page, limit)
    return {'data': [serialize(r) for r in rows], 'meta': meta(total, page, limit)}


def _assert_attachee_exists(attachee_id: str) -> None:
    if not User.objects.filter(id=attachee_id, role=Role.ATTACHEE).exists():
        raise NotFoundError('Attachee')


def create(data: dict, actor_id: str) -> dict:
    _assert_attachee_exists(data['attacheeId'])
    record = Attendance.objects.create(
        attachee_id=data['attacheeId'],
        date=_date(data['date']),
        status=data.get('status') or AttendanceStatus.PRESENT,
        check_in_time=data.get('checkInTime'),
        check_out_time=data.get('checkOutTime'),
        work_mode=data.get('workMode') or WorkMode.ON_SITE,
        notes=data.get('notes'),
    )
    created = serialize(_qs().get(id=record.id))
    audit.record(actor_id, 'CREATE', 'ATTENDANCE', record.id,
                 summary=f"Logged attendance for {created['attachee']['name']}: {data['date']}", new_values=created)
    return created


def update(record_id: str, data: dict, actor: Actor) -> dict:
    """`actor` must be a manager or the attachee's assigned supervisor."""
    record = _qs().filter(id=record_id).first()
    if record is None:
        raise NotFoundError('Attendance record')
    assert_can_manage_attachee(record.attachee_id, actor)

    old = serialize(record)
    changes = snake_keys({k: data[k] for k in _UPDATABLE if k in data})
    if 'date' in data:
        changes['date'] = _date(data['date'])
    update_row(Attendance, record_id, **changes)

    updated = serialize(_qs().get(id=record_id))
    audit.record(actor.user_id, 'UPDATE', 'ATTENDANCE', record_id,
                 summary=f"Updated attendance for {updated['attachee']['name']}: {iso_day(updated['date'])}",
                 old_values=old, new_values=updated)
    return updated


def delete(record_id: str, actor_id: str) -> None:
    record = _qs().filter(id=record_id).first()
    if record is None:
        raise NotFoundError('Attendance record')
    old = serialize(record)
    record.delete()
    audit.record(actor_id, 'DELETE', 'ATTENDANCE', record_id,
                 summary=f'Deleted attendance record for {record.attachee.name}: {iso_day(record.date)}', old_values=old)
