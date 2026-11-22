import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import {
  ActivityType, ContactRole, DealRegStatus, OpportunityPriority, OpportunityStage, OpportunityTeamRole, Role,
} from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { deleteOpportunityAttachmentFile } from './attachment-storage.js';
import { ContactInput, CustomerService, openValue } from '../customers/customer.service.js';
import { resolveOem } from '../oems/oem.routes.js';

export interface TeamMemberInput { userId: string; role?: OpportunityTeamRole }
export interface ContactLinkInput { contactId?: string; newContact?: ContactInput; role?: ContactRole }

export interface OemLinkInput {
  oemId?: string;
  oemName?: string | null;
  products?: string | null;
  value?: number;
  dealRegNumber?: string | null;
  dealRegStatus?: DealRegStatus;
  dealRegExpiry?: string | null;
  partnerManagerName?: string | null;
  partnerManagerEmail?: string | null;
  partnerManagerPhone?: string | null;
  notes?: string | null;
}

export interface CreateOpportunityInput {
  name: string;
  customerId?: string;
  customerName?: string;
  contactPerson?: string;
  source?: string;
  dateIdentified: string;
  estimatedValue?: number;
  clientBudget?: number | null;
  tenderReference?: string;
  submissionDeadline?: string;
  description?: string;
  priority?: OpportunityPriority;
  assignedToId?: string;
  followUpDate?: string;

  // Related records created alongside the opportunity.
  oemNames?: string[];
  team?: TeamMemberInput[];
  contacts?: ContactLinkInput[];
  initialNote?: string;
}

export interface UpdateOpportunityInput extends Partial<Omit<CreateOpportunityInput, 'oemNames' | 'team' | 'contacts' | 'initialNote'>> {
  stage?: OpportunityStage;

  // Qualification
  isGenuine?: boolean;
  customerNeed?: string;
  budgetConfirmed?: string;
  decisionMaker?: string;
  expectedTimeline?: string;
  probability?: number;

  // Proposal
  proposalSubmittedDate?: string;
  proposedValue?: number;
  expectedClosingDate?: string;

  // Negotiation
  customerFeedback?: string;
  revisedValue?: number;
  negotiationNotes?: string;
  competitors?: string;

  // Won
  finalValue?: number;
  contractNumber?: string;
  closingDate?: string;

  // Lost
  reasonLost?: string;
  competitorSelected?: string;
  lostValue?: number;
  lessonsLearned?: string;
}

const USER_CONTACT = { id: true, name: true, email: true, phone: true, department: true } satisfies Prisma.UserSelect;

const LIST_INCLUDE = {
  assignedTo: { select: USER_CONTACT },
  createdBy: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, shortName: true } },
  oems: { select: { id: true, dealRegStatus: true, oem: { select: { id: true, name: true } } } },
  _count: { select: { attachments: true, notes: true, contacts: true, team: true } },
} satisfies Prisma.OpportunityInclude;

const DETAIL_INCLUDE = {
  assignedTo: { select: USER_CONTACT },
  createdBy: { select: { id: true, name: true } },
  customer: {
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' as const }, { name: 'asc' as const }] },
      accountManager: { select: USER_CONTACT },
      _count: { select: { opportunities: true } },
    },
  },
  contacts: { include: { contact: true }, orderBy: { createdAt: 'asc' as const } },
  oems: { include: { oem: true }, orderBy: { createdAt: 'asc' as const } },
  team: { include: { user: { select: USER_CONTACT } }, orderBy: { createdAt: 'asc' as const } },
  notes: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: [{ isPinned: 'desc' as const }, { createdAt: 'desc' as const }],
  },
  activities: {
    orderBy: { date: 'desc' as const },
    include: { loggedBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.OpportunityInclude;

const DATE_FIELDS = [
  'dateIdentified', 'followUpDate', 'proposalSubmittedDate', 'expectedClosingDate', 'closingDate', 'submissionDeadline',
] as const;

/**
 * Converts any provided date string fields to Date ('' clears the field),
 * leaving others untouched. Date fields are typed as `string` on the input
 * purely for the wire format, so this operates loosely and the caller
 * asserts the Prisma input shape it produces.
 */
function toDateFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of DATE_FIELDS) {
    if (out[key] !== undefined) out[key] = out[key] ? new Date(out[key] as string) : null;
  }
  return out;
}

