"""
Request-body validation - a small stand-in for the zod schemas the Express
routes used. It reports the first problem as a 400 with the same message
(custom messages verbatim, zod's defaults otherwise), strips unknown keys,
and keeps zod's optional semantics: an absent key is left out of the result,
while `null` is only accepted where a field is `nullable`.

    schema = obj(name=string(min=2, min_msg='Name is required'), age=number(min=0).optional())
    data = parse(schema, request_json(request))
"""
import re
from typing import Any, Callable

from .errors import BadRequestError

_MISSING = object()

# zod v4's email and UUID patterns.
_EMAIL_RE = re.compile(r"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$")
_UUID_RE = re.compile(
    r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
    r'|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
)


class ValidationError(Exception):
    pass


def _type_name(value: Any) -> str:
    if value is _MISSING:
        return 'undefined'
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'array'
    return 'object'


class Field:
    expected = 'unknown'

    def __init__(self) -> None:
        self.is_optional = False
        self.is_nullable = False
        self.default: Any = _MISSING
        self.checks: list[Callable[[Any], None]] = []

    def optional(self) -> 'Field':
        self.is_optional = True
        return self

    def nullable(self) -> 'Field':
        self.is_nullable = True
        return self

    def with_default(self, value: Any) -> 'Field':
        self.default = value
        self.is_optional = True
        return self

    def _invalid(self, value: Any) -> ValidationError:
        return ValidationError(f'Invalid input: expected {self.expected}, received {_type_name(value)}')

    def coerce(self, value: Any) -> Any:  # pragma: no cover - overridden
        return value

    def parse(self, value: Any) -> Any:
        if value is _MISSING:
            if self.default is not _MISSING:
                return self.default() if callable(self.default) else self.default
            if self.is_optional:
                return _MISSING
            raise self._invalid(value)
        if value is None:
            if self.is_nullable:
                return None
            raise self._invalid(value)
        return self.coerce(value)


class String(Field):
    expected = 'string'

    def __init__(self, min: int | None = None, min_msg: str | None = None, max: int | None = None,
                 max_msg: str | None = None, trim: bool = False, email: bool = False, email_msg: str | None = None,
                 uuid: bool = False, choices: tuple[str, ...] | list[str] | None = None) -> None:
        super().__init__()
        self.min, self.min_msg, self.max, self.max_msg = min, min_msg, max, max_msg
        self.trim, self.email, self.email_msg, self.uuid = trim, email, email_msg, uuid
        self.choices = list(choices) if choices is not None else None

    def coerce(self, value: Any) -> Any:
        if self.choices is not None:
            if not isinstance(value, str) or value not in self.choices:
                options = '|'.join(f'"{c}"' for c in self.choices)
                raise ValidationError(f'Invalid option: expected one of {options}')
            return value
        if not isinstance(value, str):
            raise self._invalid(value)
        if self.trim:
            value = value.strip()
        if self.min is not None and len(value) < self.min:
            raise ValidationError(self.min_msg or f'Too small: expected string to have >={self.min} characters')
        if self.max is not None and len(value) > self.max:
            raise ValidationError(self.max_msg or f'Too big: expected string to have <={self.max} characters')
        if self.email and not _EMAIL_RE.match(value):
            raise ValidationError(self.email_msg or 'Invalid email address')
        if self.uuid and not _UUID_RE.match(value):
            raise ValidationError('Invalid UUID')
        return value


class Number(Field):
    expected = 'number'

    def __init__(self, min: float | None = None, max: float | None = None, int_: bool = False) -> None:
        super().__init__()
        self.min, self.max, self.int_ = min, max, int_

    def coerce(self, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise self._invalid(value)
        if self.int_ and not float(value).is_integer():
            raise ValidationError('Invalid input: expected int, received number')
        if self.min is not None and value < self.min:
            raise ValidationError(f'Too small: expected number to be >={_num(self.min)}')
        if self.max is not None and value > self.max:
            raise ValidationError(f'Too big: expected number to be <={_num(self.max)}')
        return int(value) if self.int_ else value


class Boolean(Field):
    expected = 'boolean'

    def coerce(self, value: Any) -> Any:
        if not isinstance(value, bool):
            raise self._invalid(value)
        return value


class Array(Field):
    expected = 'array'

    def __init__(self, item: Field, min: int | None = None, min_msg: str | None = None,
                 max: int | None = None, max_msg: str | None = None) -> None:
        super().__init__()
        self.item, self.min, self.min_msg, self.max, self.max_msg = item, min, min_msg, max, max_msg

    def coerce(self, value: Any) -> Any:
        if not isinstance(value, list):
            raise self._invalid(value)
        items = [self.item.parse(v if v is not None else None) for v in value]
        if self.min is not None and len(items) < self.min:
            raise ValidationError(self.min_msg or f'Too small: expected array to have >={self.min} items')
        if self.max is not None and len(items) > self.max:
            raise ValidationError(self.max_msg or f'Too big: expected array to have <={self.max} items')
        return items


class Object(Field):
    expected = 'object'

    def __init__(self, fields: dict[str, Field], refine: list[tuple[Callable[[dict], bool], str]] | None = None) -> None:
        super().__init__()
        self.fields = fields
        self.refinements = refine or []

    def coerce(self, value: Any) -> Any:
        if not isinstance(value, dict):
            raise self._invalid(value)
        out = {}
        for name, field in self.fields.items():
            parsed = field.parse(value.get(name, _MISSING))
            if parsed is not _MISSING:
                out[name] = parsed
        for check, message in self.refinements:
            if not check(out):
                raise ValidationError(message)
        return out

    # zod's object helpers, used to derive update schemas from create schemas.
    def omit(self, *names: str) -> 'Object':
        return Object({k: v for k, v in self.fields.items() if k not in names})

    def partial(self) -> 'Object':
        fields = {}
        for name, field in self.fields.items():
            clone = _clone(field)
            clone.is_optional = True
            clone.default = _MISSING
            fields[name] = clone
        return Object(fields)

    def extend(self, **fields: Field) -> 'Object':
        return Object({**self.fields, **fields})


def _clone(field: Field) -> Field:
    clone = object.__new__(type(field))
    clone.__dict__.update(field.__dict__)
    return clone


def _num(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)


# ── Constructors ──────────────────────────────────────────────────────────────

def string(**kwargs) -> String:
    return String(**kwargs)


def email(message: str | None = None) -> String:
    return String(email=True, email_msg=message)


def uuid() -> String:
    return String(uuid=True)


def enum(choices) -> String:
    """`z.nativeEnum(Enum)` / `z.enum([...])` - accepts a TextChoices class or a list of values."""
    values = [c.value for c in choices] if hasattr(choices, '__members__') else list(choices)
    return String(choices=values)


def number(**kwargs) -> Number:
    return Number(**kwargs)


def integer(**kwargs) -> Number:
    return Number(int_=True, **kwargs)


def boolean() -> Boolean:
    return Boolean()


def array(item: Field, **kwargs) -> Array:
    return Array(item, **kwargs)


def obj(_refine: list[tuple[Callable[[dict], bool], str]] | None = None, **fields: Field) -> Object:
    return Object(fields, refine=_refine)


def parse(schema: Field, body: Any) -> Any:
    """Validates `body` (None = no JSON body sent) or raises a 400 with the first issue's message."""
    try:
        result = schema.parse(_MISSING if body is None else body)
    except ValidationError as err:
        raise BadRequestError(str(err)) from None
    return {} if result is _MISSING else result
