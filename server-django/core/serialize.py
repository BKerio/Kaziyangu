"""
Turns model instances into the exact JSON shapes Prisma produced: camelCase
keys (`password_hash` -> `passwordHash`, FK `user` -> `userId`), dates as ISO
strings, nested `select`s as plain dicts.
"""
import json
import re
from datetime import date, datetime

from django.db import models

from .dates import iso

_CAMEL_RE = re.compile(r'_([a-z0-9])')
_SNAKE_RE = re.compile(r'(?<!^)([A-Z])')


def camel(name: str) -> str:
    return _CAMEL_RE.sub(lambda m: m.group(1).upper(), name)


def snake(name: str) -> str:
    return _SNAKE_RE.sub(r'_\1', name).lower()


def to_dict(instance: models.Model | None, exclude: tuple[str, ...] = ()) -> dict | None:
    """Every scalar column, camelCased - what a Prisma query returns without `select`."""
    if instance is None:
        return None
    out = {}
    for field in instance._meta.concrete_fields:
        key = camel(field.attname)
        if key not in exclude:
            out[key] = getattr(instance, field.attname)
    return out


def pick(instance: models.Model | None, *fields: str) -> dict | None:
    """A Prisma `select` of scalar fields, by their camelCase names."""
    if instance is None:
        return None
    return {name: getattr(instance, snake(name)) for name in fields}


def snake_keys(data: dict) -> dict:
    """Validated camelCase input -> model attribute names."""
    return {snake(k): v for k, v in data.items()}


class JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (datetime, date)):
            return iso(o)
        if isinstance(o, (set, tuple)):
            return list(o)
        return super().default(o)


def dumps(data) -> str:
    return json.dumps(data, cls=JSONEncoder, ensure_ascii=False)


def plain(data):
    """JSON round-trip (Dates -> ISO strings) - what `JSON.parse(JSON.stringify(x))` gives."""
    return json.loads(dumps(data))
