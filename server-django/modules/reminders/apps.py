"""Task reminders over WhatsApp, SMS and email."""
from django.apps import AppConfig


class RemindersConfig(AppConfig):
    name = 'modules.reminders'
    label = 'reminders'
