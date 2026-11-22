"""`python manage.py serve` - start the API (HTTP + Socket.io + reminder scheduler), like `npm start`."""
import socket
import sys

import uvicorn
from django.core.management.base import BaseCommand, CommandError
from uvicorn.supervisors import ChangeReload

from core.banner import print_banner
from core.env import env


class BannerServer(uvicorn.Server):
    """Prints the Django banner only once the socket is bound - not when startup fails (e.g. port in use)."""

    async def startup(self, sockets=None) -> None:
        await super().startup(sockets=sockets)
        if self.started:
            print_banner(self.config.host, self.config.port)


def _assert_port_free(host: str, port: int) -> None:
    """
    uvicorn binds with SO_REUSEADDR, which on Windows lets a second process
    silently share a port another server (e.g. the Node backend) is already
    listening on - so check with an exclusive bind first and fail clearly.
    """
    family = socket.AF_INET6 if ':' in host else socket.AF_INET
    probe = socket.socket(family, socket.SOCK_STREAM)
    try:
        if sys.platform == 'win32':
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind((host, port))
    except OSError:
        raise CommandError(
            f'Port {port} is already in use by another program (is the Node backend still running?). '
            f'Stop it, or start this server on another port, e.g. PORT={port + 1} python manage.py serve'
        ) from None
    finally:
        probe.close()
    if sys.platform == 'win32':
        # Exclusive bind still loses to a server on a *specific* address (e.g. 127.0.0.1) - try connecting too.
        with socket.socket(family, socket.SOCK_STREAM) as conn:
            conn.settimeout(0.5)
            target = '127.0.0.1' if host in ('0.0.0.0', '') else ('::1' if host == '::' else host)
            if conn.connect_ex((target, port)) == 0:
                raise CommandError(
                    f'Port {port} is already in use by another program (is the Node backend still running?). '
                    f'Stop it, or start this server on another port, e.g. PORT={port + 1} python manage.py serve'
                )


class Command(BaseCommand):
    help = 'Run the API with uvicorn on HOST:PORT (from .env).'

    def add_arguments(self, parser):
        parser.add_argument('--reload', action='store_true', help='Restart on code changes (development).')

    def handle(self, *args, **options):
        _assert_port_free(env.HOST, int(env.PORT))
        config = uvicorn.Config(
            'config.asgi:application',
            host=env.HOST,
            port=int(env.PORT),
            reload=options['reload'],
            log_level='warning',  # requests are logged by core/app.py
            proxy_headers=True,
            forwarded_allow_ips='*',
        )
        server = BannerServer(config)
        try:
            if config.should_reload:
                ChangeReload(config, target=server.run, sockets=[config.bind_socket()]).run()
            else:
                server.run()
        except KeyboardInterrupt:
            pass
        if not server.started and not config.should_reload:
            sys.exit(3)  # uvicorn's STARTUP_FAILURE
