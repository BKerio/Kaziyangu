"""
Advanta (QuickSMS) gateway client. Failures are logged and returned as False,
never raised, so one bad send doesn't stop a run that has other sends to make.
"""
import httpx

from core.env import EnvConfig
from core.logger import logger

from .config import require_advanta_env


class AdvantaSmsClient:
    def __init__(self, config: EnvConfig) -> None:
        self.creds = require_advanta_env(config)

    def send_sms(self, to: str, message: str) -> bool:
        """`to` is a phone number, e.g. "254712345678". True iff the gateway accepted the send."""
        try:
            res = httpx.post(
                self.creds.url,
                json={
                    'apikey': self.creds.api_key,
                    'partnerID': self.creds.partner_id,
                    'shortcode': self.creds.shortcode,
                    'mobile': to,
                    'message': message,
                },
                timeout=30,
            )
            if res.is_error:
                logger.error('Advanta SMS API error', status=res.status_code, body=res.text)
                return False

            # Advanta returns 200 even for some rejected sends (e.g. an invalid
            # number); the per-message response code tells them apart.
            try:
                data = res.json()
            except ValueError:
                data = None
            first = ((data or {}).get('responses') or [{}])[0] if isinstance(data, dict) else {}
            code = first.get('respose_code', first.get('response-code'))
            if code is not None and code != 200:
                logger.error('Advanta SMS rejected the message', code=code, data=data)
                return False
            return True
        except Exception as err:  # noqa: BLE001
            logger.error('Advanta SMS send errored', err, to=to)
            return False
