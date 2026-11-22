"""
Each WhatsApp sender's place in the task-logging wizard plus their partial
answers, persisted in `bot_sessions` so the bot survives restarts.
"""
from dataclasses import dataclass, field
from datetime import timedelta

from core.dates import utcnow

from .models import BotSession

SESSION_TTL = timedelta(hours=24)  # 24h of inactivity resets the flow


@dataclass
class Session:
    flow: str = 'idle'
    data: dict[str, str] = field(default_factory=dict)


def _parse_data(data) -> dict[str, str]:
    return dict(data) if isinstance(data, dict) else {}


def _write(phone: str, flow: str, data: dict) -> None:
    BotSession.objects.update_or_create(
        phone=phone, defaults={'flow': flow, 'data': data, 'expires_at': utcnow() + SESSION_TTL}
    )


def get(phone: str) -> Session:
    existing = BotSession.objects.filter(phone=phone).first()
    if existing and existing.expires_at > utcnow():
        return Session(flow=existing.flow, data=_parse_data(existing.data))
    # Missing or expired - (re)start clean.
    reset(phone)
    return Session()


def reset(phone: str) -> None:
    _write(phone, 'idle', {})


def set_flow(phone: str, flow: str) -> None:
    _write(phone, flow, get(phone).data)


def advance(phone: str, flow: str, data: dict[str, str] | None = None) -> None:
    """Moves to `flow` and merges `data` in one write - the usual shape of a wizard step."""
    _write(phone, flow, {**get(phone).data, **(data or {})})


def set_data(phone: str, key: str, value: str) -> None:
    existing = get(phone)
    _write(phone, existing.flow, {**existing.data, key: value})
