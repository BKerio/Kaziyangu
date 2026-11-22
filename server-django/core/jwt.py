"""
JWT helpers (backend/src/lib/jwt.ts). Same HS256 secret, same payload
({ userId, role, iat, exp }) and the same `JWT_EXPIRES_IN` syntax as the
`jsonwebtoken` package, so tokens issued by either server work on both.
"""
import math
import re
import time
import warnings
from dataclasses import dataclass

import jwt as pyjwt

from .env import env

# env.py already enforces the same 16-character minimum as the Node backend;
# PyJWT's stricter 32-byte advisory would otherwise warn on every request.
warnings.filterwarnings('ignore', category=pyjwt.warnings.InsecureKeyLengthWarning)

_ALGORITHMS = ['HS256', 'HS384', 'HS512']

# vercel/ms - what jsonwebtoken uses to read a string `expiresIn`.
_MS_RE = re.compile(
    r'^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$',
    re.IGNORECASE,
)
_UNIT_MS = {'y': 31_557_600_000, 'w': 604_800_000, 'd': 86_400_000, 'h': 3_600_000, 'm': 60_000, 's': 1000}


def _timespan_ms(value: str) -> float:
    match = _MS_RE.match(value.strip())
    if not match:
        raise ValueError(f'Invalid JWT_EXPIRES_IN "{value}"')
    amount = float(match.group(1))
    unit = (match.group(2) or 'ms').lower()
    if unit.startswith('ms') or unit.startswith('msec') or unit.startswith('millisecond'):
        return amount
    if unit.startswith('mo'):  # not a vercel/ms unit, but don't let "mo" fall into minutes
        raise ValueError(f'Invalid JWT_EXPIRES_IN "{value}"')
    return amount * _UNIT_MS[unit[0]]


@dataclass(frozen=True)
class Actor:
    """The decoded token - `req.user` in the Express code."""
    user_id: str
    role: str


def sign_token(user_id: str, role: str) -> str:
    iat = math.floor(time.time())
    exp = math.floor(iat + _timespan_ms(env.JWT_EXPIRES_IN) / 1000)
    return pyjwt.encode({'userId': user_id, 'role': role, 'iat': iat, 'exp': exp}, env.JWT_SECRET, algorithm='HS256')


def verify_token(token: str) -> Actor:
    """Raises on an invalid, tampered or expired token."""
    payload = pyjwt.decode(token, env.JWT_SECRET, algorithms=_ALGORITHMS)
    user_id, role = payload.get('userId'), payload.get('role')
    if not isinstance(user_id, str) or not isinstance(role, str):
        raise pyjwt.InvalidTokenError('Malformed token payload')
    return Actor(user_id=user_id, role=role)


_OAUTH_STATE_PURPOSE = 'oauth-state'


def sign_oauth_state(redirect_path: str | None = None) -> str:
    """
    Short-lived, stateless CSRF token for an OAuth `state` param - no session
    storage needed to verify the callback came from a request we issued.
    `redirect_path` rides along so the callback can return the browser to
    wherever the flow started.
    """
    iat = math.floor(time.time())
    payload = {'purpose': _OAUTH_STATE_PURPOSE, 'iat': iat, 'exp': iat + 600}
    if redirect_path:
        payload['redirectPath'] = redirect_path
    return pyjwt.encode(payload, env.JWT_SECRET, algorithm='HS256')


def verify_oauth_state(state: str) -> dict | None:
    try:
        payload = pyjwt.decode(state, env.JWT_SECRET, algorithms=_ALGORITHMS)
    except pyjwt.PyJWTError:
        return None
    if payload.get('purpose') != _OAUTH_STATE_PURPOSE:
        return None
    return {'redirectPath': payload.get('redirectPath')}
