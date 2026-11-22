from core.enums import Role
from core.errors import ForbiddenError
from core.jwt import Actor
from modules.auth.models import User


def assert_can_manage_attachee(attachee_id: str, actor: Actor) -> None:
    """
    ADMIN/SUPER_ADMIN may manage any attachee's records; a STAFF actor only
    those of an attachee they supervise. Shared by attendance and logbook so
    a supervisor's verify/review rights stay consistent across both.
    """
    if actor.role in (Role.ADMIN, Role.SUPER_ADMIN):
        return
    if actor.role == Role.STAFF:
        supervisor_id = User.objects.filter(id=attachee_id).values_list('supervisor_id', flat=True).first()
        if supervisor_id == actor.user_id:
            return
    raise ForbiddenError('You do not supervise this attachee')
