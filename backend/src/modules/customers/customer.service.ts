import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { OpportunityStage } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/AppError.js';

export interface CustomerInput {
  name: string;
  shortName?: string | null;
  industry?: string | null;
  sector?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  kraPin?: string | null;
  notes?: string | null;
  accountManagerId?: string | null;
}

export interface ContactInput {
  name: string;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

const USER_CONTACT_SELECT = { id: true, name: true, email: true, phone: true } satisfies Prisma.UserSelect;

const CLOSED_STAGES: OpportunityStage[] = [OpportunityStage.WON, OpportunityStage.LOST];

/** Open pipeline value for one opportunity, using the most current figure available. */
export function openValue(o: { revisedValue?: number | null; proposedValue?: number | null; estimatedValue?: number | null }) {
  return o.revisedValue ?? o.proposedValue ?? o.estimatedValue ?? 0;
}

/** Customer accounts (e.g. KPLC) - each owns its contacts and many opportunities. */
export class CustomerService {
  constructor(private app: AppContext) {}

  async list(filters: { search?: string; page: number; limit: number }) {
    const { page, limit } = filters;
    const where: Prisma.CustomerWhereInput = {};
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { shortName: { contains: filters.search, mode: 'insensitive' } },
        { industry: { contains: filters.search, mode: 'insensitive' } },
        { contacts: { some: { name: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.app.prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          accountManager: { select: USER_CONTACT_SELECT },
          contacts: { where: { isPrimary: true }, take: 1 },
          _count: { select: { contacts: true, opportunities: true } },
          opportunities: {
            select: { stage: true, estimatedValue: true, proposedValue: true, revisedValue: true, finalValue: true },
          },
        },
      }),
      this.app.prisma.customer.count({ where }),
    ]);

    // Roll up per-account pipeline numbers so the list doubles as an
    // account-level dashboard.
    const data = rows.map(({ opportunities, contacts, ...c }) => {
      let openCount = 0, openPipeline = 0, wonValue = 0;
      for (const o of opportunities) {
        if (o.stage === OpportunityStage.WON) wonValue += o.finalValue ?? openValue(o);
        else if (!CLOSED_STAGES.includes(o.stage)) { openCount++; openPipeline += openValue(o); }
      }
      return { ...c, primaryContact: contacts[0] ?? null, openCount, openPipeline, wonValue };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Lightweight id/name list for pickers. */
  async options() {
    return this.app.prisma.customer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, shortName: true },
    });
  }

  async getById(id: string) {
    const customer = await this.app.prisma.customer.findUnique({
      where: { id },
      include: {
        accountManager: { select: USER_CONTACT_SELECT },
        createdBy: { select: { id: true, name: true } },
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        opportunities: {
          orderBy: { updatedAt: 'desc' },
          include: {
            assignedTo: { select: { id: true, name: true } },
            oems: { include: { oem: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!customer) throw new NotFoundError('Customer');
    return customer;
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.app.prisma.customer.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (clash) throw new ConflictError(`A customer named "${clash.name}" already exists`);
  }

  async create(data: CustomerInput, actorId: string) {
    const name = data.name.trim();
    await this.assertNameFree(name);
    const customer = await this.app.prisma.customer.create({ data: { ...data, name, createdById: actorId } });
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'CUSTOMER', subjectId: customer.id,
      summary: `Created customer: ${customer.name}`, newValues: customer,
    });
    return customer;
  }

  /**
   * Resolves the customer an opportunity belongs to: by id when given,
   * otherwise by case-insensitive name, creating the account if it's new.
   * This lets the opportunity form accept a typed name ("KPLC") without a
   * separate "create customer" step.
   */
  async resolve(input: { customerId?: string; customerName?: string }, actorId: string) {
    if (input.customerId) {
      const c = await this.app.prisma.customer.findUnique({ where: { id: input.customerId } });
      if (!c) throw new NotFoundError('Customer');
      return c;
    }
    const name = input.customerName?.trim();
    if (!name) throw new BadRequestError('Customer is required');
    const existing = await this.app.prisma.customer.findFirst({
      where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { shortName: { equals: name, mode: 'insensitive' } }] },
    });
    return existing ?? this.create({ name }, actorId);
  }

  async update(id: string, data: Partial<CustomerInput>, actorId: string) {
    const existing = await this.app.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Customer');
    if (data.name) {
      data.name = data.name.trim();
      await this.assertNameFree(data.name, id);
    }

    const updated = await this.app.prisma.$transaction(async (tx) => {
      const c = await tx.customer.update({ where: { id }, data });
      // Keep the denormalised name on opportunities in step with a rename.
      if (data.name && data.name !== existing.name) {
        await tx.opportunity.updateMany({ where: { customerId: id }, data: { customerName: c.name } });
      }
      return c;
    });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'CUSTOMER', subjectId: id,
      summary: `Updated customer: ${updated.name}`, oldValues: existing, newValues: updated,
    });
    return updated;
  }

  async delete(id: string, actorId: string) {
    const existing = await this.app.prisma.customer.findUnique({
      where: { id }, include: { _count: { select: { opportunities: true } } },
    });
    if (!existing) throw new NotFoundError('Customer');
    if (existing._count.opportunities > 0) {
      throw new ConflictError(`${existing.name} still has ${existing._count.opportunities} opportunit${existing._count.opportunities === 1 ? 'y' : 'ies'} - move or delete them first`);
    }
    await this.app.prisma.customer.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'CUSTOMER', subjectId: id,
      summary: `Deleted customer: ${existing.name}`, oldValues: existing,
    });
  }

  // ── Contacts ────────────────────────────────────────────────────────────────

  private async clearOtherPrimaries(tx: Prisma.TransactionClient, customerId: string, keepId: string) {
    await tx.customerContact.updateMany({
      where: { customerId, isPrimary: true, NOT: { id: keepId } },
      data: { isPrimary: false },
    });
  }

  async addContact(customerId: string, data: ContactInput, actorId: string) {
    const customer = await this.app.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError('Customer');

    const contact = await this.app.prisma.$transaction(async (tx) => {
      // The first contact on an account becomes primary automatically.
      const count = await tx.customerContact.count({ where: { customerId } });
      const c = await tx.customerContact.create({
        data: { ...data, isPrimary: data.isPrimary ?? count === 0, customerId },
      });
      if (c.isPrimary) await this.clearOtherPrimaries(tx, customerId, c.id);
      return c;
    });
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'CUSTOMER_CONTACT', subjectId: contact.id,
      summary: `Added contact ${contact.name} at ${customer.name}`, newValues: contact,
    });
    return contact;
  }

  async updateContact(customerId: string, contactId: string, data: Partial<ContactInput>, actorId: string) {
    const existing = await this.app.prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
    if (!existing) throw new NotFoundError('Contact');
    const contact = await this.app.prisma.$transaction(async (tx) => {
      const c = await tx.customerContact.update({ where: { id: contactId }, data });
      if (data.isPrimary) await this.clearOtherPrimaries(tx, customerId, c.id);
      return c;
    });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'CUSTOMER_CONTACT', subjectId: contactId,
      summary: `Updated contact ${contact.name}`, oldValues: existing, newValues: contact,
    });
    return contact;
  }

  async deleteContact(customerId: string, contactId: string, actorId: string) {
    const existing = await this.app.prisma.customerContact.findFirst({ where: { id: contactId, customerId } });
    if (!existing) throw new NotFoundError('Contact');
    await this.app.prisma.customerContact.delete({ where: { id: contactId } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'CUSTOMER_CONTACT', subjectId: contactId,
      summary: `Removed contact ${existing.name}`, oldValues: existing,
    });
  }
}
