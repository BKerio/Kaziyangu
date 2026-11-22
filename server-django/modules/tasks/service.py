"""
Daily task log + weekly reports (backend/src/modules/tasks/task.service.ts).
Every change is pushed live over Socket.io to admins and the task's owner.
"""
from datetime import date, timedelta

from django.db.models import Count

from core import realtime
from core.dates import iso_day, js_round, parse_date, utcnow
from core.db import update_row
from core.enums import MANAGER_ROLES, Role, TaskCategory, TaskStatus, TaskVertical, values
from core.errors import BadRequestError, ForbiddenError, NotFoundError
from core.http import meta, paginate
from core.jwt import Actor
from core.serialize import snake_keys, to_dict
from modules.audit import service as audit
from modules.auth.models import User

from .models import WorkTask
from .options import COMPLETED_STATUSES

_UPDATABLE = (
    'vertical', 'category', 'description', 'organization', 'customerProject', 'startTime', 'endTime',
    'hoursSpent', 'status', 'percentComplete', 'keyDeliverable', 'blockersNotes',
)


def _is_manager(role: str) -> bool:
    return role in MANAGER_ROLES


def _task_qs():
    return WorkTask.objects.select_related('user').annotate(attachment_count=Count('attachments'))


def serialize_task(task: WorkTask) -> dict:
    """A task with `include: { user: { select: { id, name } }, _count: { select: { attachments } } }`."""
    count = getattr(task, 'attachment_count', None)
    if count is None:
        count = task.attachments.count()
    return {**to_dict(task), 'user': {'id': task.user.id, 'name': task.user.name}, '_count': {'attachments': count}}


def _load(task_id: str) -> dict:
    return serialize_task(_task_qs().get(id=task_id))


def _broadcast(event: str, payload: dict, user_id: str) -> None:
    realtime.emit(event, payload, [f'role:{Role.ADMIN}', f'role:{Role.SUPER_ADMIN}', f'user:{user_id}'])


def _require_date(value) -> date:
    parsed = parse_date(value)
    if parsed is None:
        raise BadRequestError('Invalid date')
    return parsed


def create_task(actor: Actor, data: dict) -> dict:
    requested = data.get('userId')
    if requested and requested != actor.user_id and not _is_manager(actor.role):
        raise ForbiddenError('Only admins can log a task on behalf of another user')
    target_user_id = requested if requested and _is_manager(actor.role) else actor.user_id

    task = WorkTask.objects.create(
        date=_require_date(data['date']),
        vertical=data['vertical'],
        category=data['category'],
        description=data['description'],
        organization=data.get('organization'),
        customer_project=data.get('customerProject'),
        start_time=data.get('startTime'),
        end_time=data.get('endTime'),
        hours_spent=data.get('hoursSpent', 0),
        status=data.get('status') or TaskStatus.NOT_STARTED,
        percent_complete=data.get('percentComplete', 0),
        key_deliverable=data.get('keyDeliverable'),
        blockers_notes=data.get('blockersNotes'),
        user_id=target_user_id,
    )
    created = _load(task.id)
    _broadcast('task:created', created, target_user_id)
    audit.record(actor.user_id, 'CREATE', 'WORK_TASK', task.id, summary=f'Logged task: {task.description}', new_values=created)
    return created


def get_tasks(actor: Actor, user_id=None, vertical=None, category=None, status=None, from_=None, to=None,
              page: int = 1, limit: int = 20) -> dict:
    qs = _task_qs()
    # Staff only ever see their own tasks; a userId filter is a manager-only option.
    if _is_manager(actor.role):
        if user_id:
            qs = qs.filter(user_id=user_id)
    else:
        qs = qs.filter(user_id=actor.user_id)
    if vertical:
        qs = qs.filter(vertical=vertical)
    if category:
        qs = qs.filter(category=category)
    if status:
        qs = qs.filter(status=status)
    if from_:
        qs = qs.filter(date__gte=_require_date(from_))
    if to:
        qs = qs.filter(date__lte=_require_date(to))

    rows, total = paginate(qs.order_by('-date', '-created_at'), page, limit)
    return {'data': [serialize_task(t) for t in rows], 'meta': meta(total, page, limit)}


