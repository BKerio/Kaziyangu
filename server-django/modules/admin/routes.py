"""Mounted at /admin - Admin/Super Admin only (backend/src/modules/admin/admin.routes.ts)."""
from core import validation as v
from core.auth import authenticate, require_role
from core.enums import MANAGER_ROLES, STAFF_ROLES, Department
from core.http import ok, ok_spread, page_limit, query, request_json
from core.router import Router
from modules.audit import service as audit

from . import service

# Attachees are created through the attachments module, which also fills in
# their profile fields - this generic staff endpoint can't assign that role.
create_user_schema = v.obj(
    email=v.email(),
    passwordRaw=v.string(min=8, min_msg='Password must be at least 8 characters'),
    name=v.string(min=2),
    role=v.enum(STAFF_ROLES),
    phone=v.string().optional(),
    department=v.enum(Department).optional(),
)

update_user_schema = v.obj(
    name=v.string(min=2).optional(),
    email=v.email().optional(),
    password=v.string(min=8, min_msg='Password must be at least 8 characters').optional(),
    phone=v.string().optional(),
    role=v.enum(STAFF_ROLES).optional(),
    isActive=v.boolean().optional(),
    department=v.enum(Department).optional(),
)


def build_router() -> Router:
    router = Router()
    router.use(authenticate)
    router.use(require_role(MANAGER_ROLES))

    @router.get('/users')
    def list_users(request):
        page, limit = page_limit(request)
        return ok_spread(service.list_users(query(request, 'role'), page, limit))

    @router.get('/users/:id')
    def get_user(request, id):
        return ok(service.get_user_by_id(id))

    @router.post('/users')
    def create_user(request):
        data = v.parse(create_user_schema, request_json(request))
        return ok(service.create_user(data, request.actor.user_id), 201)

    @router.patch('/users/:id')
    def update_user(request, id):
        data = v.parse(update_user_schema, request_json(request))
        return ok(service.update_user(id, data, request.actor.user_id))

    @router.delete('/users/:id')
    def delete_user(request, id):
        service.delete_user(id, request.actor.user_id)
        return ok()

    @router.get('/audit-logs')
    def audit_logs(request):
        """?userId=&action=&subjectType=&from=&to=&page=&limit= - the system-wide activity trail."""
        page, limit = page_limit(request)
        return ok_spread(audit.list_logs(
            user_id=query(request, 'userId'), action=query(request, 'action'),
            subject_type=query(request, 'subjectType'), from_=query(request, 'from'), to=query(request, 'to'),
            page=page, limit=limit,
        ))

    return router
