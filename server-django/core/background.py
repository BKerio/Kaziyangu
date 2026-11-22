"""
Fire-and-forget work after the response has gone out (the Node code's
`void promise.catch(log)`), on a daemon thread with its own DB connection.
"""
import threading
from typing import Callable

from django.db import close_old_connections, connection

from .logger import logger


def run_in_background(fn: Callable[[], None], name: str) -> None:
    def runner() -> None:
        close_old_connections()
        try:
            fn()
        except Exception as err:  # noqa: BLE001 - background failures are logged, never raised
            logger.error(f'{name} failed', err)
        finally:
            connection.close()

    threading.Thread(target=runner, name=name, daemon=True).start()
