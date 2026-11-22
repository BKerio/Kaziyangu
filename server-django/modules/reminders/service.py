"""
Task reminders (backend/src/modules/reminders/reminder.service.ts): one per
task, sent on the chosen channels at each chosen time, polled once a minute
by scheduler.py.
"""
from datetime import datetime, timedelta

from core.dates import NAIROBI, parse_instant, utcnow
from core.db import update_row
from core.enums import MANAGER_ROLES, ReminderChannel, ReminderStatus, TaskStatus
from core.env import env
from core.errors import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from core.jwt import Actor
from core.logger import logger
from core.serialize import pick, to_dict
from modules.audit import service as audit
from modules.tasks.models import WorkTask
from modules.whatsapp.client import WhatsAppClient
from modules.whatsapp.config import is_whatsapp_enabled
from modules.whatsapp.user_lookup import to_whatsapp_number

from .config import is_email_enabled, is_sms_enabled
from .email_client import EmailClient
from .models import TaskReminder, TaskReminderLog
from .sms_client import AdvantaSmsClient

# The approved WhatsApp utility template: body params {{1}} first name, {{2}} task, {{3}} due time.
REMINDER_TEMPLATE = 'task_reminder'
REMINDER_TEMPLATE_LANGUAGE = 'en'

# Cadence for reminders created before users could pick their own times
# (empty remind_at): 30 minutes before the due time, then every 10 minutes.
LEGACY_LEAD_MINUTES = 30
LEGACY_INTERVAL_MINUTES = 10
MAX_TIMES = 5
# A time picked "now" can be a few seconds stale by the time it's saved.
PAST_GRACE = timedelta(seconds=60)

_MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')

_whatsapp = WhatsAppClient(env) if is_whatsapp_enabled(env) else None
_sms = AdvantaSmsClient(env) if is_sms_enabled(env) else None
_email = EmailClient(env) if is_email_enabled(env) else None


def _legacy_schedule(due_at: datetime, repeat_count: int) -> list[datetime]:
    first = due_at - timedelta(minutes=LEGACY_LEAD_MINUTES)
    return [first + timedelta(minutes=i * LEGACY_INTERVAL_MINUTES) for i in range(repeat_count)]


def _floor_minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


def _normalize_times(raw: list, due_at: datetime) -> list[datetime]:
    """Parses, de-duplicates (to the minute) and sorts, enforcing 1-5 future times at or before the due time."""
    by_minute: dict[datetime, datetime] = {}
    for value in raw:
        parsed = parse_instant(value)
        if parsed is None:
            raise BadRequestError('One of the reminder times is not a valid date/time')
        minute = _floor_minute(parsed)
        by_minute[minute] = minute
    times = sorted(by_minute.values())

    if not times:
        raise BadRequestError('Add at least one reminder time')
    if len(times) > MAX_TIMES:
        raise BadRequestError(f'You can set up to {MAX_TIMES} reminder times')
    if times[0] < utcnow() - PAST_GRACE:
        raise BadRequestError('Reminder times must be in the future')
    if times[-1] > due_at:
        raise BadRequestError('Reminder times must be at or before the due time')
    return times


def _parse_due_at(value: str) -> datetime:
    due_at = parse_instant(value)
    if due_at is None:
        raise BadRequestError('Invalid due date/time')
    return due_at


def _qs():
    return TaskReminder.objects.select_related('task__user')


def serialize(reminder: TaskReminder) -> dict:
    """`include: { task: { include: { user: { select: { id, name, email, phone } } } } }`."""
    task = reminder.task
    return {**to_dict(reminder), 'task': {**to_dict(task), 'user': pick(task.user, 'id', 'name', 'email', 'phone')}}


def _find_owned_task(task_id: str, actor: Actor) -> WorkTask:
    task = WorkTask.objects.filter(id=task_id).first()
    if task is None:
        raise NotFoundError('Task')
    if task.user_id != actor.user_id and actor.role not in MANAGER_ROLES:
        raise ForbiddenError('You do not have permission to set a reminder on this task')
    return task


def _find_owned_reminder(reminder_id: str, actor: Actor) -> TaskReminder:
    reminder = TaskReminder.objects.filter(id=reminder_id).first()
    if reminder is None:
        raise NotFoundError('Reminder')
    if reminder.user_id != actor.user_id and actor.role not in MANAGER_ROLES:
        raise ForbiddenError('You do not have permission to manage this reminder')
    return reminder


def _validate_channels(channels: list[str]) -> None:
    if not channels:
        raise BadRequestError('Pick at least one reminder channel')


def create_reminder(actor: Actor, data: dict) -> dict:
    _validate_channels(data['channels'])
    task = _find_owned_task(data['taskId'], actor)
    if TaskReminder.objects.filter(task_id=data['taskId']).exists():
        raise ConflictError('This task already has a reminder set - edit or delete it instead')

    due_at = _parse_due_at(data['dueAt'])
    remind_at = _normalize_times(data.get('remindAt') or _legacy_schedule(due_at, data.get('repeatCount', 1)), due_at)

    reminder = TaskReminder.objects.create(
        due_at=due_at,
        channels=data['channels'],
        remind_at=remind_at,
        repeat_count=len(remind_at),
        next_run_at=remind_at[0],
        status=ReminderStatus.SCHEDULED,
        task_id=task.id,
        user_id=task.user_id,
    )
    created = serialize(_qs().get(id=reminder.id))
    audit.record(actor.user_id, 'CREATE', 'TASK_REMINDER', reminder.id,
                 summary=f"Set reminder for task \"{task.description}\": {', '.join(data['channels'])}", new_values=created)
    return created


