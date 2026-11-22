"""Registration, login and self-service profile (backend/src/modules/auth/auth.service.ts)."""
from core.db import update_row
from core.enums import Role
from core.errors import ConflictError, NotFoundError, UnauthorizedError
from core.hashing import compare_password, hash_password
from core.jwt import sign_token
from core.serialize import pick, to_dict
from modules.audit import service as audit

from .models import User

PROFILE_FIELDS = ('id', 'name', 'email', 'phone', 'role', 'isActive', 'department', 'createdAt', 'updatedAt')


def register(email: str, password_raw: str, name: str, phone: str | None = None) -> dict:
    """Self-registration always creates a STAFF account - promotions happen via the admin API."""
    if User.objects.filter(email=email).exists():
        raise ConflictError('User with this email already exists')

    user = User.objects.create(
        email=email, password_hash=hash_password(password_raw), name=name, phone=phone, role=Role.STAFF
    )
    data = pick(user, 'id', 'email', 'name', 'role', 'createdAt')
    audit.record(user.id, 'REGISTER', 'USER', user.id, summary=f'Self-registered: {user.email}', new_values=data)
    return data


def login(email: str, password_raw: str) -> dict:
    user = User.objects.filter(email=email).first()

    if user is None or not user.is_active:
        # No FK-able userId when the email doesn't match a real account.
        if user is not None:
            audit.record(user.id, 'LOGIN_FAILED', 'USER', user.id,
                         summary=f'Failed login attempt (account inactive): {user.email}')
        raise UnauthorizedError('Invalid email or password')

    if not compare_password(password_raw, user.password_hash):
        audit.record(user.id, 'LOGIN_FAILED', 'USER', user.id,
                     summary=f'Failed login attempt (wrong password): {user.email}')
        raise UnauthorizedError('Invalid email or password')

    token = sign_token(user.id, user.role)
    audit.record(user.id, 'LOGIN', 'USER', user.id, summary=f'Signed in: {user.email}')
    return {'token': token, 'user': pick(user, 'id', 'email', 'name', 'role', 'department')}


def get_profile(user_id: str) -> dict:
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise NotFoundError('User')
    return pick(user, *PROFILE_FIELDS)


def update_profile(user_id: str, data: dict) -> dict:
    """
    The signed-in user's own name/phone, and optionally a new password (requires
    the current one). Email/role/isActive stay admin-only.
    """
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise NotFoundError('User')

    changes = {}
    if 'name' in data:
        changes['name'] = data['name']
    if 'phone' in data:
        changes['phone'] = data['phone']
    password_changed = False
    if data.get('newPassword'):
        if not compare_password(data.get('currentPassword') or '', user.password_hash):
            raise UnauthorizedError('Current password is incorrect')
        changes['password_hash'] = hash_password(data['newPassword'])
        password_changed = True

    old = to_dict(user)
    update_row(User, user_id, **changes)
    updated = pick(User.objects.get(id=user_id), *PROFILE_FIELDS)

    audit.record(
        user_id, 'UPDATE', 'USER', user_id,
        summary=f"Updated own profile{' (password changed)' if password_changed else ''}: {updated['email']}",
        old_values=old, new_values=updated,
    )
    return updated
