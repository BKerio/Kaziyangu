"""Users, roles, JWT login and Microsoft (Outlook) account linking."""
from django.apps import AppConfig


class AuthConfig(AppConfig):
    name = 'modules.auth'
    label = 'accounts'
