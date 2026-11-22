"""
A single catch-all route hands every request to core.app.application, which
does Express-style routing itself (mounts, `:param` paths, router-level
middleware, JSON 404s) - see modules/routes.py for the mount table.

The view is async so the ASGI server never funnels requests through Django's
one shared sync thread: each request runs on the default thread pool instead,
so a slow call (e.g. Microsoft Graph) never blocks everyone else.
"""
from asgiref.sync import sync_to_async
from django.urls import re_path

from core.app import application


async def dispatch(request):
    return await sync_to_async(application.handle, thread_sensitive=False)(request)


urlpatterns = [re_path(r'^.*$', dispatch)]