def _find_owned(task_id: str, actor: Actor) -> WorkTask:
    task = WorkTask.objects.filter(id=task_id).first()
    if task is None:
        raise NotFoundError('Task')
    if task.user_id != actor.user_id and not _is_manager(actor.role):
        raise ForbiddenError('You do not have permission to access this task')
    return task


def get_task_by_id(task_id: str, actor: Actor) -> dict:
    task = _find_owned(task_id, actor)
    return _load(task.id)


def update_task(task_id: str, actor: Actor, data: dict) -> dict:
    existing = _find_owned(task_id, actor)
    old = to_dict(existing)

    changes = snake_keys({k: data[k] for k in _UPDATABLE if k in data})
    if 'date' in data:
        changes['date'] = _require_date(data['date'])
    update_row(WorkTask, task_id, **changes)

    updated = _load(task_id)
    _broadcast('task:updated', updated, updated['userId'])
    audit.record(actor.user_id, 'UPDATE', 'WORK_TASK', task_id,
                 summary=f"Updated task: {updated['description']}", old_values=old, new_values=updated)
    return updated


def delete_task(task_id: str, actor: Actor) -> None:
    task = _find_owned(task_id, actor)
    old = to_dict(task)
    task.delete()
    _broadcast('task:deleted', {'id': task_id}, task.user_id)
    audit.record(actor.user_id, 'DELETE', 'WORK_TASK', task_id, summary=f'Deleted task: {task.description}', old_values=old)


# ── Reports ────────────────────────────────────────────────────────────────


def _monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _week_start(week_start_input: str | None) -> date:
    if week_start_input:
        parsed = parse_date(week_start_input)
        if parsed is None:
            raise BadRequestError('Invalid weekStart date')
        return _monday_of(parsed)
    return _monday_of(utcnow().date())


def _round2(n: float) -> float:
    return js_round(n * 100) / 100


def get_resource_weekly_report(week_start_input: str | None) -> dict:
    """Per-person Mon-Fri hours, total, utilization vs 40 h, and completed count ("Resource C & W Tracker")."""
    monday = _week_start(week_start_input)
    week_end = monday + timedelta(days=7)

    users = list(User.objects.filter(is_active=True).order_by('name').values('id', 'name'))
    tasks = WorkTask.objects.filter(date__gte=monday, date__lt=week_end).values('user_id', 'date', 'hours_spent', 'status')

    day_keys = ('mon', 'tue', 'wed', 'thu', 'fri')
    by_user: dict[str, dict] = {}

    def blank() -> dict:
        return {'hoursByDay': {k: 0 for k in day_keys}, 'total': 0, 'completed': 0}

    for u in users:
        by_user[u['id']] = blank()
    for t in tasks:
        # A user missing from the active list (e.g. deactivated mid-week) still gets reported.
        entry = by_user.setdefault(t['user_id'], blank())
        day_index = (t['date'] - monday).days
        entry['total'] += t['hours_spent']
        if 0 <= day_index < 5:
            entry['hoursByDay'][day_keys[day_index]] += t['hours_spent']
        if t['status'] in COMPLETED_STATUSES:
            entry['completed'] += 1

    names = {u['id']: u['name'] for u in users}
    rows = [
        {
            'userId': user_id,
            'name': names.get(user_id, 'Unknown'),
            'hoursByDay': entry['hoursByDay'],
            'totalWeeklyHours': _round2(entry['total']),
            'utilizationPct': js_round(entry['total'] / 40 * 1000) / 1000,
            'tasksCompleted': entry['completed'],
        }
        for user_id, entry in by_user.items()
    ]
    return {'weekStart': monday.isoformat(), 'rows': rows}


