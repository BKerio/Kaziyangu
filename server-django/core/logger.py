"""
Structured logger (backend/src/lib/logger.ts used pino). Readable lines in
development, one JSON object per line in production. Extra context is passed
as keyword arguments: logger.warn('Send failed', channel='SMS', error=msg).
"""
import json
import logging
import traceback
from datetime import datetime, timezone

_LEVELS = {
    'trace': 'DEBUG', 'debug': 'DEBUG', 'info': 'INFO', 'warn': 'WARNING',
    'warning': 'WARNING', 'error': 'ERROR', 'fatal': 'CRITICAL', 'silent': 'CRITICAL',
}


class _PrettyFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created).strftime('%H:%M:%S.%f')[:-3]
        line = f'[{ts}] {record.levelname:<7} {record.getMessage()}'
        ctx = getattr(record, 'ctx', None)
        if ctx:
            line += ' ' + json.dumps(ctx, default=str)
        if record.exc_info:
            line += '\n' + ''.join(traceback.format_exception(*record.exc_info)).rstrip()
        return line


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            'level': record.levelname.lower(),
            'time': datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            'msg': record.getMessage(),
            **(getattr(record, 'ctx', None) or {}),
        }
        if record.exc_info:
            payload['err'] = ''.join(traceback.format_exception(*record.exc_info)).rstrip()
        return json.dumps(payload, default=str)


def logging_config(level: str, pretty: bool) -> dict:
    return {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {'app': {'()': _PrettyFormatter if pretty else _JsonFormatter}},
        'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'app'}},
        'loggers': {
            'app': {'handlers': ['console'], 'level': _LEVELS.get(level.lower(), 'INFO'), 'propagate': False},
            'django': {'handlers': ['console'], 'level': 'WARNING', 'propagate': False},
        },
    }


class Logger:
    def __init__(self, name: str = 'app') -> None:
        self._log = logging.getLogger(name)

    def _emit(self, level: int, msg: str, exc: BaseException | None, ctx: dict) -> None:
        exc_info = (type(exc), exc, exc.__traceback__) if exc else None
        self._log.log(level, msg, exc_info=exc_info, extra={'ctx': ctx})

    def debug(self, msg: str, **ctx) -> None:
        self._emit(logging.DEBUG, msg, None, ctx)

    def info(self, msg: str, **ctx) -> None:
        self._emit(logging.INFO, msg, None, ctx)

    def warn(self, msg: str, **ctx) -> None:
        self._emit(logging.WARNING, msg, None, ctx)

    def error(self, msg: str, err: BaseException | None = None, **ctx) -> None:
        self._emit(logging.ERROR, msg, err, ctx)


logger = Logger()
