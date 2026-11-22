"""
Date helpers that reproduce the JavaScript semantics the Node API relied on.

All datetimes are naive UTC (settings.USE_TZ is off), the way Prisma stores
them. `parse_instant` mirrors `new Date(string)`: a bare "YYYY-MM-DD" is UTC
midnight, an ISO string with an offset/"Z" is converted to UTC, and a string
without one is taken as UTC (the Node server runs in UTC).
"""
import math
import re
from datetime import date, datetime, timedelta, timezone

_DATE_ONLY = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# Kenya has no daylight saving: East Africa Time is always UTC+3.
NAIROBI = timezone(timedelta(hours=3), 'EAT')


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_millis(dt: datetime) -> datetime:
    return dt.replace(microsecond=(dt.microsecond // 1000) * 1000)


def parse_instant(value) -> datetime | None:
    """`new Date(value)` -> naive UTC datetime, or None for an Invalid Date."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if _DATE_ONLY.match(text):
            try:
                return datetime.strptime(text, '%Y-%m-%d')
            except ValueError:
                return None
        try:
            dt = datetime.fromisoformat(text.replace('z', 'Z'))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return _to_millis(dt)


def parse_date(value) -> date | None:
    """A Prisma `@db.Date` from `new Date(value)`: the UTC calendar day."""
    dt = parse_instant(value)
    return dt.date() if dt else None


def iso(value: datetime | date) -> str:
    """`Date.prototype.toISOString()` - what Prisma DateTime/Date values serialize to."""
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return f'{value:%Y-%m-%dT%H:%M:%S}.{value.microsecond // 1000:03d}Z'
    return f'{value.isoformat()}T00:00:00.000Z'


def iso_day(value: datetime | date) -> str:
    """`toISOString().slice(0, 10)`."""
    return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()


def js_round(x: float) -> int:
    """`Math.round` - halves round up, unlike Python's banker's rounding."""
    return math.floor(x + 0.5)


def js_parse_int(value, default: int) -> int:
    """`parseInt(value, 10)` with a fallback for NaN."""
    match = re.match(r'^\s*([+-]?\d+)', str(value)) if value is not None else None
    return int(match.group(1)) if match else default
