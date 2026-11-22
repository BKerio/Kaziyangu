"""System-wide audit log."""
from django.apps import AppConfig


class AuditConfig(AppConfig):
    name = 'modules.audit'
    label = 'audit'
