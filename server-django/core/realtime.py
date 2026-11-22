"""
Socket.io server (backend/src/lib/socket.ts), on python-socketio.

JWT auth on connect (`io(url, { auth: { token } })` on the client), automatic
`user:<id>` and `role:<ROLE>` rooms so services can push live updates to the
right people, and live online/offline presence broadcast as
`presence:update { onlineUserIds }`.

Request handlers run in worker threads, so `emit()` hands the coroutine to the
server's event loop instead of awaiting it.
"""
import asyncio
import threading
from collections import Counter

import jwt as pyjwt
import socketio

from .env import cors_origins
from .jwt import verify_token
from .logger import logger
from .serialize import plain

_origins = cors_origins()
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*' if '*' in _origins else _origins,
    logger=False,
    engineio_logger=False,
)

# userId -> number of open sockets. A second tab, or a flaky connection
# mid-reconnect, shouldn't flip someone to "offline" the instant one of their
# sockets drops - only when the last one does. Process-local: fine for this
# app's single-process deployment.
_online: Counter[str] = Counter()
_online_lock = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def get_online_user_ids() -> set[str]:
    """Live snapshot for REST responses (e.g. the team roster)."""
    with _online_lock:
        return set(_online.keys())


async def _broadcast_presence() -> None:
    await sio.emit('presence:update', {'onlineUserIds': sorted(get_online_user_ids())})


async def _broadcast_presence_soon() -> None:
    # Let the connect handshake finish first, so the new client gets it too.
    await sio.sleep(0.05)
    await _broadcast_presence()


@sio.event
async def connect(sid, environ, auth):
    token = auth.get('token') if isinstance(auth, dict) else None
    if not token:
        raise socketio.exceptions.ConnectionRefusedError('Authentication token required')
    try:
        actor = verify_token(token)
    except pyjwt.PyJWTError:
        raise socketio.exceptions.ConnectionRefusedError('Invalid or expired token') from None

    await sio.save_session(sid, {'userId': actor.user_id, 'role': actor.role})
    # Rooms come from the verified token - the client cannot spoof these.
    await sio.enter_room(sid, f'user:{actor.user_id}')
    await sio.enter_room(sid, f'role:{actor.role}')

    with _online_lock:
        _online[actor.user_id] += 1
    sio.start_background_task(_broadcast_presence_soon)


@sio.event
async def disconnect(sid, *args):
    try:
        session = await sio.get_session(sid)
    except KeyError:
        return
    user_id = session.get('userId')
    if not user_id:
        return
    with _online_lock:
        _online[user_id] -= 1
        if _online[user_id] <= 0:
            del _online[user_id]
    await _broadcast_presence()


def emit(event: str, data, rooms: list[str]) -> None:
    """Fire-and-forget emit to the union of `rooms`, callable from any thread."""
    loop = _loop
    if loop is None or loop.is_closed():
        return  # running without the ASGI server (e.g. a management command)
    payload = plain(data)
    try:
        asyncio.run_coroutine_threadsafe(sio.emit(event, payload, to=rooms), loop)
    except RuntimeError as err:
        logger.warn('Socket emit skipped', event=event, error=str(err))
