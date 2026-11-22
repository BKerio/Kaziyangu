"""Mounted at /attachments (backend/src/modules/attachments/attachment.routes.ts)."""
from core import validation as v
from core.auth import authenticate, require_role
from core.enums import MANAGER_ROLES, AttendanceStatus, Department, ReportStatus, Role, WorkMode
from core.http import ok, ok_spread, page_limit, query, request_json
from core.router import Router

from . import attachee_service, attendance_service, logbook_service

# Attachees may view/log their own attendance & logbook alongside managers.
SELF_SERVICE_ROLES = (Role.ADMIN, Role.SUPER_ADMIN, Role.ATTACHEE)
# A supervising STAFF member may also view (scoped to their own attachees)
# and verify/review - enforced per record in the services.
VIEW_ROLES = (Role.ADMIN, Role.SUPER_ADMIN, Role.ATTACHEE, Role.STAFF)
REVIEW_ROLES = (Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF)

create_attachee_schema = v.obj(
    name=v.string(min=2),
    email=v.email(),
    passwordRaw=v.string(min=6, min_msg='Password must be at least 6 characters'),
    registrationNo=v.string(min=1, min_msg='Registration number is required'),
    course=v.string(min=1, min_msg='Course is required'),
    department=v.enum(Department),
    organization=v.string(min=1, min_msg='Host organization is required'),
    supervisorId=v.uuid().optional(),
    attachmentStart=v.string().optional(),
    attachmentEnd=v.string().optional(),
    phone=v.string().optional(),
)

update_attachee_schema = create_attachee_schema.omit('passwordRaw', 'supervisorId').partial().extend(
    password=v.string(min=6).optional(),
    isActive=v.boolean().optional(),
    # null explicitly unassigns the supervisor; omitted leaves it unchanged.
    supervisorId=v.uuid().nullable().optional(),
)

create_attendance_schema = v.obj(
    attacheeId=v.uuid(),
    date=v.string(min=1, min_msg='Date is required'),
    status=v.enum(AttendanceStatus).optional(),
    checkInTime=v.string().optional(),
    checkOutTime=v.string().optional(),
    workMode=v.enum(WorkMode).optional(),
    notes=v.string().optional(),
)

update_attendance_schema = create_attendance_schema.omit('attacheeId').partial().extend(
    verifiedBySupervisor=v.boolean().optional(),
)

create_report_schema = v.obj(
    attacheeId=v.uuid(),
    date=v.string(min=1, min_msg='Date is required'),
    title=v.string(min=2, min_msg='Title is required'),
    description=v.string(min=3, min_msg='Description is required'),
    learnings=v.string().optional(),
    category=v.string().optional(),
    hoursSpent=v.number(min=0, max=24).optional(),
)

update_report_schema = create_report_schema.omit('attacheeId').partial().extend(
    status=v.enum(ReportStatus).optional(),
    rating=v.integer(min=0, max=100).optional(),
    feedback=v.string().optional(),
    supervisorName=v.string().optional(),
)


def _scope(request) -> tuple[str | None, str | None]:
    """Attachees only ever see their own records; a supervising STAFF member only their attachees'."""
    actor = request.actor
    attachee_id = actor.user_id if actor.role == Role.ATTACHEE else query(request, 'attacheeId')
    supervisor_id = actor.user_id if actor.role == Role.STAFF else None
    return attachee_id, supervisor_id


def build_router() -> Router:
    router = Router()
    router.use(authenticate)

    # ── Attachees (roster) - manager-only ─────────────────────────────────────

    @router.get('/attachees', require_role(MANAGER_ROLES))
    def list_attachees(request):
        page, limit = page_limit(request)
        return ok_spread(attachee_service.list_attachees(query(request, 'search'), page, limit))

    @router.get('/attachees/:id', require_role(MANAGER_ROLES))
    def get_attachee(request, id):
        return ok(attachee_service.get_by_id(id))

    @router.post('/attachees', require_role(MANAGER_ROLES))
    def create_attachee(request):
        data = v.parse(create_attachee_schema, request_json(request))
        return ok(attachee_service.create(data, request.actor.user_id), 201)

    @router.patch('/attachees/:id', require_role(MANAGER_ROLES))
    def update_attachee(request, id):
        data = v.parse(update_attachee_schema, request_json(request))
        return ok(attachee_service.update(id, data, request.actor.user_id))

    @router.delete('/attachees/:id', require_role(MANAGER_ROLES))
    def delete_attachee(request, id):
        attachee_service.delete(id, request.actor.user_id)
        return ok()

    # ── My Attachees - the roster a supervising staff member (or manager) owns ─

    @router.get('/my-attachees', require_role(REVIEW_ROLES))
    def my_attachees(request):
        return ok(attachee_service.list_supervised_by(request.actor.user_id))

    # ── Attendance ────────────────────────────────────────────────────────────

    @router.get('/attendance', require_role(VIEW_ROLES))
    def list_attendance(request):
        attachee_id, supervisor_id = _scope(request)
        page, limit = page_limit(request)
        return ok_spread(attendance_service.list_records(
            attachee_id=attachee_id, supervisor_id=supervisor_id, status=query(request, 'status'),
            from_=query(request, 'from'), to=query(request, 'to'), page=page, limit=limit,
        ))

    @router.post('/attendance', require_role(SELF_SERVICE_ROLES))
    def create_attendance(request):
        data = v.parse(create_attendance_schema, request_json(request))
        if request.actor.role == Role.ATTACHEE:
            data['attacheeId'] = request.actor.user_id  # attachees only log for themselves
        return ok(attendance_service.create(data, request.actor.user_id), 201)

    # Verifying: managers (any attachee) or the assigned supervisor - never the
    # attachee who submitted it. Deleting stays manager-only.
    @router.patch('/attendance/:id', require_role(REVIEW_ROLES))
    def update_attendance(request, id):
        data = v.parse(update_attendance_schema, request_json(request))
        return ok(attendance_service.update(id, data, request.actor))

    @router.delete('/attendance/:id', require_role(MANAGER_ROLES))
    def delete_attendance(request, id):
        attendance_service.delete(id, request.actor.user_id)
        return ok()

    # ── Logbook (task reports) - same access pattern as attendance ────────────

    @router.get('/reports', require_role(VIEW_ROLES))
    def list_reports(request):
        attachee_id, supervisor_id = _scope(request)
        page, limit = page_limit(request)
        return ok_spread(logbook_service.list_reports(
            attachee_id=attachee_id, supervisor_id=supervisor_id, status=query(request, 'status'), page=page, limit=limit,
        ))

    @router.post('/reports', require_role(SELF_SERVICE_ROLES))
    def create_report(request):
        data = v.parse(create_report_schema, request_json(request))
        if request.actor.role == Role.ATTACHEE:
            data['attacheeId'] = request.actor.user_id
        return ok(logbook_service.create(data, request.actor.user_id), 201)

    @router.patch('/reports/:id', require_role(REVIEW_ROLES))
    def update_report(request, id):
        data = v.parse(update_report_schema, request_json(request))
        return ok(logbook_service.update(id, data, request.actor))

    @router.delete('/reports/:id', require_role(MANAGER_ROLES))
    def delete_report(request, id):
        logbook_service.delete(id, request.actor.user_id)
        return ok()

    return router
