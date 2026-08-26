import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { ActivityType, OpportunityPriority, OpportunityStage } from '../../shared/types/index.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { deleteOpportunityAttachmentFile } from './attachment-storage.js';

export interface CreateOpportunityInput {
  name: string;
  customerName: string;
  contactPerson?: string;
  source?: string;
  dateIdentified: string;
  estimatedValue?: number;
  description?: string;
  priority?: OpportunityPriority;
  assignedToId?: string;
  followUpDate?: string;
}

export interface UpdateOpportunityInput extends Partial<Omit<CreateOpportunityInput, 'dateIdentified'>> {
  dateIdentified?: string;
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

const OPPORTUNITY_INCLUDE = {
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.OpportunityInclude;

const DATE_FIELDS = ['dateIdentified', 'followUpDate', 'proposalSubmittedDate', 'expectedClosingDate', 'closingDate'] as const;

/**
 * Converts any provided "YYYY-MM-DD" string fields to Date, leaving others
 * untouched. The date-scalar fields aren't statically known to be strings
 * on the input types (they're declared as `string` there purely for the
 * wire format), so this operates loosely and the caller asserts the Prisma
 * input shape it produces.
 */
function toDateFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of DATE_FIELDS) {
    if (out[key] !== undefined) out[key] = out[key] ? new Date(out[key] as string) : null;
  }
  return out;
}

/** Sales pipeline: opportunity tracking from lead identification through won/lost. */
export class OpportunityService {
  constructor(private app: AppContext) {}

  async list(filters: {
    stage?: OpportunityStage;
    priority?: OpportunityPriority;
    assignedToId?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.OpportunityWhereInput = {};
    if (filters.stage) where.stage = filters.stage;
    if (filters.priority) where.priority = filters.priority;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { customerName: { contains: filters.search, mode: 'insensitive' } },
        { contactPerson: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.app.prisma.opportunity.findMany({
        where, skip, take: limit, orderBy: { updatedAt: 'desc' },
        include: { ...OPPORTUNITY_INCLUDE, _count: { select: { attachments: true } } },
      }),
      this.app.prisma.opportunity.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getById(id: string) {
    const opportunity = await this.app.prisma.opportunity.findUnique({
      where: { id },
      include: {
        ...OPPORTUNITY_INCLUDE,
        activities: {
          orderBy: { date: 'desc' },
          include: { loggedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!opportunity) throw new NotFoundError('Opportunity');
    return opportunity;
  }

  async create(data: CreateOpportunityInput, createdById: string) {
    const createData = {
      ...toDateFields(data as unknown as Record<string, unknown>),
      createdById,
      // Assigning a salesperson at creation time naturally advances the stage.
      stage: data.assignedToId ? OpportunityStage.ASSIGNED : OpportunityStage.NEW,
    } as unknown as Prisma.OpportunityUncheckedCreateInput;

    const opportunity = await this.app.prisma.opportunity.create({ data: createData, include: OPPORTUNITY_INCLUDE });
    await this.app.auditLog.record({
      actorId: createdById, action: 'CREATE', subjectType: 'OPPORTUNITY', subjectId: opportunity.id,
      summary: `Created opportunity: ${opportunity.name}`,
      newValues: opportunity,
    });
    return opportunity;
  }

  async update(id: string, data: UpdateOpportunityInput, actorId: string) {
    const existing = await this.app.prisma.opportunity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Opportunity');

    const updateData = toDateFields(data as unknown as Record<string, unknown>) as unknown as Prisma.OpportunityUncheckedUpdateInput;
    const updated = await this.app.prisma.opportunity.update({ where: { id }, data: updateData, include: OPPORTUNITY_INCLUDE });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'OPPORTUNITY', subjectId: id,
      summary: `Updated opportunity: ${updated.name}`,
      oldValues: existing,
      newValues: updated,
    });
    return updated;
  }

  async delete(id: string, actorId: string) {
    const existing = await this.app.prisma.opportunity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Opportunity');
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
    const opportunity = await this.app.prisma.opportunity.findUnique({ where: { id: opportunityId } });
    if (!opportunity) throw new NotFoundError('Opportunity');

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

  /** Dashboard KPIs shown at the top of the Opportunity Tracker. */
  async getStats() {
    const opportunities = await this.app.prisma.opportunity.findMany({
      select: { stage: true, estimatedValue: true, proposedValue: true, finalValue: true },
    });

    const inProgressStages: OpportunityStage[] = [OpportunityStage.QUALIFICATION, OpportunityStage.ASSIGNED, OpportunityStage.ENGAGEMENT];

    let newCount = 0, inProgressCount = 0, proposalCount = 0, negotiationCount = 0, wonCount = 0, lostCount = 0;
    let pipelineValue = 0, wonValue = 0;

    for (const o of opportunities) {
      if (o.stage === OpportunityStage.NEW) newCount++;
      else if (inProgressStages.includes(o.stage)) inProgressCount++;
      else if (o.stage === OpportunityStage.PROPOSAL) proposalCount++;
      else if (o.stage === OpportunityStage.NEGOTIATION) negotiationCount++;
      else if (o.stage === OpportunityStage.WON) wonCount++;
      else if (o.stage === OpportunityStage.LOST) lostCount++;

      if (o.stage === OpportunityStage.WON) {
        wonValue += o.finalValue ?? o.proposedValue ?? o.estimatedValue ?? 0;
      } else if (o.stage !== OpportunityStage.LOST) {
        pipelineValue += o.proposedValue ?? o.estimatedValue ?? 0;
      }
    }

    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : 0;

    return {
      total: opportunities.length,
      new: newCount,
      inProgress: inProgressCount,
      proposals: proposalCount,
      negotiation: negotiationCount,
      won: wonCount,
      lost: lostCount,
      pipelineValue: Math.round(pipelineValue * 100) / 100,
      wonValue: Math.round(wonValue * 100) / 100,
      winRate,
    };
  }
}
