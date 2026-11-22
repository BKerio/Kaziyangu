"""`python manage.py subscribe_waba` - subscribe this Meta app to the WhatsApp Business Account's webhooks."""
import httpx
from django.core.management.base import BaseCommand, CommandError

from core.env import env


class Command(BaseCommand):
    help = 'Subscribe the app to the WABA set in WHATSAPP_BUSINESS_ACCOUNT_ID.'

    def handle(self, *args, **options):
        waba_id, token = env.WHATSAPP_BUSINESS_ACCOUNT_ID, env.WHATSAPP_TOKEN
        if not waba_id or not token:
            raise CommandError('Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_TOKEN in .env')

        res = httpx.post(f'https://graph.facebook.com/v25.0/{waba_id}/subscribed_apps',
                         headers={'Authorization': f'Bearer {token}'}, timeout=30)
        if res.is_error:
            raise CommandError(f'Failed to subscribe: {res.text}')
        self.stdout.write(self.style.SUCCESS(f'App subscribed to WABA: {res.text}'))
