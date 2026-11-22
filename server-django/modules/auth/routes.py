"""Mounted at /auth and /api/auth (backend/src/modules/auth/auth.routes.ts)."""
from datetime import timedelta

from django.http import HttpResponseRedirect

from core import validation as v
from core.auth import authenticate
from core.dates import iso, js_parse_int, utcnow
from core.env import env, frontend_origin
from core.http import encode_uri_component as quote
from core.http import ok, request_json
from core.jwt import sign_oauth_state, sign_token, verify_oauth_state
from core.logger import logger
from core.router import Router

from . import service
from .microsoft_account import MicrosoftAccountService
from .microsoft_config import is_microsoft_auth_enabled
from .microsoft_oauth import MicrosoftOAuthService
from .models import User


def _safe_redirect_path(path) -> str | None:
    """Only ever follow a same-app relative path - never an absolute/protocol-relative URL."""
    if not isinstance(path, str) or not path:
        return None
    if not path.startswith('/') or path.startswith('//') or '://' in path:
        return None
    return path


register_schema = v.obj(
    email=v.email('Invalid email address'),
    passwordRaw=v.string(min=8, min_msg='Password must be at least 8 characters'),
    name=v.string(min=2, min_msg='Name must be at least 2 characters'),
    phone=v.string().optional(),
)

login_schema = v.obj(
    email=v.email('Invalid email address'),
    passwordRaw=v.string(min=1, min_msg='Password is required'),
)

update_me_schema = v.obj(
    [(lambda d: not d.get('newPassword') or bool(d.get('currentPassword')),
      'Current password is required to set a new password')],
    name=v.string(min=2, min_msg='Name must be at least 2 characters').optional(),
    phone=v.string().optional(),
    currentPassword=v.string().optional(),
    newPassword=v.string(min=8, min_msg='Password must be at least 8 characters').optional(),
)


def build_router() -> Router:
    router = Router()

    @router.post('/register')
    def register(request):
        data = v.parse(register_schema, request_json(request))
        user = service.register(data['email'], data['passwordRaw'], data['name'], data.get('phone'))
        return ok(user, 201)

    @router.post('/login')
    def login(request):
        data = v.parse(login_schema, request_json(request))
        return ok(service.login(data['email'], data['passwordRaw']))

    @router.get('/me', authenticate)
    def me(request):
        return ok(service.get_profile(request.actor.user_id))

    @router.patch('/me', authenticate)
    def update_me(request):
        data = v.parse(update_me_schema, request_json(request))
        return ok(service.update_profile(request.actor.user_id, data))

    # ── "Login with Outlook" - opt-in; routes only exist when every MICROSOFT_*
    #    env var is set. The account must already exist (matched by email):
    #    this signs into an existing account rather than creating one. A
    #    successful login with offline_access also (re)connects the calendar.
    if is_microsoft_auth_enabled(env):
        microsoft = MicrosoftOAuthService(env)
        accounts = MicrosoftAccountService(microsoft)
        # Falls back to the local dev origin when CORS_ORIGIN isn't a real URL
        # - which would strand every deployed user on their own localhost after
        # login, so warn loudly at startup instead.
        origin = frontend_origin()
        if origin is None:
            logger.warn(
                "Microsoft login is enabled but CORS_ORIGIN is not a real URL - post-login redirects will fall back "
                "to http://localhost:5173, which only works for local development. Set CORS_ORIGIN to this server's "
                'actual frontend URL (e.g. https://app.example.com) in any deployed environment.',
                corsOrigin=env.CORS_ORIGIN,
            )
        origin = origin or 'http://localhost:5173'

        @router.get('/microsoft/login')
        def microsoft_login(request):
            redirect_path = _safe_redirect_path(request.GET.get('redirect'))
            return HttpResponseRedirect(microsoft.build_authorization_url(sign_oauth_state(redirect_path)))

        # Must exactly match MICROSOFT_REDIRECT_URI as registered in Azure -
        # this router is also mounted at /api/auth for that reason.
        @router.get('/microsoft/callback')
        def microsoft_callback(request):
            code, state, error = request.GET.get('code'), request.GET.get('state'), request.GET.get('error')
            parsed_state = verify_oauth_state(state) if state else None
            if error or not code or not parsed_state:
                return HttpResponseRedirect(f'{origin}/login?error=microsoft_auth_failed')

            tokens = microsoft.exchange_code_for_tokens(code)
            profile = microsoft.fetch_profile(tokens.access_token) if tokens else None
            if not tokens or not profile:
                return HttpResponseRedirect(f'{origin}/login?error=microsoft_auth_failed')

            # Case-insensitive: we don't control how Microsoft capitalizes the email.
            user = User.objects.filter(email__iexact=profile['email']).first()
            if user is None or not user.is_active:
                return HttpResponseRedirect(f"{origin}/login?error=no_account&email={quote(profile['email'])}")

            accounts.save_tokens(user.id, tokens.refresh_token, tokens.scope)
            app_token = sign_token(user.id, user.role)
            redirect_path = parsed_state.get('redirectPath')
            redirect_query = f"&redirect={quote(redirect_path)}" if redirect_path else ''
            return HttpResponseRedirect(f"{origin}/auth/callback?token={quote(app_token)}{redirect_query}")

        @router.get('/microsoft/status', authenticate)
        def microsoft_status(request):
            return ok({'connected': accounts.is_connected(request.actor.user_id)})

        @router.delete('/microsoft/connection', authenticate)
        def microsoft_disconnect(request):
            accounts.disconnect(request.actor.user_id)
            return ok()

        @router.get('/microsoft/calendar', authenticate)
        def microsoft_calendar(request):
            """
            ?days=14&pastDays=7 - the user's own Outlook events from `pastDays`
            ago through `days` ahead, plus their own inbox's unread count.
            """
            access_token = accounts.get_valid_access_token(request.actor.user_id)
            if not access_token:
                return ok({'connected': False, 'events': [], 'unreadCount': None})

            days = min(max(js_parse_int(request.GET.get('days', '14'), 14) or 14, 1), 60)
            past_days = min(max(js_parse_int(request.GET.get('pastDays', '0'), 0) or 0, 0), 30)
            now = utcnow()
            start, end = now - timedelta(days=past_days), now + timedelta(days=days)
            events = microsoft.fetch_calendar_events(access_token, iso(start), iso(end))
            unread = microsoft.fetch_unread_count(access_token)
            return ok({'connected': True, 'events': events or [], 'unreadCount': unread})

    return router
