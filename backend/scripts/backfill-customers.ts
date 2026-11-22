import 'dotenv/config';
import { OpportunityTeamRole } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * One-off migration for opportunities created before customer accounts,
 * contacts, OEMs and deal teams existed. Safe to re-run.
 *
 *  - Creates a Customer for each distinct customerName (case-insensitive)
 *    and links the opportunities to it.
 *  - Turns the free-text contactPerson into a CustomerContact on that
 *    account and links it to the deal.
 *  - Puts each opportunity's assignee on its deal team as account manager.
 *  - Seeds the OEM list with common vendors (only adds missing ones).
 *
 * Usage:
 *   npx tsx scripts/backfill-customers.ts
 */
const prisma = createPrismaClient();

const DEFAULT_OEMS: { name: string; category: string }[] = [
  { name: 'HPE', category: 'Servers, Storage & Networking' },
  { name: 'Hikvision', category: 'CCTV & Physical Security' },
  { name: 'Cisco', category: 'Networking & Collaboration' },
  { name: 'Dell Technologies', category: 'Servers, Storage & End-user' },
  { name: 'Fortinet', category: 'Cybersecurity' },
  { name: 'Microsoft', category: 'Software & Cloud' },
  { name: 'Huawei', category: 'Networking & Telecom' },
];

async function main() {
  for (const oem of DEFAULT_OEMS) {
    const exists = await prisma.oem.findFirst({ where: { name: { equals: oem.name, mode: 'insensitive' } } });
    if (!exists) await prisma.oem.create({ data: oem });
  }
  console.log(`OEM catalogue ready (${await prisma.oem.count()} OEMs).`);

  const orphans = await prisma.opportunity.findMany({ where: { customerId: null } });
  console.log(`${orphans.length} opportunities without a customer account.`);

  let createdCustomers = 0, createdContacts = 0;
  for (const o of orphans) {
    const name = o.customerName.trim();
    let customer = await prisma.customer.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { name, createdById: o.createdById } });
      createdCustomers++;
    }
    await prisma.opportunity.update({ where: { id: o.id }, data: { customerId: customer.id, customerName: customer.name } });

    const contactName = o.contactPerson?.trim();
    if (contactName) {
      let contact = await prisma.customerContact.findFirst({
        where: { customerId: customer.id, name: { equals: contactName, mode: 'insensitive' } },
      });
      if (!contact) {
        const isFirst = (await prisma.customerContact.count({ where: { customerId: customer.id } })) === 0;
        contact = await prisma.customerContact.create({ data: { customerId: customer.id, name: contactName, isPrimary: isFirst } });
        createdContacts++;
      }
      await prisma.opportunityContact.upsert({
        where: { opportunityId_contactId: { opportunityId: o.id, contactId: contact.id } },
        create: { opportunityId: o.id, contactId: contact.id },
        update: {},
      });
    }
  }

  const assigned = await prisma.opportunity.findMany({ where: { assignedToId: { not: null } }, select: { id: true, assignedToId: true } });
  const team = await prisma.opportunityTeamMember.createMany({
    data: assigned.map((o) => ({ opportunityId: o.id, userId: o.assignedToId!, role: OpportunityTeamRole.ACCOUNT_MANAGER })),
    skipDuplicates: true,
  });

  console.log(`Created ${createdCustomers} customers, ${createdContacts} contacts, ${team.count} team memberships.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
