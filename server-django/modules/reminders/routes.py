"""Mounted at /reminders (backend/src/modules/reminders/reminder.routes.ts)."""
from core import validation as v
from core.auth import authenticate
from core.enums import ReminderChannel
from core.http import ok, request_json
from core.router import Router

from . import service

create_reminder_schema = v.obj(
    taskId=v.uuid(),
    dueAt=v.string(min=1, min_msg='Due date/time is required'),
    channels=v.array(v.enum(ReminderChannel), min=1, min_msg='Pick at least one reminder channel'),
    # The exact times to send - the service checks they're 1-5 future times at or before dueAt.
    remindAt=v.array(v.string(min=1), min=1, min_msg='Add at least one reminder time',
                     max=5, max_msg='You can set up to 5 reminder times').optional(),
    # Older clients: number of sends on the fixed 30-minutes-before cadence.
    repeatCount=v.integer(min=1, max=5).optional(),
)

update_reminder_schema = create_reminder_schema.omit('taskId').partial()


def build_router() -> Router:
    router = Router()
    router.use(authenticate)

    @router.get('/')
    def list_mine(request):
        """The signed-in user's own reminders, with their task attached."""
        return ok(service.list_mine(request.actor))

    @router.post('/')
    def create(request):
        """One reminder per task (Admin/Super Admin may set one on anyone's task)."""
        data = v.parse(create_reminder_schema, request_json(request))
        return ok(service.create_reminder(request.actor, data), 201)

    @router.patch('/:id')
    def update(request, id):
        data = v.parse(update_reminder_schema, request_json(request))
        return ok(service.update_reminder(id, request.actor, data))

    @router.delete('/:id')
    def delete(request, id):
        service.delete_reminder(id, request.actor)
        return ok()

    return router
