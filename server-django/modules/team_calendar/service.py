"""Team Collaboration - a shared "who's out" calendar the whole team can see and mark themselves on."""
from core.dates import iso_day, parse_date
from core.enums import MANAGER_ROLES, Role
from core.errors import BadRequestError, ForbiddenError, NotFoundError
from core.jwt import Actor
from core.realtime import get_online_user_ids
from core.serialize import pick, to_dict
from modules.audit import service as audit
from modules.audit.models import AuditLog
from modules.auth.models import User

from .models import OutOfOffice


def serialize(entry: OutOfOffice) -> dict:
    return {**to_dict(entry), 'user': pick(entry.user, 'id', 'name', 'role')}


def _date(value: str):
    parsed = parse_date(value)
    if parsed is None:
        raise BadRequestError('Invalid date')
    return parsed


def list_entries(from_: str, to: str) -> list[dict]:
    rows = OutOfOffice.objects.filter(date__gte=_date(from_), date__lte=_date(to)).select_related('user').order_by('date')
    return [serialize(e) for e in rows]


def roster() -> list[dict]:
    """
    Active staff/admin roster: names, whether each has ever signed in (an
    AuditLog LOGIN row), and whether they're online right now (a live
    socket). The frontend overlays live presence:update events on top.
    """
    users = list(User.objects.filter(is_active=True).exclude(role=Role.ATTACHEE).order_by('name').values('id', 'name'))
    ids = [u['id'] for u in users]
    logged_in = set(AuditLog.objects.filter(action='LOGIN', user_id__in=ids).values_list('user_id', flat=True).distinct())
    online = get_online_user_ids()
    return [{**u, 'hasLoggedIn': u['id'] in logged_in, 'isOnline': u['id'] in online} for u in users]


def mark_out(user_id: str, dates: list[str], reason: str) -> list[dict]:
    """Idempotent - a date already marked just gets the new reason."""
    results = []
    for value in dates:
        entry, _ = OutOfOffice.objects.update_or_create(user_id=user_id, date=_date(value), defaults={'reason': reason})
        data = serialize(OutOfOffice.objects.select_related('user').get(id=entry.id))
        results.append(data)
        audit.record(user_id, 'CREATE', 'OUT_OF_OFFICE', entry.id, summary=f'Marked out of office: {value} ({reason})',
                     new_values=data)
    return results


def remove(entry_id: str, actor: Actor) -> None:
    """A user may only clear their own days; managers may clear anyone's."""
    entry = OutOfOffice.objects.filter(id=entry_id).first()
    if entry is None:
        raise NotFoundError('Out-of-office entry')
    if entry.user_id != actor.user_id and actor.role not in MANAGER_ROLES:
        raise ForbiddenError('You can only clear your own out-of-office days')
    old = to_dict(entry)
    entry.delete()
    audit.record(actor.user_id, 'DELETE', 'OUT_OF_OFFICE', entry_id,
                 summary=f'Cleared out-of-office day: {iso_day(entry.date)}', old_values=old)
