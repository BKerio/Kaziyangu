"""The attachee roster - profiles that double as their login accounts."""
from django.db.models import ProtectedError, Q, RestrictedError

from core.dates import parse_date
from core.db import update_row
from core.enums import Role
from core.errors import BadRequestError, ConflictError, NotFoundError
from core.hashing import hash_password
from core.http import meta, paginate
from core.serialize import pick, snake_keys, to_dict
from modules.audit import service as audit
from modules.auth.models import User

_FIELDS = (
    'id', 'name', 'email', 'phone', 'role', 'isActive', 'registrationNo', 'course', 'department',
    'organization', 'supervisorId', 'attachmentStart', 'attachmentEnd', 'createdAt', 'updatedAt',
)


def serialize_attachee(user: User) -> dict:
    return {**pick(user, *_FIELDS), 'supervisor': pick(user.supervisor, 'id', 'name', 'email')}


def _attachees():
    return User.objects.filter(role=Role.ATTACHEE).select_related('supervisor')


def list_attachees(search: str | None, page: int, limit: int) -> dict:
    qs = _attachees()
    if search:
        qs = qs.filter(
            Q(name__icontains=search) | Q(email__icontains=search)
            | Q(registration_no__icontains=search) | Q(organization__icontains=search)
        )
    rows, total = paginate(qs.order_by('-created_at'), page, limit)
    return {'data': [serialize_attachee(u) for u in rows], 'meta': meta(total, page, limit)}


def list_supervised_by(supervisor_id: str) -> list[dict]:
    """The roster a staff member supervises - their "My Attachees" page."""
    return [serialize_attachee(u) for u in _attachees().filter(supervisor_id=supervisor_id).order_by('name')]


def get_by_id(attachee_id: str) -> dict:
    user = _attachees().filter(id=attachee_id).first()
    if user is None:
        raise NotFoundError('Attachee')
    return serialize_attachee(user)


def _assert_valid_supervisor(supervisor_id: str | None) -> None:
    """A supervisor must be a real, non-attachee account."""
    if not supervisor_id:
        return
    supervisor = User.objects.filter(id=supervisor_id).first()
    if supervisor is None or supervisor.role == Role.ATTACHEE:
        raise BadRequestError('The selected supervisor is not a valid staff member')


def _optional_date(value):
    if not value:
        return None
    parsed = parse_date(value)
    if parsed is None:
        raise BadRequestError('Invalid date')
    return parsed


def create(data: dict, actor_id: str) -> dict:
    if User.objects.filter(email=data['email']).exists():
        raise ConflictError('An account with this email already exists')
    _assert_valid_supervisor(data.get('supervisorId'))

    user = User.objects.create(
        name=data['name'],
        email=data['email'],
        password_hash=hash_password(data['passwordRaw']),
        phone=data.get('phone'),
        role=Role.ATTACHEE,
        registration_no=data['registrationNo'],
        course=data['course'],
        department=data['department'],
        organization=data['organization'],
        supervisor_id=data.get('supervisorId'),
        attachment_start=_optional_date(data.get('attachmentStart')),
        attachment_end=_optional_date(data.get('attachmentEnd')),
    )
    attachee = get_by_id(user.id)
    audit.record(actor_id, 'CREATE', 'USER', user.id, summary=f'Created attachee profile: {user.email}', new_values=attachee)
    return attachee


def update(attachee_id: str, data: dict, actor_id: str) -> dict:
    user = User.objects.filter(id=attachee_id, role=Role.ATTACHEE).first()
    if user is None:
        raise NotFoundError('Attachee')
    if data.get('email') and data['email'] != user.email:
        if User.objects.filter(email=data['email']).exists():
            raise ConflictError('An account with this email already exists')
    if 'supervisorId' in data:
        _assert_valid_supervisor(data['supervisorId'])

    rest = dict(data)
    password = rest.pop('password', None)
    start = rest.pop('attachmentStart', ...)
    end = rest.pop('attachmentEnd', ...)
    changes = snake_keys(rest)
    if password:
        changes['password_hash'] = hash_password(password)
    if start is not ...:
        changes['attachment_start'] = _optional_date(start)
    if end is not ...:
        changes['attachment_end'] = _optional_date(end)

    old = to_dict(user)
    update_row(User, attachee_id, **changes)
    updated = get_by_id(attachee_id)
    audit.record(actor_id, 'UPDATE', 'USER', attachee_id,
                 summary=f"Updated attachee profile{' (password reset)' if password else ''}: {updated['email']}",
                 old_values=old, new_values=updated)
    return updated


def delete(attachee_id: str, actor_id: str) -> None:
    user = User.objects.filter(id=attachee_id, role=Role.ATTACHEE).first()
    if user is None:
        raise NotFoundError('Attachee')
    old = to_dict(user)
    try:
        user.delete()
    except (ProtectedError, RestrictedError):
        raise ConflictError(
            'This attachee has attendance or logbook records and cannot be permanently deleted. '
            'Deactivate the account instead.'
        ) from None
    audit.record(actor_id, 'DELETE', 'USER', attachee_id, summary=f'Deleted attachee profile: {user.email}', old_values=old)
