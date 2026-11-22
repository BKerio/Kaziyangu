"""Mounted at /campaigns - admin-only broadcasts to staff over WhatsApp and SMS."""
from core import validation as v
from core.auth import authenticate, require_role
from core.dates import js_parse_int
from core.enums import MANAGER_ROLES, Department, Role
from core.http import ok, ok_spread, request_json
from core.router import Router

from . import service
from .service import MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH

audience_schema = v.obj(
    everyone=v.boolean().with_default(False),
    roles=v.array(v.enum(Role)).with_default(list),
    departments=v.array(v.enum(Department)).with_default(list),
    userIds=v.array(v.uuid(), max=500).with_default(list),
)

create_campaign_schema = v.obj(
    title=v.string(min=1, min_msg='Add a title', max=MAX_TITLE_LENGTH),
    message=v.string(min=1, min_msg='Write a message', max=MAX_MESSAGE_LENGTH),
    channels=v.array(v.enum(['WHATSAPP', 'SMS']), min=1, min_msg='Choose at least one channel'),
    audience=audience_schema,
)


def build_router() -> Router:
    router = Router()
    router.use(authenticate)
    router.use(require_role(MANAGER_ROLES))

    @router.get('/options')
    def options(request):
        """Channels the server can send on, plus the people picker list."""
        return ok({
            'channels': service.available_channels(),
            'people': service.list_people(),
            'limits': {'title': MAX_TITLE_LENGTH, 'message': MAX_MESSAGE_LENGTH},
        })

    @router.post('/preview')
    def preview(request):
        """How many people an audience reaches, before sending."""
        audience = v.parse(audience_schema, request_json(request))
        return ok(service.preview_audience(audience))

    @router.get('/')
    def list_campaigns(request):
        page = max(1, js_parse_int(request.GET.get('page', '1'), 1) or 1)
        limit = min(50, max(1, js_parse_int(request.GET.get('limit', '10'), 10) or 10))
        return ok_spread(service.list_campaigns(page, limit))

    @router.get('/:id')
    def get_campaign(request, id):
        return ok(service.get(id))

    @router.post('/')
    def create(request):
        """Create and start sending. Returns at once; poll GET /campaigns/:id for progress."""
        data = v.parse(create_campaign_schema, request_json(request))
        return ok(service.create(request.actor.user_id, data), 201)

    return router
