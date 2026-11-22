"""
A tiny Express-style router so each module's routes read like the originals:

    router = Router()
    router.use(authenticate)

    @router.get('/:id', require_role(MANAGER_ROLES))
    def get_one(request, id): ...

Routes match in registration order, `:param` segments become keyword
arguments, trailing slashes and case are ignored (Express defaults), and
router-level middleware runs for every request that enters the router, before
route matching - exactly like `router.use()`. A request no route matches falls
through to the next mount and, finally, the JSON 404.
"""
import re
from typing import Callable

from django.http import HttpRequest, HttpResponse

Middleware = Callable[[HttpRequest], None]
Handler = Callable[..., HttpResponse]

_PARAM_RE = re.compile(r':([A-Za-z_][A-Za-z0-9_]*)')


def compile_path(path: str) -> re.Pattern:
    trimmed = path.rstrip('/')
    pattern = _PARAM_RE.sub(lambda m: f'(?P<{m.group(1)}>[^/]+)', re.escape(trimmed).replace('\\:', ':'))
    return re.compile(f'^{pattern}/?$', re.IGNORECASE)


class Router:
    def __init__(self) -> None:
        self._middleware: list[Middleware] = []
        self._routes: list[tuple[str, re.Pattern, list[Middleware], Handler]] = []

    def use(self, *middleware: Middleware) -> None:
        self._middleware.extend(middleware)

    def route(self, method: str, path: str, *middleware: Middleware) -> Callable[[Handler], Handler]:
        def register(handler: Handler) -> Handler:
            self._routes.append((method.upper(), compile_path(path), list(middleware), handler))
            return handler
        return register

    def get(self, path: str, *middleware: Middleware):
        return self.route('GET', path, *middleware)

    def post(self, path: str, *middleware: Middleware):
        return self.route('POST', path, *middleware)

    def patch(self, path: str, *middleware: Middleware):
        return self.route('PATCH', path, *middleware)

    def put(self, path: str, *middleware: Middleware):
        return self.route('PUT', path, *middleware)

    def delete(self, path: str, *middleware: Middleware):
        return self.route('DELETE', path, *middleware)

    @property
    def is_empty(self) -> bool:
        return not self._routes

    def handle(self, request: HttpRequest, subpath: str) -> HttpResponse | None:
        if not self._routes:
            return None
        for middleware in self._middleware:
            middleware(request)

        method = 'GET' if request.method == 'HEAD' else request.method
        for route_method, pattern, middleware, handler in self._routes:
            if route_method != method:
                continue
            match = pattern.match(subpath)
            if not match:
                continue
            for mw in middleware:
                mw(request)
            return handler(request, **match.groupdict())
        return None
