"""
The request pipeline (backend/src/app.ts): request logging, helmet-style
security headers, CORS, the mounted routers, the JSON 404, and the global
error handler - in that order, the same as the Express app.

Every request runs in a worker thread (config/urls.py), so DB connections are
checked out and released here, per request, the way Django's request signals
would for a normal sync view.
"""
import time

from django.core.exceptions import RequestDataTooBig, TooManyFilesSent
from django.db import close_old_connections
from django.http import HttpRequest, HttpResponse

from .env import cors_origins, env
from .errors import AppError
from .http import send
from .logger import logger
from .router import Router

_CORS_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS'

# helmet() defaults. Cross-Origin-Resource-Policy is relaxed to cross-origin:
# the frontend is a different origin and must be able to embed authenticated
# files (task/opportunity attachments) served straight from this API.
_SECURITY_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Origin-Agent-Cluster': '?1',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    'X-Download-Options': 'noopen',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-XSS-Protection': '0',
}
_PRODUCTION_CSP = (
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';"
    "frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';"
    "script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests"
)


def _match_mount(path: str, prefix: str) -> str | None:
    """The sub-path under `prefix` when `path` is inside that mount (case-insensitive, segment-aligned)."""
    lower, lower_prefix = path.lower(), prefix.lower()
    if lower == lower_prefix:
        return '/'
    if lower.startswith(lower_prefix + '/'):
        return path[len(prefix):]
    return None


class App:
    def __init__(self) -> None:
        self._mounts: list[tuple[str, Router]] = []
        self._origins = cors_origins()
        self._loaded = False

    def mount(self, prefix: str, router: Router) -> None:
        self._mounts.append((prefix.rstrip('/'), router))

    def _ensure_routes(self) -> None:
        # Imported lazily: route modules import models, which need the app registry.
        if not self._loaded:
            from modules.routes import register_routes
            register_routes(self)
            self._loaded = True

    # ── CORS (the `cors` package's behaviour) ────────────────────────────────

    def _allow_origin(self, request: HttpRequest) -> str | None:
        if '*' in self._origins:
            return '*'
        if len(self._origins) == 1:
            return self._origins[0]
        origin = request.headers.get('Origin')
        return origin if origin in self._origins else None

    def _apply_cors(self, request: HttpRequest, response: HttpResponse) -> None:
        allow = self._allow_origin(request)
        if allow:
            response['Access-Control-Allow-Origin'] = allow
        if allow != '*':
            response['Vary'] = 'Origin'

    def _preflight(self, request: HttpRequest) -> HttpResponse:
        response = HttpResponse(status=204)
        response['Access-Control-Allow-Methods'] = _CORS_METHODS
        requested = request.headers.get('Access-Control-Request-Headers')
        if requested:
            response['Access-Control-Allow-Headers'] = requested
            response['Vary'] = 'Access-Control-Request-Headers'
        response['Content-Length'] = '0'
        return response

    # ── Pipeline ─────────────────────────────────────────────────────────────

    def handle(self, request: HttpRequest) -> HttpResponse:
        started = time.perf_counter()
        close_old_connections()
        try:
            self._ensure_routes()
            if request.method == 'OPTIONS':
                response = self._preflight(request)
            else:
                response = self._dispatch(request)
        finally:
            close_old_connections()

        self._apply_cors(request, response)
        self._apply_security_headers(response)
        logger.info(
            'request completed',
            method=request.method,
            url=request.get_full_path(),
            status=response.status_code,
            responseTime=round((time.perf_counter() - started) * 1000),
        )
        return response

    def _apply_security_headers(self, response: HttpResponse) -> None:
        for name, value in _SECURITY_HEADERS.items():
            if name not in response:
                response[name] = value
        if env.NODE_ENV == 'production' and 'Content-Security-Policy' not in response:
            response['Content-Security-Policy'] = _PRODUCTION_CSP
        # A route that's embedded in the frontend's own <iframe> (a PDF
        # preview) opts out of X-Frame-Options - see modules/tasks/routes.py.
        if getattr(response, 'allow_framing', False):
            del response['X-Frame-Options']

    def _dispatch(self, request: HttpRequest) -> HttpResponse:
        try:
            path = request.path_info or '/'
            if request.method in ('GET', 'HEAD') and path.rstrip('/') == '':
                return send({'ok': True, 'service': 'Org Task Management API', 'version': '1.0.0'})

            for prefix, router in self._mounts:
                subpath = _match_mount(path, prefix)
                if subpath is None:
                    continue
                response = router.handle(request, subpath)
                if response is not None:
                    return response

            return send({'ok': False, 'message': f'Route {request.method} {request.get_full_path()} not found'}, 404)
        except AppError as err:
            if not err.is_operational:
                logger.error('Unexpected (non-operational) error', err)
            return send({'ok': False, 'message': err.message}, err.status_code)
        except (RequestDataTooBig, TooManyFilesSent):
            return send({'ok': False, 'message': 'request entity too large'}, 413)
        except Exception as err:  # noqa: BLE001 - the global error handler
            logger.error('Unhandled error', err, url=request.get_full_path(), method=request.method)
            return send({'ok': False, 'message': 'Internal server error'}, 500)


application = App()
