import 'dotenv/config';
import { Role } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';

/**
 * Creates (or updates) a single user directly against the database.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> <password> <name> [role]
 *   npx tsx scripts/create-user.ts admin@example.com 'ChangeMe123!' 'Site Admin' SUPER_ADMIN
 *
 * role defaults to STAFF; valid values: STAFF | ADMIN | SUPER_ADMIN
 */
const prisma = createPrismaClient();

async function main() {
  const [email, password, name, roleArg] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Usage: npx tsx scripts/create-user.ts <email> <password> <name> [role]');
    process.exit(1);
  }

  const role = (roleArg?.toUpperCase() as Role) || Role.STAFF;
  if (!Object.values(Role).includes(role)) {
    console.error(`Invalid role "${roleArg}". Valid values: ${Object.values(Role).join(', ')}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, name, role, isActive: true },
    create: { email: email.toLowerCase(), passwordHash, name, role, isActive: true },
  });

  console.log(`✅ User ready: ${user.email} (${user.role})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
