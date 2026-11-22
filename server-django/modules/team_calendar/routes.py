"""Mounted at /team-calendar - any internal staff member can see and mark themselves."""
from core import validation as v
from core.auth import authenticate, require_role
from core.enums import STAFF_ROLES
from core.errors import BadRequestError
from core.http import ok, query, request_json
from core.router import Router

from . import service

mark_out_schema = v.obj(
    dates=v.array(v.string(min=1), min=1, min_msg='Select at least one date'),
    reason=v.string(trim=True, min=2, min_msg='Add a brief reason', max=200, max_msg='Keep the reason under 200 characters'),
)


def build_router() -> Router:
    router = Router()
    router.use(authenticate)
    router.use(require_role(STAFF_ROLES))

    @router.get('/roster')
    def roster(request):
        """Active staff/admin names for the dashboard's "who's active" widget."""
        return ok(service.roster())

    @router.get('/')
    def list_entries(request):
        """?from=YYYY-MM-DD&to=YYYY-MM-DD"""
        start, end = query(request, 'from'), query(request, 'to')
        if not start or not end:
            raise BadRequestError('from and to are required')
        return ok(service.list_entries(start, end))

    @router.post('/')
    def mark_out(request):
        data = v.parse(mark_out_schema, request_json(request))
        return ok(service.mark_out(request.actor.user_id, data['dates'], data['reason']), 201)

    @router.delete('/:id')
    def remove(request, id):
        service.remove(id, request.actor)
        return ok()

    return router
