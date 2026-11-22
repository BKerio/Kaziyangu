"""
ASGI entry point - the equivalent of backend/src/server.ts.

Socket.io (python-socketio) and Django share one ASGI app: /socket.io/* goes
to the socket server, everything else to Django. Startup/shutdown hooks start
and stop the background reminder scheduler, like server.ts does.

Run it with:  python manage.py serve   (or: uvicorn config.asgi:application)
"""
import asyncio
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django  # noqa: E402

django.setup()

import socketio  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

from core import realtime  # noqa: E402
from core.logger import logger  # noqa: E402
from modules.reminders.scheduler import start_reminder_scheduler, stop_reminder_scheduler  # noqa: E402

django_app = get_asgi_application()


def on_startup() -> None:
    realtime.bind_loop(asyncio.get_running_loop())
    start_reminder_scheduler()


def on_shutdown() -> None:
    logger.info('Shutting down')
    stop_reminder_scheduler()
    logger.info('Shutdown complete')


application = socketio.ASGIApp(realtime.sio, django_app, on_startup=on_startup, on_shutdown=on_shutdown)
