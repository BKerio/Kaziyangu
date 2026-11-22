"""Request/response helpers shared by every route module."""
import json
from typing import Any
from urllib.parse import quote

from django.http import HttpRequest, HttpResponse

from .dates import js_parse_int
from .errors import BadRequestError
from .serialize import dumps


def send(payload: Any, status: int = 200) -> HttpResponse:
    """`res.status(status).send(payload)` for a JSON payload."""
    return HttpResponse(dumps(payload), status=status, content_type='application/json; charset=utf-8')


def ok(data: Any = ..., status: int = 200) -> HttpResponse:
    """`{ ok: true }` or `{ ok: true, data }`."""
    return send({'ok': True} if data is ... else {'ok': True, 'data': data}, status)


def ok_spread(result: dict, status: int = 200) -> HttpResponse:
    """`{ ok: true, ...result }` - list endpoints returning `{ data, meta }`."""
    return send({'ok': True, **result}, status)


def encode_uri_component(value: str) -> str:
    """JavaScript's encodeURIComponent."""
    return quote(value, safe="!~*'()")


def request_json(request: HttpRequest) -> Any:
    """The parsed JSON body, or None when the request didn't send JSON (`req.body` undefined)."""
    content_type = (request.content_type or '').lower()
    if not (content_type == 'application/json' or content_type.endswith('+json')):
        return None
    raw = request.body
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise BadRequestError('Invalid JSON body') from None


def query(request: HttpRequest, name: str) -> str | None:
    """`req.query[name]` as a string (an empty value counts as absent, as in the Node filters)."""
    value = request.GET.get(name)
    return value if value else None


def page_limit(request: HttpRequest, default_limit: int = 20) -> tuple[int, int]:
    page = max(1, js_parse_int(request.GET.get('page'), 1))
    limit = max(1, js_parse_int(request.GET.get('limit'), default_limit))
    return page, limit


def paginate(queryset, page: int, limit: int) -> tuple[list, int]:
    skip = (page - 1) * limit
    return list(queryset[skip:skip + limit]), queryset.count()


def meta(total: int, page: int, limit: int) -> dict:
    return {'total': total, 'page': page, 'limit': limit, 'totalPages': -(-total // limit)}