def get_vertical_weekly_summary(week_start_input: str | None) -> dict:
    """Per-vertical totals, headline-category hours and top engineer ("Weekly Vertical Summary")."""
    monday = _week_start(week_start_input)
    week_end = monday + timedelta(days=7)
    tasks = WorkTask.objects.filter(date__gte=monday, date__lt=week_end).values(
        'vertical', 'category', 'hours_spent', 'user_id', 'user__name'
    )

    verticals = values(TaskVertical)
    by_vertical = {
        v: {'totalHours': 0, 'taskCount': 0, 'deploymentHours': 0, 'supportHours': 0, 'pocHours': 0, 'hoursByUser': {}}
        for v in verticals
    }
    for t in tasks:
        entry = by_vertical.get(t['vertical'])
        if entry is None:
            continue
        hours = t['hours_spent']
        entry['totalHours'] += hours
        entry['taskCount'] += 1
        if t['category'] == TaskCategory.DEPLOYMENT:
            entry['deploymentHours'] += hours
        if t['category'] == TaskCategory.SUPPORT_BREAK_FIX:
            entry['supportHours'] += hours
        if t['category'] == TaskCategory.PROOF_OF_CONCEPT:
            entry['pocHours'] += hours
        person = entry['hoursByUser'].setdefault(t['user_id'], {'name': t['user__name'], 'hours': 0})
        person['hours'] += hours

    rows = []
    for vertical in verticals:
        e = by_vertical[vertical]
        top_engineer, top_hours = None, -1
        for person in e['hoursByUser'].values():
            if person['hours'] > top_hours:
                top_hours, top_engineer = person['hours'], person['name']
        rows.append({
            'vertical': vertical,
            'totalHours': _round2(e['totalHours']),
            'taskCount': e['taskCount'],
            'deploymentHours': _round2(e['deploymentHours']),
            'supportHours': _round2(e['supportHours']),
            'pocHours': _round2(e['pocHours']),
            'topEngineer': top_engineer,
        })
    return {'weekStart': monday.isoformat(), 'rows': rows}


def get_org_overview(week_start_input: str | None) -> dict:
    """Headcount by department, this week's status mix, and a per-member task-load histogram."""
    monday = _week_start(week_start_input)
    week_end = monday + timedelta(days=7)

    staff = list(User.objects.filter(is_active=True).exclude(role=Role.ATTACHEE).values('id', 'department'))
    attachees = list(User.objects.filter(is_active=True, role=Role.ATTACHEE).values('id', 'department'))
    week_tasks = list(WorkTask.objects.filter(date__gte=monday, date__lt=week_end).values('user_id', 'status'))

    def by_department(users: list[dict]) -> list[dict]:
        counts: dict[str, int] = {}
        for u in users:
            key = u['department'] or 'UNASSIGNED'
            counts[key] = counts.get(key, 0) + 1
        return [{'department': d, 'count': c} for d, c in counts.items()]

    status_counts = {s: 0 for s in values(TaskStatus)}
    for t in week_tasks:
        status_counts[t['status']] = status_counts.get(t['status'], 0) + 1

    per_member = {u['id']: 0 for u in staff}
    for t in week_tasks:
        if t['user_id'] in per_member:
            per_member[t['user_id']] += 1

    buckets = [
        ('0', lambda n: n == 0),
        ('1-2', lambda n: 1 <= n <= 2),
        ('3-5', lambda n: 3 <= n <= 5),
        ('6-8', lambda n: 6 <= n <= 8),
        ('9+', lambda n: n >= 9),
    ]
    histogram = [{'bucket': name, 'count': 0} for name, _ in buckets]
    for count in per_member.values():
        for i, (_, test) in enumerate(buckets):
            if test(count):
                histogram[i]['count'] += 1
                break

    return {
        'weekStart': monday.isoformat(),
        'membersByDepartment': by_department(staff),
        'attacheesByDepartment': by_department(attachees),
        'taskStatusDistribution': [{'status': s, 'count': c} for s, c in status_counts.items()],
        'taskLoadHistogram': histogram,
    }


