"""
Background poller that fires due task reminders once a minute for the life of
the process (started/stopped by config/asgi.py). Reminders are scheduled in
whole minutes, so a one-minute tick is fine-grained enough.
"""
import threading

from django.db import close_old_connections, connection

from core.logger import logger

POLL_INTERVAL_SECONDS = 60

_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop() -> None:
    from .service import run_due_reminders

    while not _stop.is_set():  # first pass runs immediately after boot
        close_old_connections()
        try:
            run_due_reminders()
        except Exception as err:  # noqa: BLE001
            logger.error('Reminder scheduler run failed', err)
        finally:
            connection.close()
        _stop.wait(POLL_INTERVAL_SECONDS)


def start_reminder_scheduler() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name='reminder-scheduler', daemon=True)
    _thread.start()


def stop_reminder_scheduler() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=5)
