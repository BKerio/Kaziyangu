"""SMTP mail client - same "log and return False on failure" contract as the SMS/WhatsApp clients."""
import smtplib
import ssl
from email.message import EmailMessage

from core.env import EnvConfig
from core.logger import logger

from .config import require_smtp_env


class EmailClient:
    def __init__(self, config: EnvConfig) -> None:
        self.creds = require_smtp_env(config)

    def send_mail(self, to: str, subject: str, text: str) -> bool:
        message = EmailMessage()
        message['From'] = self.creds.sender
        message['To'] = to
        message['Subject'] = subject
        message.set_content(text)
        try:
            context = ssl.create_default_context()
            if self.creds.port == 465:
                with smtplib.SMTP_SSL(self.creds.host, self.creds.port, context=context, timeout=30) as smtp:
                    smtp.login(self.creds.user, self.creds.password)
                    smtp.send_message(message)
            else:
                with smtplib.SMTP(self.creds.host, self.creds.port, timeout=30) as smtp:
                    smtp.ehlo()
                    if smtp.has_extn('starttls'):  # what nodemailer does by default when the server offers it
                        smtp.starttls(context=context)
                        smtp.ehlo()
                    smtp.login(self.creds.user, self.creds.password)
                    smtp.send_message(message)
            return True
        except Exception as err:  # noqa: BLE001
            logger.error('Reminder email send errored', err, to=to)
            return False
