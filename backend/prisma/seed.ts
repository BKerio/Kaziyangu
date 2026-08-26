import 'dotenv/config';
import { Role, TaskCategory, TaskStatus, TaskVertical } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';

const prisma = createPrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // ── 1. Super Admin ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Admin@123!', 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash,
      name: 'System Administrator',
      role: Role.SUPER_ADMIN,
      isActive: true,
    },
  });
  console.log(`✅ Super Admin: ${superAdmin.email}`);

  // ── 2. Sample staff (from the Master Daily Tasks template) ─────────────────
  const staffHash = await bcrypt.hash('Staff@123!', 10);
  const staffNames = [
    'Clinton Kiptoo', 'Frank Tito', 'Brian Kerio', 'Erickson Mutai',
    'Emmanuel Lugadiru', 'Caleb Salat', 'Eliud Mugu', 'Sheila Muonja',
  ];

  const staff = [];
  for (const name of staffNames) {
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash: staffHash, name, role: Role.STAFF, isActive: true },
    });
    staff.push(user);
  }
  console.log(`✅ Staff: ${staff.length} users created`);

  // ── 3. One admin ────────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'ops.manager@example.com' },
    update: {},
    create: {
      email: 'ops.manager@example.com',
      passwordHash: staffHash,
      name: 'Ops Manager',
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ── 4. Sample task log entries (from the template's example rows) ─────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sampleTasks = [
    {
      user: staff[0], // Clinton Kiptoo
      vertical: TaskVertical.APPLICATIONS_DATABASES,
      category: TaskCategory.DEPLOYMENT,
      description: 'Provisioning new SAN storage for Client X',
      customerProject: 'Client X - DR Project',
      startTime: '09:00',
      endTime: '12:30',
      hoursSpent: 3.5,
      status: TaskStatus.IN_PROGRESS,
      percentComplete: 60,
      keyDeliverable: 'LUNs mapped and visible to ESXi hosts',
      blockersNotes: 'Waiting for network team to open firewall ports.',
    },
    {
      user: staff[1], // Frank Tito
      vertical: TaskVertical.CYBERSECURITY,
      category: TaskCategory.PROOF_OF_CONCEPT,
      description: 'Troubleshooting WAN latency issues',
      customerProject: 'Client Y - HQ',
      startTime: '14:00',
      endTime: '15:30',
      hoursSpent: 1.5,
      status: TaskStatus.RESOLVED,
      percentComplete: 100,
      keyDeliverable: 'Identified bad SFP module. Replaced.',
    },
    {
      user: staff[2], // Brian Kerio
      vertical: TaskVertical.APPLICATIONS_DATABASES,
      category: TaskCategory.DESIGN_ARCHITECTURE,
      description: 'Testing EDR solution for new proposal',
      customerProject: 'Internal Lab',
      startTime: '10:00',
      endTime: '16:00',
      hoursSpent: 6,
      status: TaskStatus.BLOCKED,
      percentComplete: 40,
      keyDeliverable: 'Test report & recommendation for Client Z',
      blockersNotes: 'Need higher spec VM for testing.',
    },
  ];

  for (const t of sampleTasks) {
    await prisma.workTask.create({
      data: {
        date: today,
        vertical: t.vertical,
        category: t.category,
        description: t.description,
        customerProject: t.customerProject,
        startTime: t.startTime,
        endTime: t.endTime,
        hoursSpent: t.hoursSpent,
        status: t.status,
        percentComplete: t.percentComplete,
        keyDeliverable: t.keyDeliverable,
        blockersNotes: t.blockersNotes,
        userId: t.user.id,
      },
    });
  }
  console.log(`✅ Sample tasks: ${sampleTasks.length} entries created for today`);

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────');
  console.log('Super Admin credentials:');
  console.log('  Email:    admin@example.com');
  console.log('  Password: Admin@123!');
  console.log('Staff/Admin sample accounts use password: Staff@123!');
  console.log('─────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
