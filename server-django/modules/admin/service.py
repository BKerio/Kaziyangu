"""Staff account management (backend/src/modules/admin/admin.service.ts)."""
from django.db.models import Count, ProtectedError, RestrictedError

from core.db import update_row
from core.enums import Role
from core.errors import BadRequestError, ConflictError, NotFoundError
from core.hashing import hash_password
from core.http import meta, paginate
from core.serialize import pick, snake_keys, to_dict
from modules.audit import service as audit
from modules.auth.models import User


def list_users(role: str | None, page: int, limit: int) -> dict:
    # Attachees have their own roster (see attachments) and are excluded by default.
    qs = User.objects.filter(role=role) if role else User.objects.exclude(role=Role.ATTACHEE)
    qs = qs.annotate(task_count=Count('tasks')).order_by('-created_at')
    rows, total = paginate(qs, page, limit)
    data = [
        {**pick(u, 'id', 'name', 'email', 'phone', 'role', 'isActive', 'department', 'createdAt'),
         '_count': {'tasks': u.task_count}}
        for u in rows
    ]
    return {'data': data, 'meta': meta(total, page, limit)}


def get_user_by_id(user_id: str) -> dict:
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise NotFoundError('User')
    return pick(user, 'id', 'name', 'email', 'phone', 'role', 'isActive', 'department', 'createdAt')


def create_user(data: dict, actor_id: str) -> dict:
    if User.objects.filter(email=data['email']).exists():
        raise ConflictError('A user with this email already exists')

    user = User.objects.create(
        email=data['email'],
        password_hash=hash_password(data['passwordRaw']),
        name=data['name'],
        role=data['role'],
        phone=data.get('phone'),
        department=data.get('department'),
    )
    created = pick(user, 'id', 'name', 'email', 'role', 'department', 'createdAt')
    audit.record(actor_id, 'CREATE', 'USER', user.id,
                 summary=f"Created {data['role'].lower()} account: {user.email}", new_values=created)
    return created


def update_user(user_id: str, data: dict, actor_id: str) -> dict:
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise NotFoundError('User')
    if data.get('email') and data['email'] != user.email:
        if User.objects.filter(email=data['email']).exists():
            raise ConflictError('A user with this email already exists')

    rest = dict(data)
    password = rest.pop('password', None)
    changes = snake_keys(rest)
    if password:
        changes['password_hash'] = hash_password(password)

    old = to_dict(user)
    update_row(User, user_id, **changes)
    updated = pick(User.objects.get(id=user_id), 'id', 'name', 'email', 'phone', 'role', 'isActive', 'department')
    audit.record(actor_id, 'UPDATE', 'USER', user_id,
                 summary=f"Updated user{' (password reset)' if password else ''}: {updated['email']}",
                 old_values=old, new_values=updated)
    return updated


def delete_user(user_id: str, requester_id: str) -> None:
    if user_id == requester_id:
        raise BadRequestError('You cannot delete your own account')
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise NotFoundError('User')

    old = to_dict(user)
    try:
        user.delete()
    except (ProtectedError, RestrictedError):
        # The user has logged tasks or audit history; deleting would orphan
        # that record, so refuse - deactivate the account instead.
        raise ConflictError(
            'This user has logged tasks or audit history and cannot be permanently deleted. '
            'Deactivate the account instead.'
        ) from None

    audit.record(requester_id, 'DELETE', 'USER', user_id, summary=f'Deleted user: {user.email}', old_values=old)
