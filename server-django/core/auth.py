"""
Route guards (backend/src/middleware/auth.ts + shared/guards/requireRole.ts).
Both are router middleware: `router.use(authenticate)` or per route.
After `authenticate`, `request.actor` holds the verified token (`req.user`).
"""
from typing import Callable, Iterable

import jwt as pyjwt
from django.http import HttpRequest

from .errors import ForbiddenError, UnauthorizedError
from .jwt import verify_token


def authenticate(request: HttpRequest) -> None:
    header = request.headers.get('Authorization')
    token = header[len('Bearer '):] if header and header.startswith('Bearer ') else None
    # Falls back to a `?token=` query param so plain <img>/download links
    # (which can't set an Authorization header) can still load authenticated
    # files, e.g. task attachment screenshots.
    if token is None:
        token = request.GET.get('token')
    if not token:
        raise UnauthorizedError('Invalid or missing token')
    try:
        request.actor = verify_token(token)
    except pyjwt.PyJWTError:
        raise UnauthorizedError('Invalid or missing token') from None


def require_role(allowed_roles: Iterable[str]) -> Callable[[HttpRequest], None]:
    roles = list(allowed_roles)

    def guard(request: HttpRequest) -> None:
        actor = getattr(request, 'actor', None)
        if actor is None:
            raise ForbiddenError('Access denied: User context missing')
        if actor.role not in roles:
            raise ForbiddenError(f"Access denied: Requires one of [{', '.join(roles)}]")

    return guard
