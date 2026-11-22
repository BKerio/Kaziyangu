"""The mount table - the `app.use(prefix, router)` lines of backend/src/app.ts."""
from core.app import App

from .admin.routes import build_router as admin_routes
from .attachments.routes import build_router as attachment_routes
from .auth.routes import build_router as auth_routes
from .campaigns.routes import build_router as campaign_routes
from .opportunities.routes import build_router as opportunity_routes
from .reminders.routes import build_router as reminder_routes
from .settings.routes import build_router as settings_routes
from .tasks.routes import build_router as task_routes
from .team_calendar.routes import build_router as team_calendar_routes
from .whatsapp.routes import build_router as whatsapp_routes


def register_routes(app: App) -> None:
    # Mounted at both paths: /auth is this app's convention, and /api/auth is
    # where MICROSOFT_REDIRECT_URI (registered in Azure) points the callback.
    auth = auth_routes()
    app.mount('/auth', auth)
    app.mount('/api/auth', auth)
    app.mount('/admin', admin_routes())
    app.mount('/tasks', task_routes())
    app.mount('/attachments', attachment_routes())
    app.mount('/opportunities', opportunity_routes())
    app.mount('/team-calendar', team_calendar_routes())
    app.mount('/reminders', reminder_routes())
    app.mount('/campaigns', campaign_routes())
    app.mount('/settings', settings_routes())

    # /api/whatsapp is kept as an alias: it's the callback URL already
    # configured in the Meta App dashboard.
    whatsapp = whatsapp_routes()
    app.mount('/whatsapp', whatsapp)
    app.mount('/api/whatsapp', whatsapp)