def list_mine(actor: Actor) -> list[dict]:
    return [serialize(r) for r in _qs().filter(user_id=actor.user_id).order_by('due_at')]


def update_reminder(reminder_id: str, actor: Actor, patch: dict) -> dict:
    reminder = _find_owned_reminder(reminder_id, actor)
    channels = patch['channels'] if 'channels' in patch else reminder.channels
    _validate_channels(channels)

    due_at = _parse_due_at(patch['dueAt']) if 'dueAt' in patch else reminder.due_at
    if 'remindAt' in patch:
        raw_times = patch['remindAt']
    elif reminder.remind_at:
        raw_times = reminder.remind_at
    else:
        raw_times = _legacy_schedule(due_at, patch.get('repeatCount', reminder.repeat_count))
    remind_at = _normalize_times(raw_times, due_at)

    old = to_dict(reminder)
    # Any edit re-arms the reminder from scratch with the new set of times.
    update_row(
        TaskReminder, reminder_id,
        due_at=due_at, channels=channels, remind_at=remind_at, repeat_count=len(remind_at),
        sent_count=0, status=ReminderStatus.SCHEDULED, next_run_at=remind_at[0],
    )
    updated = serialize(_qs().get(id=reminder_id))
    audit.record(actor.user_id, 'UPDATE', 'TASK_REMINDER', reminder_id,
                 summary=f"Updated reminder for task \"{updated['task']['description']}\"", old_values=old, new_values=updated)
    return updated


def delete_reminder(reminder_id: str, actor: Actor) -> None:
    reminder = _find_owned_reminder(reminder_id, actor)
    old = to_dict(reminder)
    reminder.delete()
    audit.record(actor.user_id, 'DELETE', 'TASK_REMINDER', reminder_id, summary='Cancelled a task reminder', old_values=old)


def _due_label(due_at: datetime) -> str:
    """`toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour, minute })`."""
    local = due_at.replace(tzinfo=None) + NAIROBI.utcoffset(None)
    return f'{local.day:02d} {_MONTHS[local.month - 1]}, {local.hour:02d}:{local.minute:02d}'


def _dispatch(reminder: TaskReminder, due_label: str) -> None:
    """One send per channel, each logged as a TaskReminderLog row. Never raises."""
    task, user = reminder.task, reminder.task.user
    message = f'Reminder: "{task.description}" is due at {due_label}.'

    for channel in reminder.channels:
        ok, error = False, None

        if channel == ReminderChannel.WHATSAPP:
            if _whatsapp is None:
                error = 'WhatsApp is not configured'
            elif not user.phone:
                error = 'No phone number on file'
            else:
                try:
                    to = to_whatsapp_number(user.phone)
                    # The approved template reaches people any time; plain text
                    # only within 24 h of their last message, so it's the fallback.
                    first_name = user.name.split(' ')[0] or user.name
                    ok = _whatsapp.send_template(to, REMINDER_TEMPLATE, REMINDER_TEMPLATE_LANGUAGE,
                                                 [first_name, task.description, due_label])
                    if not ok:
                        ok = _whatsapp.send_message(to, {'type': 'text', 'text': message})
                        if not ok:
                            error = ('WhatsApp rejected the message (template not approved yet, '
                                     'and outside the 24-hour reply window)')
                except Exception as err:  # noqa: BLE001
                    error = str(err) or 'Send failed'
        elif channel == ReminderChannel.SMS:
            if _sms is None:
                error = 'SMS is not configured'
            elif not user.phone:
                error = 'No phone number on file'
            else:
                ok = _sms.send_sms(user.phone, message)
                if not ok:
                    error = 'SMS gateway rejected the message'
        elif channel == ReminderChannel.EMAIL:
            if _email is None:
                error = 'Email is not configured'
            else:
                ok = _email.send_mail(user.email, 'Task reminder', message)
                if not ok:
                    error = 'SMTP send failed'

        if not ok:
            logger.warn('Reminder channel send failed', reminderId=reminder.id, channel=channel, error=error)
        TaskReminderLog.objects.create(reminder_id=reminder.id, channel=channel, status='SENT' if ok else 'FAILED', error=error)


def run_due_reminders() -> None:
    """
    Fires every reminder whose next_run_at has passed, then moves it to its
    next chosen time (legacy rows: 10 minutes later) or marks it DONE. Times
    missed while the server was down collapse into one send, not a burst. A
    task marked COMPLETED_CLOSED stops its reminder without sending.
    """
    due = _qs().filter(
        status__in=(ReminderStatus.SCHEDULED, ReminderStatus.ACTIVE), next_run_at__lte=utcnow()
    )
    for reminder in due:
        if reminder.task.status == TaskStatus.COMPLETED_CLOSED:
            update_row(TaskReminder, reminder.id, status=ReminderStatus.DONE, next_run_at=None)
            continue

        _dispatch(reminder, _due_label(reminder.due_at))

        sent_count = reminder.sent_count + 1
        now = utcnow()
        if reminder.remind_at:
            next_run_at = next((t for t in reminder.remind_at if t > now), None)
        elif sent_count < reminder.repeat_count:
            next_run_at = now + timedelta(minutes=LEGACY_INTERVAL_MINUTES)
        else:
            next_run_at = None

        update_row(
            TaskReminder, reminder.id,
            sent_count=sent_count,
            status=ReminderStatus.ACTIVE if next_run_at else ReminderStatus.DONE,
            next_run_at=next_run_at,
        )
