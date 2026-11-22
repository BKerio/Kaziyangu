"""Mounted at /tasks (backend/src/modules/tasks/task.routes.ts)."""
from django.http import HttpResponse

from core import validation as v
from core.auth import authenticate, require_role
from core.enums import MANAGER_ROLES, Organization, TaskCategory, TaskStatus, TaskVertical
from core.errors import BadRequestError, NotFoundError
from core.http import encode_uri_component, ok, ok_spread, page_limit, query, request_json
from core.router import Router
from core.upload import read_files

from . import attachment_service, service
from .attachment_constants import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_FILES_PER_UPLOAD,
    is_allowed_task_file,
)
from .options import get_task_options

create_task_schema = v.obj(
    date=v.string(min=1, min_msg='Date is required'),
    vertical=v.enum(TaskVertical),
    category=v.enum(TaskCategory),
    description=v.string(min=3, min_msg='Task description is required'),
    organization=v.enum(Organization).optional(),
    customerProject=v.string().optional(),
    startTime=v.string().optional(),
    endTime=v.string().optional(),
    hoursSpent=v.number(min=0, max=24).optional(),
    status=v.enum(TaskStatus).optional(),
    percentComplete=v.integer(min=0, max=100).optional(),
    keyDeliverable=v.string().optional(),
    blockersNotes=v.string().optional(),
    userId=v.uuid().optional(),
)

update_task_schema = create_task_schema.omit('userId').partial()


def build_router() -> Router:
    router = Router()
    router.use(authenticate)

    @router.get('/options')
    def options(request):
        """Vertical / category / status / organization dropdowns with display labels."""
        return ok(get_task_options())

    @router.get('/my-stats')
    def my_stats(request):
        """?from=&to= - the signed-in user's vertical/category hour mix. Defaults to the last 30 days."""
        return ok(service.get_my_time_stats(request.actor.user_id, query(request, 'from'), query(request, 'to')))

    @router.get('/reports/resource-weekly', require_role(MANAGER_ROLES))
    def resource_weekly(request):
        return ok(service.get_resource_weekly_report(query(request, 'weekStart')))

    @router.get('/reports/vertical-weekly', require_role(MANAGER_ROLES))
    def vertical_weekly(request):
        return ok(service.get_vertical_weekly_summary(query(request, 'weekStart')))

    @router.get('/reports/org-overview', require_role(MANAGER_ROLES))
    def org_overview(request):
        return ok(service.get_org_overview(query(request, 'weekStart')))

    @router.post('/')
    def create_task(request):
        """Staff log their own tasks; Admin/Super Admin may pass `userId` to log on someone's behalf."""
        data = v.parse(create_task_schema, request_json(request))
        return ok(service.create_task(request.actor, data), 201)

    @router.get('/')
    def list_tasks(request):
        """?userId=&vertical=&category=&status=&from=&to=&page=&limit="""
        page, limit = page_limit(request)
        return ok_spread(service.get_tasks(
            request.actor,
            user_id=query(request, 'userId'), vertical=query(request, 'vertical'),
            category=query(request, 'category'), status=query(request, 'status'),
            from_=query(request, 'from'), to=query(request, 'to'), page=page, limit=limit,
        ))

    @router.get('/:id')
    def get_task(request, id):
        return ok(service.get_task_by_id(id, request.actor))

    @router.patch('/:id')
    def update_task(request, id):
        data = v.parse(update_task_schema, request_json(request))
        return ok(service.update_task(id, request.actor, data))

    @router.delete('/:id')
    def delete_task(request, id):
        service.delete_task(id, request.actor)
        return ok()

    # ── Attachments - proof-of-work files. Same ownership rule as the task. ──

    @router.get('/:id/attachments')
    def list_attachments(request, id):
        return ok(attachment_service.list_attachments(id, request.actor))

    @router.post('/:id/attachments')
    def add_attachments(request, id):
        """Multipart, field name "files" (up to 5 at a time)."""
        files = read_files(request, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILES_PER_UPLOAD,
                           is_allowed_task_file, ALLOWED_ATTACHMENT_EXTENSIONS)
        if not files:
            raise BadRequestError('At least one file is required')
        return ok(attachment_service.add_many(id, request.actor, files), 201)

    @router.get('/:id/attachments/:attachmentId/file')
    def attachment_file(request, id, attachmentId):
        """Streams the raw file, viewable in an <img>/<iframe>."""
        attachment, path = attachment_service.get_file(id, attachmentId, request.actor)
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            raise NotFoundError('Attachment file') from None
        response = HttpResponse(content, content_type=attachment.mime_type)
        response['Content-Disposition'] = f'inline; filename="{encode_uri_component(attachment.file_name)}"'
        # The frontend embeds this in its own <iframe> (a PDF preview), which
        # X-Frame-Options: SAMEORIGIN would otherwise block.
        response.allow_framing = True
        return response

    @router.delete('/:id/attachments/:attachmentId')
    def delete_attachment(request, id, attachmentId):
        attachment_service.remove(id, attachmentId, request.actor)
        return ok()

    return router
