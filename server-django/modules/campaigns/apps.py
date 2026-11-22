"""Admin broadcasts to staff over WhatsApp and SMS."""
from django.apps import AppConfig


class CampaignsConfig(AppConfig):
    name = 'modules.campaigns'
    label = 'campaigns'
