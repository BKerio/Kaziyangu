"""Mounted at /opportunities - shared team pipeline; deleting is manager-only."""
from django.http import HttpResponse

from core import validation as v
from core.auth import authenticate, require_role
from core.enums import MANAGER_ROLES, STAFF_ROLES, ActivityType, OpportunityPriority, OpportunityStage
from core.errors import BadRequestError, NotFoundError
from core.http import encode_uri_component, ok, ok_spread, page_limit, query, request_json
from core.router import Router
from core.upload import UploadedFile, read_files

from . import attachment_service, service
from .attachment_constants import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_FILES_PER_UPLOAD,
    canonical_opportunity_mime,
    is_allowed_opportunity_file,
)

create_schema = v.obj(
    name=v.string(min=2, min_msg='Opportunity name is required'),
    customerName=v.string(min=1, min_msg='Customer / organization is required'),
    contactPerson=v.string().optional(),
    source=v.string().optional(),
    dateIdentified=v.string(min=1, min_msg='Date identified is required'),
    estimatedValue=v.number(min=0).optional(),
    description=v.string().optional(),
    priority=v.enum(OpportunityPriority).optional(),
    assignedToId=v.uuid().optional(),
    followUpDate=v.string().optional(),
)

update_schema = create_schema.partial().extend(
    stage=v.enum(OpportunityStage).optional(),
    isGenuine=v.boolean().optional(),
    customerNeed=v.string().optional(),
    budgetConfirmed=v.string().optional(),
    decisionMaker=v.string().optional(),
    expectedTimeline=v.string().optional(),
    probability=v.integer(min=0, max=100).optional(),
    proposalSubmittedDate=v.string().optional(),
    proposedValue=v.number(min=0).optional(),
    expectedClosingDate=v.string().optional(),
    customerFeedback=v.string().optional(),
    revisedValue=v.number(min=0).optional(),
    negotiationNotes=v.string().optional(),
    competitors=v.string().optional(),
    finalValue=v.number(min=0).optional(),
    contractNumber=v.string().optional(),
    closingDate=v.string().optional(),
    reasonLost=v.string().optional(),
    competitorSelected=v.string().optional(),
    lostValue=v.number(min=0).optional(),
    lessonsLearned=v.string().optional(),
)

activity_schema = v.obj(
    type=v.enum(ActivityType),
    date=v.string(min=1, min_msg='Date is required'),
    notes=v.string().optional(),
)


def build_router() -> Router:
    router = Router()
    router.use(authenticate)
    router.use(require_role(STAFF_ROLES))

    @router.get('/stats')
    def stats(request):
        return ok(service.get_stats())

    @router.get('/')
    def list_opportunities(request):
        page, limit = page_limit(request)
        return ok_spread(service.list_opportunities(
            stage=query(request, 'stage'), priority=query(request, 'priority'),
            assigned_to_id=query(request, 'assignedToId'), search=query(request, 'search'), page=page, limit=limit,
        ))

    @router.get('/:id')
    def get_opportunity(request, id):
        return ok(service.get_by_id(id))

    @router.post('/')
    def create_opportunity(request):
        data = v.parse(create_schema, request_json(request))
        return ok(service.create(data, request.actor.user_id), 201)

    @router.patch('/:id')
    def update_opportunity(request, id):
        data = v.parse(update_schema, request_json(request))
        return ok(service.update(id, data, request.actor.user_id))

    @router.delete('/:id', require_role(MANAGER_ROLES))
    def delete_opportunity(request, id):
        service.delete(id, request.actor.user_id)
        return ok()

    @router.post('/:id/activities')
    def log_activity(request, id):
        data = v.parse(activity_schema, request_json(request))
        return ok(service.log_activity(id, data, request.actor.user_id), 201)

    @router.get('/:id/attachments')
    def list_attachments(request, id):
        return ok(attachment_service.list_attachments(id))

    @router.post('/:id/attachments')
    def add_attachments(request, id):
        files = read_files(request, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILES_PER_UPLOAD,
                           is_allowed_opportunity_file, ALLOWED_ATTACHMENT_EXTENSIONS)
        if not files:
            raise BadRequestError('At least one file is required')
        files = [
            UploadedFile(f.buffer, canonical_opportunity_mime(f.mime_type, f.original_name), f.original_name, f.size)
            for f in files
        ]
        return ok(attachment_service.add_many(id, request.actor.user_id, files), 201)

    @router.get('/:id/attachments/:attachmentId/file')
    def attachment_file(request, id, attachmentId):
        attachment, path = attachment_service.get_file(id, attachmentId)
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            raise NotFoundError('Attachment file') from None
        disposition = 'inline' if attachment.mime_type == 'application/pdf' else 'attachment'
        response = HttpResponse(content, content_type=attachment.mime_type)
        response['Content-Disposition'] = f'{disposition}; filename="{encode_uri_component(attachment.file_name)}"'
        return response

    @router.delete('/:id/attachments/:attachmentId')
    def delete_attachment(request, id, attachmentId):
        attachment_service.remove(id, attachmentId, request.actor.user_id)
        return ok()

    return router
