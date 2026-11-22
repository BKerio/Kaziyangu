"""
Django settings - the equivalent of backend/src/lib/env.ts + prisma.ts.

Every value comes from core.env (which loads .env and validates it once, so
the app refuses to start on a missing JWT_SECRET/DATABASE_URL rather than fail
confusingly later). The variable names are the same ones the Node backend
reads, so the backend's .env works here unchanged.
"""
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import dj_database_url

from core.env import BASE_DIR, env
from core.logger import logging_config

SECRET_KEY = env.SECRET_KEY or env.JWT_SECRET
DEBUG = env.NODE_ENV != 'production'
ALLOWED_HOSTS = env.ALLOWED_HOSTS

# No django.contrib.auth/admin/sessions: auth is stateless JWT (core/jwt.py),
# exactly like the Express API. Each module that owns tables is an app.
INSTALLED_APPS = [
    'django.contrib.postgres',  # ArrayField (Campaign.channels, TaskReminder.remind_at)
    'core',
    'modules.auth',
    'modules.audit',
    'modules.tasks',
    'modules.attachments',
    'modules.opportunities',
    'modules.team_calendar',
    'modules.reminders',
    'modules.campaigns',
    'modules.whatsapp',
]

# Intentionally empty: CORS, security headers, request logging, auth and error
# handling all live in core/app.py, which runs inside a worker thread per
# request (see config/urls.py). Django's sync middleware would otherwise force
# every request through ASGI's single "thread-sensitive" executor.
MIDDLEWARE: list[str] = []

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Prisma-only URL params that libpq/psycopg2 would reject.
_PRISMA_ONLY_PARAMS = {'schema', 'pgbouncer', 'connection_limit', 'pool_timeout', 'statement_cache_size', 'socket_timeout'}


def _database_config(url: str) -> dict:
    parts = urlsplit(url)
    params = parse_qsl(parts.query, keep_blank_values=True)
    schema = next((v for k, v in params if k == 'schema'), None)
    clean = urlunsplit(parts._replace(query=urlencode([(k, v) for k, v in params if k not in _PRISMA_ONLY_PARAMS])))
    config = dj_database_url.parse(clean, conn_max_age=0)
    config['DISABLE_SERVER_SIDE_CURSORS'] = True  # safe behind Neon's PgBouncer pooler
    if schema and schema != 'public':
        config.setdefault('OPTIONS', {})['options'] = f'-c search_path={schema}'
    return config


DATABASES = {'default': _database_config(env.DATABASE_URL)}

# Prisma stores DateTime as UTC in `timestamp without time zone`. Running with
# USE_TZ off and the connection pinned to UTC keeps every datetime a naive UTC
# value end to end (see core/dates.py), matching what Prisma reads and writes.
USE_TZ = False
TIME_ZONE = 'UTC'
USE_I18N = False
LANGUAGE_CODE = 'en-us'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# express.json({ limit: '2mb' }); uploads are capped per file in core/upload.py.
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
APPEND_SLASH = False

UPLOADS_DIR = env.UPLOADS_DIR or str(BASE_DIR / 'uploads')

LOGGING = logging_config(env.LOG_LEVEL, pretty=env.NODE_ENV != 'production')
