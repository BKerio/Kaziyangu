"""`python manage.py create_user <email> <password> <name> [role]` (backend/scripts/create-user.ts)."""
from django.core.management.base import BaseCommand, CommandError

from core.db import update_where
from core.enums import Role, values
from core.hashing import hash_password
from modules.auth.models import User


class Command(BaseCommand):
    help = 'Create (or update) a single user. Role defaults to STAFF.'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('password')
        parser.add_argument('name')
        parser.add_argument('role', nargs='?', default=Role.STAFF.value)

    def handle(self, *args, email, password, name, role, **options):
        role = role.upper()
        if role not in values(Role):
            raise CommandError(f"Invalid role \"{role}\". Valid values: {', '.join(values(Role))}")

        email = email.lower()
        fields = {'password_hash': hash_password(password), 'name': name, 'role': role, 'is_active': True}
        if User.objects.filter(email=email).exists():
            update_where(User.objects.filter(email=email), **fields)
        else:
            User.objects.create(email=email, **fields)
        self.stdout.write(self.style.SUCCESS(f'User ready: {email} ({role})'))