function toDate(v: string | null | undefined) {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

/** Sales pipeline: opportunity tracking from lead identification through won/lost. */
export class OpportunityService {
  private customers: CustomerService;

  constructor(private app: AppContext) {
    this.customers = new CustomerService(app);
  }

  async list(filters: {
    stage?: OpportunityStage;
    priority?: OpportunityPriority;
    assignedToId?: string;
    customerId?: string;
    oemId?: string;
    open?: boolean;
    search?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const and: Prisma.OpportunityWhereInput[] = [];
    if (filters.stage) and.push({ stage: filters.stage });
    else if (filters.open) and.push({ stage: { notIn: [OpportunityStage.WON, OpportunityStage.LOST] } });
    if (filters.priority) and.push({ priority: filters.priority });
    if (filters.customerId) and.push({ customerId: filters.customerId });
    if (filters.oemId) and.push({ oems: { some: { oemId: filters.oemId } } });
    // "Account manager" filter matches the lead and anyone else on the deal team.
    if (filters.assignedToId) {
      and.push({ OR: [{ assignedToId: filters.assignedToId }, { team: { some: { userId: filters.assignedToId } } }] });
    }
    if (filters.search) {
      const contains = { contains: filters.search, mode: 'insensitive' as const };
      and.push({
        OR: [
          { name: contains },
          { customerName: contains },
          { customer: { shortName: contains } },
          { contactPerson: contains },
          { tenderReference: contains },
          { contacts: { some: { contact: { name: contains } } } },
          { oems: { some: { oem: { name: contains } } } },
        ],
      });
    }
    const where: Prisma.OpportunityWhereInput = and.length ? { AND: and } : {};

    const [data, total] = await Promise.all([
      this.app.prisma.opportunity.findMany({ where, skip, take: limit, orderBy: { updatedAt: 'desc' }, include: LIST_INCLUDE }),
      this.app.prisma.opportunity.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getById(id: string) {
    const opportunity = await this.app.prisma.opportunity.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!opportunity) throw new NotFoundError('Opportunity');
    return opportunity;
  }

  /** Internal staff who can be put on a deal team, with their contact details. */
  async teamDirectory() {
    return this.app.prisma.user.findMany({
      where: { isActive: true, role: { not: Role.ATTACHEE } },
      orderBy: { name: 'asc' },
      select: { ...USER_CONTACT, role: true },
    });
  }

  private async findOrThrow(id: string) {
    const o = await this.app.prisma.opportunity.findUnique({ where: { id } });
    if (!o) throw new NotFoundError('Opportunity');
    return o;
  }

  async create(data: CreateOpportunityInput, createdById: string) {
    const { oemNames, team, contacts, initialNote, customerId, customerName, ...fields } = data;
    const customer = await this.customers.resolve({ customerId, customerName }, createdById);

    const createData = {
      ...toDateFields(fields as unknown as Record<string, unknown>),
      customerId: customer.id,
      customerName: customer.name,
      createdById,
      // Assigning a salesperson at creation time naturally advances the stage.
      stage: data.assignedToId ? OpportunityStage.ASSIGNED : OpportunityStage.NEW,
    } as unknown as Prisma.OpportunityUncheckedCreateInput;

    const opportunity = await this.app.prisma.opportunity.create({ data: createData });

    // Lead account manager is always on the team.
    const members = new Map<string, OpportunityTeamRole>();
    if (data.assignedToId) members.set(data.assignedToId, OpportunityTeamRole.ACCOUNT_MANAGER);
    for (const m of team ?? []) if (!members.has(m.userId)) members.set(m.userId, m.role ?? OpportunityTeamRole.ACCOUNT_MANAGER);
    if (members.size) {
      await this.app.prisma.opportunityTeamMember.createMany({
        data: [...members].map(([userId, role]) => ({ opportunityId: opportunity.id, userId, role })),
        skipDuplicates: true,
      });
    }

    for (const name of new Set((oemNames ?? []).map((n) => n.trim()).filter(Boolean))) {
      const oem = await resolveOem(this.app, name, createdById);
      await this.app.prisma.opportunityOem.upsert({
        where: { opportunityId_oemId: { opportunityId: opportunity.id, oemId: oem.id } },
        create: {
          opportunityId: opportunity.id, oemId: oem.id,
          partnerManagerName: oem.partnerManagerName, partnerManagerEmail: oem.partnerManagerEmail,
          partnerManagerPhone: oem.partnerManagerPhone,
        },
        update: {},
      });
    }

    for (const c of contacts ?? []) await this.linkContact(opportunity.id, c, createdById, false);

    if (initialNote?.trim()) {
      await this.app.prisma.opportunityNote.create({
        data: { opportunityId: opportunity.id, authorId: createdById, body: initialNote.trim() },
      });
    }

    const full = await this.getById(opportunity.id);
    await this.app.auditLog.record({
      actorId: createdById, action: 'CREATE', subjectType: 'OPPORTUNITY', subjectId: opportunity.id,
      summary: `Created opportunity: ${opportunity.name} (${customer.name})`,
      newValues: opportunity,
    });
    return full;
  }

  async update(id: string, data: UpdateOpportunityInput, actorId: string) {
    const existing = await this.findOrThrow(id);
    const { customerId, customerName, ...fields } = data;

    const updateData = toDateFields(fields as unknown as Record<string, unknown>);
    if (customerId || customerName) {
      const customer = await this.customers.resolve({ customerId, customerName }, actorId);
      updateData.customerId = customer.id;
      updateData.customerName = customer.name;
    }

    const updated = await this.app.prisma.opportunity.update({
      where: { id }, data: updateData as unknown as Prisma.OpportunityUncheckedUpdateInput,
    });
    if (data.assignedToId && data.assignedToId !== existing.assignedToId) {
      await this.app.prisma.opportunityTeamMember.upsert({
        where: { opportunityId_userId: { opportunityId: id, userId: data.assignedToId } },
        create: { opportunityId: id, userId: data.assignedToId, role: OpportunityTeamRole.ACCOUNT_MANAGER },
        update: {},
      });
    }

    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: id,
      summary: `Updated opportunity: ${updated.name}`,
      oldValues: existing,
      newValues: updated,
    });
    return this.getById(id);
  }

  async delete(id: string, actorId: string) {
    const existing = await this.findOrThrow(id);
    const attachments = await this.app.prisma.opportunityAttachment.findMany({ where: { opportunityId: id } });
    await Promise.all(attachments.map((a) => deleteOpportunityAttachmentFile(a.storageKey)));
    await this.app.prisma.opportunity.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'OPPORTUNITY', subjectId: id,
      summary: `Deleted opportunity: ${existing.name}`,
      oldValues: existing,
    });
  }

  async logActivity(
    opportunityId: string,
    data: { type: ActivityType; date: string; notes?: string },
    loggedById: string
  ) {
    const opportunity = await this.findOrThrow(opportunityId);

    const activity = await this.app.prisma.opportunityActivity.create({
      data: {
        opportunityId,
        type: data.type,
        date: new Date(data.date),
        notes: data.notes,
        loggedById,
      },
      include: { loggedBy: { select: { id: true, name: true } } },
    });
    await this.app.auditLog.record({
      actorId: loggedById, action: 'CREATE', subjectType: 'OPPORTUNITY_ACTIVITY', subjectId: activity.id,
      summary: `Logged ${data.type.toLowerCase()} activity on opportunity: ${opportunity.name}`,
      newValues: activity,
    });
    return activity;
  }

  // ── Customer contacts on the deal ────────────────────────────────────────────

  /**
   * Links a customer contact to the deal - an existing one by id, or a new
   * one created on the opportunity's customer account. Opportunities from
   * before customer accounts existed get their account created here.
   */
  async linkContact(opportunityId: string, input: ContactLinkInput, actorId: string, audit = true) {
    const opportunity = await this.findOrThrow(opportunityId);
    let customerId = opportunity.customerId;
    if (!customerId) {
      const customer = await this.customers.resolve({ customerName: opportunity.customerName }, actorId);
      await this.app.prisma.opportunity.update({ where: { id: opportunityId }, data: { customerId: customer.id } });
      customerId = customer.id;
    }

    let contactId = input.contactId;
    if (!contactId) {
      if (!input.newContact) throw new BadRequestError('Pick a contact or enter a new one');
      contactId = (await this.customers.addContact(customerId, input.newContact, actorId)).id;
    } else {
      const contact = await this.app.prisma.customerContact.findUnique({ where: { id: contactId } });
      if (!contact || contact.customerId !== customerId) {
        throw new BadRequestError("That contact doesn't belong to this opportunity's customer");
      }
    }

    const link = await this.app.prisma.opportunityContact.upsert({
      where: { opportunityId_contactId: { opportunityId, contactId } },
      create: { opportunityId, contactId, role: input.role ?? ContactRole.OTHER },
      update: { role: input.role ?? undefined },
      include: { contact: true },
    });
    if (audit) {
      await this.app.auditLog.record({
        actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
        summary: `Linked contact ${link.contact.name} to opportunity: ${opportunity.name}`,
      });
    }
    return link;
  }

  async updateContactRole(opportunityId: string, contactId: string, role: ContactRole) {
    const link = await this.app.prisma.opportunityContact.findUnique({
      where: { opportunityId_contactId: { opportunityId, contactId } },
    });
    if (!link) throw new NotFoundError('Contact on this opportunity');
    return this.app.prisma.opportunityContact.update({
      where: { opportunityId_contactId: { opportunityId, contactId } }, data: { role }, include: { contact: true },
    });
  }

  async unlinkContact(opportunityId: string, contactId: string, actorId: string) {
    const opportunity = await this.findOrThrow(opportunityId);
    const { count } = await this.app.prisma.opportunityContact.deleteMany({ where: { opportunityId, contactId } });
    if (!count) throw new NotFoundError('Contact on this opportunity');
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Removed a contact from opportunity: ${opportunity.name}`,
    });
  }

  // ── OEMs on the deal ─────────────────────────────────────────────────────────

  async addOem(opportunityId: string, input: OemLinkInput, actorId: string) {
    const opportunity = await this.findOrThrow(opportunityId);
    const { oemId, oemName, dealRegExpiry, ...rest } = input;
    let oem;
    if (oemId) {
      oem = await this.app.prisma.oem.findUnique({ where: { id: oemId } });
      if (!oem) throw new NotFoundError('OEM');
    } else if (oemName?.trim()) {
      oem = await resolveOem(this.app, oemName, actorId);
    } else {
      throw new BadRequestError('Pick an OEM');
    }

    const already = await this.app.prisma.opportunityOem.findUnique({
      where: { opportunityId_oemId: { opportunityId, oemId: oem.id } },
    });
    if (already) throw new ConflictError(`${oem.name} is already on this opportunity`);

    const link = await this.app.prisma.opportunityOem.create({
      data: {
        ...rest,
        dealRegExpiry: toDate(dealRegExpiry),
        // Fall back to the OEM's default partner manager.
        partnerManagerName: rest.partnerManagerName ?? oem.partnerManagerName,
        partnerManagerEmail: rest.partnerManagerEmail ?? oem.partnerManagerEmail,
        partnerManagerPhone: rest.partnerManagerPhone ?? oem.partnerManagerPhone,
        opportunityId,
        oemId: oem.id,
      },
      include: { oem: true },
    });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Added OEM ${oem.name} to opportunity: ${opportunity.name}`, newValues: link,
    });
    return link;
  }

  async updateOem(opportunityId: string, linkId: string, input: Omit<OemLinkInput, 'oemId' | 'oemName'>, actorId: string) {
    const existing = await this.app.prisma.opportunityOem.findFirst({ where: { id: linkId, opportunityId } });
    if (!existing) throw new NotFoundError('OEM on this opportunity');
    const { dealRegExpiry, ...rest } = input;
    const link = await this.app.prisma.opportunityOem.update({
      where: { id: linkId },
      data: { ...rest, dealRegExpiry: toDate(dealRegExpiry) },
      include: { oem: true },
    });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Updated ${link.oem.name} details on an opportunity`, oldValues: existing, newValues: link,
    });
    return link;
  }

  async removeOem(opportunityId: string, linkId: string, actorId: string) {
    const existing = await this.app.prisma.opportunityOem.findFirst({
      where: { id: linkId, opportunityId }, include: { oem: true },
    });
    if (!existing) throw new NotFoundError('OEM on this opportunity');
    await this.app.prisma.opportunityOem.delete({ where: { id: linkId } });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Removed OEM ${existing.oem.name} from an opportunity`, oldValues: existing,
    });
  }

  // ── Internal account team ────────────────────────────────────────────────────

  async addTeamMember(opportunityId: string, input: TeamMemberInput, actorId: string) {
    const opportunity = await this.findOrThrow(opportunityId);
    const user = await this.app.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || !user.isActive || user.role === Role.ATTACHEE) throw new BadRequestError('Pick an active staff member');

    const member = await this.app.prisma.opportunityTeamMember.upsert({
      where: { opportunityId_userId: { opportunityId, userId: input.userId } },
      create: { opportunityId, userId: input.userId, role: input.role ?? OpportunityTeamRole.ACCOUNT_MANAGER },
      update: { role: input.role ?? undefined },
      include: { user: { select: USER_CONTACT } },
    });
    // The first account manager on an unassigned deal becomes its lead.
    if (!opportunity.assignedToId && member.role === OpportunityTeamRole.ACCOUNT_MANAGER) {
      await this.app.prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          assignedToId: input.userId,
          ...(opportunity.stage === OpportunityStage.NEW ? { stage: OpportunityStage.ASSIGNED } : {}),
        },
      });
    }
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Added ${user.name} (${member.role.toLowerCase().replace('_', ' ')}) to opportunity: ${opportunity.name}`,
    });
    return member;
  }

  async removeTeamMember(opportunityId: string, userId: string, actorId: string) {
    const opportunity = await this.findOrThrow(opportunityId);
    const { count } = await this.app.prisma.opportunityTeamMember.deleteMany({ where: { opportunityId, userId } });
    if (!count) throw new NotFoundError('Team member on this opportunity');
    // Removing the lead hands the lead role to the next account manager, if any.
    if (opportunity.assignedToId === userId) {
      const next = await this.app.prisma.opportunityTeamMember.findFirst({
        where: { opportunityId, role: OpportunityTeamRole.ACCOUNT_MANAGER }, orderBy: { createdAt: 'asc' },
      });
      await this.app.prisma.opportunity.update({ where: { id: opportunityId }, data: { assignedToId: next?.userId ?? null } });
    }
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: opportunityId,
      summary: `Removed a team member from opportunity: ${opportunity.name}`,
    });
  }

  // ── Notes ─────────────────────────────────────────────────────────────────────

  async addNote(opportunityId: string, body: string, isPinned: boolean, authorId: string) {
    const opportunity = await this.findOrThrow(opportunityId);
    const note = await this.app.prisma.opportunityNote.create({
      data: { opportunityId, authorId, body, isPinned },
      include: { author: { select: { id: true, name: true } } },
    });
    // Touch the opportunity so "recently updated" ordering reflects new notes.
    await this.app.prisma.opportunity.update({ where: { id: opportunityId }, data: { updatedAt: new Date() } });
    await this.app.auditLog.record({
      actorId: authorId, action: 'CREATE', subjectType: 'OPPORTUNITY_NOTE', subjectId: note.id,
      summary: `Added a note on opportunity: ${opportunity.name}`, newValues: note,
    });
    return note;
  }

  private async noteForEdit(opportunityId: string, noteId: string, actor: { userId: string; role: Role }) {
    const note = await this.app.prisma.opportunityNote.findFirst({ where: { id: noteId, opportunityId } });
    if (!note) throw new NotFoundError('Note');
    const isManager = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    if (note.authorId !== actor.userId && !isManager) throw new ForbiddenError('You can only change your own notes');
    return note;
  }

  async updateNote(
    opportunityId: string, noteId: string, data: { body?: string; isPinned?: boolean }, actor: { userId: string; role: Role },
  ) {
    const existing = await this.app.prisma.opportunityNote.findFirst({ where: { id: noteId, opportunityId } });
    if (!existing) throw new NotFoundError('Note');
    // Anyone on the pipeline can pin/unpin; only the author (or a manager) can edit the text.
    if (data.body !== undefined) await this.noteForEdit(opportunityId, noteId, actor);
    const note = await this.app.prisma.opportunityNote.update({
      where: { id: noteId }, data, include: { author: { select: { id: true, name: true } } },
    });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'OPPORTUNITY_NOTE', subjectId: noteId,
      summary: 'Updated an opportunity note', oldValues: existing, newValues: note,
    });
    return note;
  }

  async deleteNote(opportunityId: string, noteId: string, actor: { userId: string; role: Role }) {
    const note = await this.noteForEdit(opportunityId, noteId, actor);
    await this.app.prisma.opportunityNote.delete({ where: { id: noteId } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'OPPORTUNITY_NOTE', subjectId: noteId,
      summary: 'Deleted an opportunity note', oldValues: note,
    });
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────────

  /** Dashboard KPIs shown at the top of the Opportunity Tracker. */
  async getStats() {
    const opportunities = await this.app.prisma.opportunity.findMany({
      select: {
        stage: true, estimatedValue: true, proposedValue: true, revisedValue: true, finalValue: true,
        clientBudget: true, probability: true, customerId: true,
        oems: { select: { value: true, oem: { select: { id: true, name: true } } } },
      },
    });

    const inProgressStages: OpportunityStage[] = [OpportunityStage.QUALIFICATION, OpportunityStage.ASSIGNED, OpportunityStage.ENGAGEMENT];

    let newCount = 0, inProgressCount = 0, proposalCount = 0, negotiationCount = 0, wonCount = 0, lostCount = 0;
    let pipelineValue = 0, wonValue = 0, weightedPipeline = 0, openClientBudget = 0;
    const activeCustomers = new Set<string>();
    const byOem = new Map<string, { oemId: string; name: string; openCount: number; openValue: number; wonCount: number }>();

    for (const o of opportunities) {
      if (o.stage === OpportunityStage.NEW) newCount++;
      else if (inProgressStages.includes(o.stage)) inProgressCount++;
      else if (o.stage === OpportunityStage.PROPOSAL) proposalCount++;
      else if (o.stage === OpportunityStage.NEGOTIATION) negotiationCount++;
      else if (o.stage === OpportunityStage.WON) wonCount++;
      else if (o.stage === OpportunityStage.LOST) lostCount++;

      const isOpen = o.stage !== OpportunityStage.WON && o.stage !== OpportunityStage.LOST;
      const value = openValue(o);
      if (o.stage === OpportunityStage.WON) {
        wonValue += o.finalValue ?? value;
      } else if (isOpen) {
        pipelineValue += value;
        weightedPipeline += value * ((o.probability ?? 0) / 100);
        openClientBudget += o.clientBudget ?? 0;
        if (o.customerId) activeCustomers.add(o.customerId);
      }

      for (const link of o.oems) {
        const row = byOem.get(link.oem.id) ?? { oemId: link.oem.id, name: link.oem.name, openCount: 0, openValue: 0, wonCount: 0 };
        if (o.stage === OpportunityStage.WON) row.wonCount++;
        else if (isOpen) {
          row.openCount++;
          // Without a per-OEM split, attribute the deal's value evenly.
          row.openValue += link.value ?? value / o.oems.length;
        }
        byOem.set(link.oem.id, row);
      }
    }

    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : 0;
    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      total: opportunities.length,
      new: newCount,
      inProgress: inProgressCount,
      proposals: proposalCount,
      negotiation: negotiationCount,
      won: wonCount,
      lost: lostCount,
      pipelineValue: round(pipelineValue),
      weightedPipeline: round(weightedPipeline),
      openClientBudget: round(openClientBudget),
      wonValue: round(wonValue),
      winRate,
      activeCustomers: activeCustomers.size,
      byOem: [...byOem.values()]
        .map((r) => ({ ...r, openValue: round(r.openValue) }))
        .sort((a, b) => b.openValue - a.openValue),
    };
  }
}
