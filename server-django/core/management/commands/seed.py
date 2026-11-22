"""`python manage.py seed` - sample data (backend/prisma/seed.ts)."""
from django.core.management.base import BaseCommand

from core.dates import utcnow
from core.enums import Role, TaskCategory, TaskStatus, TaskVertical
from core.hashing import hash_password
from modules.auth.models import User
from modules.tasks.models import WorkTask


class Command(BaseCommand):
    help = 'Seed a super admin, an admin, sample staff and a few sample tasks for today.'

    def handle(self, *args, **options):
        self.stdout.write('Starting seed...')

        super_admin, _ = User.objects.get_or_create(
            email='admin@example.com',
            defaults={'password_hash': hash_password('Admin@123!'), 'name': 'System Administrator',
                      'role': Role.SUPER_ADMIN, 'is_active': True},
        )
        self.stdout.write(f'Super Admin: {super_admin.email}')

        staff_hash = hash_password('Staff@123!')
        names = ['Clinton Kiptoo', 'Frank Tito', 'Brian Kerio', 'Erickson Mutai',
                 'Emmanuel Lugadiru', 'Caleb Salat', 'Eliud Mugu', 'Sheila Muonja']
        staff = []
        for name in names:
            email = f"{'.'.join(name.lower().split())}@example.com"
            user, _ = User.objects.get_or_create(
                email=email, defaults={'password_hash': staff_hash, 'name': name, 'role': Role.STAFF, 'is_active': True},
            )
            staff.append(user)
        self.stdout.write(f'Staff: {len(staff)} users')

        admin, _ = User.objects.get_or_create(
            email='ops.manager@example.com',
            defaults={'password_hash': staff_hash, 'name': 'Ops Manager', 'role': Role.ADMIN, 'is_active': True},
        )
        self.stdout.write(f'Admin: {admin.email}')

        today = utcnow().date()
        samples = [
            dict(user=staff[0], vertical=TaskVertical.APPLICATIONS_DATABASES, category=TaskCategory.DEPLOYMENT,
                 description='Provisioning new SAN storage for Client X', customer_project='Client X - DR Project',
                 start_time='09:00', end_time='12:30', hours_spent=3.5, status=TaskStatus.IN_PROGRESS, percent_complete=60,
                 key_deliverable='LUNs mapped and visible to ESXi hosts',
                 blockers_notes='Waiting for network team to open firewall ports.'),
            dict(user=staff[1], vertical=TaskVertical.CYBERSECURITY, category=TaskCategory.PROOF_OF_CONCEPT,
                 description='Troubleshooting WAN latency issues', customer_project='Client Y - HQ',
                 start_time='14:00', end_time='15:30', hours_spent=1.5, status=TaskStatus.RESOLVED, percent_complete=100,
                 key_deliverable='Identified bad SFP module. Replaced.'),
            dict(user=staff[2], vertical=TaskVertical.APPLICATIONS_DATABASES, category=TaskCategory.DESIGN_ARCHITECTURE,
                 description='Testing EDR solution for new proposal', customer_project='Internal Lab',
                 start_time='10:00', end_time='16:00', hours_spent=6, status=TaskStatus.BLOCKED, percent_complete=40,
                 key_deliverable='Test report & recommendation for Client Z',
                 blockers_notes='Need higher spec VM for testing.'),
        ]
        for sample in samples:
            WorkTask.objects.create(date=today, **sample)
        self.stdout.write(f'Sample tasks: {len(samples)} entries created for today')

        self.stdout.write(self.style.SUCCESS(
            '\nSeed complete!\n'
            'Super Admin:  admin@example.com / Admin@123!\n'
            'Staff/Admin sample accounts use password: Staff@123!'
        ))
