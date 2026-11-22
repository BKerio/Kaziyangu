"""Mounted at /settings - admin-only, read-only view of integrations."""
from core.auth import authenticate, require_role
from core.enums import MANAGER_ROLES
from core.http import ok
from core.router import Router

from .whatsapp_status import WhatsAppStatusService


def build_router() -> Router:
    router = Router()
    router.use(authenticate)
    router.use(require_role(MANAGER_ROLES))
    whatsapp = WhatsAppStatusService()

    @router.get('/whatsapp')
    def whatsapp_overview(request):
        """?refresh=1 - phone number, account, token health, templates, limits and usage."""
        return ok(whatsapp.overview(refresh=request.GET.get('refresh') == '1'))

    return router
