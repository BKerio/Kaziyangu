"""
WSGI entry point - HTTP only. Live socket events and the reminder scheduler
need the ASGI app (config/asgi.py); use this only where ASGI isn't an option.
"""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()
