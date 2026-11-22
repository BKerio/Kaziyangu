"""`python manage.py set_super_admin <email>` (backend/scripts/set-super-admin.ts)."""
from django.core.management.base import BaseCommand, CommandError

from core.db import update_where
from core.enums import Role
from modules.auth.models import User


class Command(BaseCommand):
    help = 'Promote an existing user to SUPER_ADMIN by email.'

    def add_arguments(self, parser):
        parser.add_argument('email')

    def handle(self, *args, email, **options):
        email = email.strip().lower()
        user = User.objects.filter(email=email).first()
        if user is None:
            raise CommandError(f'No user found with email "{email}". Create them first, then re-run.')
        if user.role == Role.SUPER_ADMIN and user.is_active:
            self.stdout.write(f'{email} is already an active SUPER_ADMIN - nothing to change.')
            return

        update_where(User.objects.filter(id=user.id), role=Role.SUPER_ADMIN, is_active=True)
        self.stdout.write(self.style.SUCCESS(f'{email} ({user.name}) is now SUPER_ADMIN, active=True.'))
        self.stdout.write('They must log out and back in for the new role to take effect (the role is in the JWT).')
