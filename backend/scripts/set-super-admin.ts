import 'dotenv/config';
import { Role } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * Promotes an existing user to SUPER_ADMIN by email.
 *
 * Usage:
 *   npx tsx scripts/set-super-admin.ts <email>
 */
const prisma = createPrismaClient();
const email = (process.argv[2] || '').trim().toLowerCase();

async function main() {
  if (!email) {
    console.error('Usage: npx tsx scripts/set-super-admin.ts <email>');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`❌ No user found with email "${email}". Create them first, then re-run.`);
    process.exit(1);
  }

  if (existing.role === Role.SUPER_ADMIN && existing.isActive) {
    console.log(`ℹ️  ${email} is already an active SUPER_ADMIN - nothing to change.`);
    return;
  }

  const user = await prisma.user.update({
    where: { email },
    data: { role: Role.SUPER_ADMIN, isActive: true },
    select: { email: true, name: true, role: true, isActive: true },
  });

  console.log(`✅ ${user.email} (${user.name}) is now ${user.role}, active=${user.isActive}.`);
  console.log('   They must log out and log back in for the new role to take effect (role is baked into the JWT).');
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