def get_my_time_stats(user_id: str, from_: str | None = None, to: str | None = None) -> dict:
    """Where the signed-in user's hours concentrate across verticals/categories (sidebar tracker)."""
    end = _require_date(to) if to else utcnow().date()
    start = _require_date(from_) if from_ else end - timedelta(days=29)

    tasks = WorkTask.objects.filter(user_id=user_id, date__gte=start, date__lte=end).values('vertical', 'category', 'hours_spent')

    vertical_hours = {v: 0.0 for v in values(TaskVertical)}
    category_hours = {c: 0.0 for c in values(TaskCategory)}
    total_hours, task_count = 0.0, 0
    for t in tasks:
        total_hours += t['hours_spent']
        task_count += 1
        vertical_hours[t['vertical']] = vertical_hours.get(t['vertical'], 0) + t['hours_spent']
        category_hours[t['category']] = category_hours.get(t['category'], 0) + t['hours_spent']

    def to_buckets(hours_by_key: dict[str, float]) -> list[dict]:
        buckets = [
            {
                'key': key,
                'hours': _round2(hours),
                'sharePct': js_round(hours / total_hours * 1000) / 10 if total_hours > 0 else 0,
            }
            for key, hours in hours_by_key.items()
        ]
        return sorted(buckets, key=lambda b: b['hours'], reverse=True)  # stable, like Array.sort

    by_vertical = to_buckets(vertical_hours)
    by_category = to_buckets(category_hours)
    active_verticals = [b for b in by_vertical if b['hours'] > 0]
    active_categories = [b for b in by_category if b['hours'] > 0]
    top_vertical = active_verticals[0] if active_verticals else None
    top_category = active_categories[0] if active_categories else None

    # Herfindahl-Hirschman style concentration on vertical shares (0 = even, 1 = all in one).
    hhi = sum((b['hours'] / total_hours) ** 2 for b in active_verticals) if total_hours > 0 else 0
    balance_score = js_round((1 - hhi) * 100) if total_hours > 0 else 0

    if total_hours <= 0:
        balance_label = 'none'
    elif balance_score >= 70:
        balance_label = 'well_rounded'
    elif balance_score >= 45:
        balance_label = 'balanced'
    elif balance_score >= 25:
        balance_label = 'focused'
    else:
        balance_label = 'narrow'

    neglected = [b['key'] for b in by_vertical if b['hours'] == 0][:3]
    stretch = [k for k in reversed([b['key'] for b in active_verticals][-3:]) if k != (top_vertical or {}).get('key')][:2]

    insight = 'Log a few tasks to see where your time concentrates.'
    if total_hours > 0 and top_vertical:
        share = js_round(top_vertical['sharePct'])
        if balance_label in ('narrow', 'focused'):
            nudge = neglected[0] if neglected else (stretch[0] if stretch else None)
            insight = (
                f'{share}% of your hours sit in one vertical. Stretch into underused areas to stay well-rounded.'
                if nudge else
                f'{share}% of your hours sit in one vertical. Mix in other verticals when you can.'
            )
        elif balance_label == 'balanced':
            insight = f'Solid spread across {len(active_verticals)} verticals. Keep sampling categories outside your usual work.'
        else:
            insight = (f'Nice range: time logged across {len(active_verticals)} verticals '
                       f'and {len(active_categories)} categories.')

    return {
        'from': iso_day(start),
        'to': iso_day(end),
        'totalHours': _round2(total_hours),
        'taskCount': task_count,
        'balanceScore': balance_score,
        'balanceLabel': balance_label,
        'insight': insight,
        'topVertical': {'vertical': top_vertical['key'], 'hours': top_vertical['hours'], 'sharePct': top_vertical['sharePct']}
        if top_vertical else None,
        'topCategory': {'category': top_category['key'], 'hours': top_category['hours'], 'sharePct': top_category['sharePct']}
        if top_category else None,
        'byVertical': [{'vertical': b['key'], 'hours': b['hours'], 'sharePct': b['sharePct']} for b in by_vertical],
        'byCategory': [{'category': b['key'], 'hours': b['hours'], 'sharePct': b['sharePct']} for b in by_category],
        'neglectedVerticals': neglected,
    }
