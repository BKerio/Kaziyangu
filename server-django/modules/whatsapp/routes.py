"""
Mounted at /whatsapp and /api/whatsapp. Registers no routes at all unless
every WhatsApp env var is set, so an unconfigured deployment doesn't expose a
dead webhook.
"""
import json

from django.http import HttpResponse

from core.background import run_in_background
from core.env import env
from core.logger import logger
from core.router import Router

from .bot import WhatsAppBot
from .client import WhatsAppClient
from .config import is_whatsapp_enabled


def build_router() -> Router:
    router = Router()
    if not is_whatsapp_enabled(env):
        logger.warn('WhatsApp bot disabled - set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN to enable.')
        return router

    bot = WhatsAppBot(WhatsAppClient(env))

    @router.get('/webhook')
    def verify(request):
        """Meta's one-time webhook verification handshake."""
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge')
        if mode == 'subscribe' and token == env.WHATSAPP_VERIFY_TOKEN and challenge is not None:
            return HttpResponse(challenge, content_type='text/plain; charset=utf-8')
        return HttpResponse('Forbidden', status=403, content_type='text/plain; charset=utf-8')

    @router.post('/webhook')
    def receive(request):
        """
        Meta requires a fast 200 ack; messages are handled after the response
        is sent so a slow reply from us never causes Meta to retry.
        """
        try:
            payload = json.loads(request.body or b'{}')
        except (ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict):
            run_in_background(lambda: bot.process_webhook(payload), name='whatsapp-webhook')
        return HttpResponse('OK', content_type='text/plain; charset=utf-8')

    return router
