import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { ReportStatus, Role } from '../../shared/types/index.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { Actor, assertCanManageAttachee } from './supervisor-access.js';

export interface CreateReportInput {
  attacheeId: string;
  date: string;
  title: string;
  description: string;
  learnings?: string;
  category?: string;
  hoursSpent?: number;
}

export type UpdateReportInput = Partial<Omit<CreateReportInput, 'attacheeId'>> & {
  status?: ReportStatus;
  rating?: number;
  feedback?: string;
  supervisorName?: string;
};

const REPORT_INCLUDE = {
  attachee: { select: { id: true, name: true, registrationNo: true, organization: true } },
} satisfies Prisma.TaskReportInclude;

/** Attachee logbook (task report) submissions + supervisor grading/review. */
export class LogbookService {
  constructor(private app: AppContext) {}

  async list(filters: {
    attacheeId?: string;
    /** Restrict to attachees supervised by this staff member (a supervisor's own list view). */
    supervisorId?: string;
    status?: ReportStatus;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.TaskReportWhereInput = {};
    if (filters.attacheeId) where.attacheeId = filters.attacheeId;
    if (filters.supervisorId) where.attachee = { supervisorId: filters.supervisorId };
    if (filters.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      this.app.prisma.taskReport.findMany({
        where, skip, take: limit, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: REPORT_INCLUDE,
      }),
      this.app.prisma.taskReport.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  private async assertAttacheeExists(attacheeId: string) {
    const attachee = await this.app.prisma.user.findFirst({ where: { id: attacheeId, role: Role.ATTACHEE } });
    if (!attachee) throw new NotFoundError('Attachee');
  }

  async create(data: CreateReportInput, actorId: string) {
    await this.assertAttacheeExists(data.attacheeId);

    const report = await this.app.prisma.taskReport.create({
      data: {
        attacheeId: data.attacheeId,
        date: new Date(data.date),
        title: data.title,
        description: data.description,
        learnings: data.learnings,
        category: data.category,
        hoursSpent: data.hoursSpent ?? 0,
        status: ReportStatus.PENDING,
      },
      include: REPORT_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'TASK_REPORT', subjectId: report.id,
      summary: `Submitted logbook entry: ${report.title}`,
      newValues: report,
    });

    return report;
  }

  /**
   * Update the report content, and/or record a supervisor's review
   * (status/rating/feedback). `actor` must be a manager or the attachee's
   * assigned supervisor.
   */
  async update(id: string, data: UpdateReportInput, actor: Actor) {
    const report = await this.app.prisma.taskReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundError('Task report');
    await assertCanManageAttachee(this.app.prisma, report.attacheeId, actor);

    const isReview = data.status !== undefined || data.rating !== undefined || data.feedback !== undefined;

    const updated = await this.app.prisma.taskReport.update({
      where: { id },
      data: {
        ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.learnings !== undefined ? { learnings: data.learnings } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.hoursSpent !== undefined ? { hoursSpent: data.hoursSpent } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.rating !== undefined ? { rating: data.rating } : {}),
        ...(data.feedback !== undefined ? { feedback: data.feedback } : {}),
        ...(data.supervisorName !== undefined ? { supervisorName: data.supervisorName } : {}),
        ...(isReview ? { reviewedAt: new Date() } : {}),
      },
      include: REPORT_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'TASK_REPORT', subjectId: id,
      summary: `${isReview ? 'Reviewed' : 'Updated'} logbook entry: ${updated.title}`,
      oldValues: report,
      newValues: updated,
    });

    return updated;
  }

  async delete(id: string, actorId: string) {
    const report = await this.app.prisma.taskReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundError('Task report');
    await this.app.prisma.taskReport.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'TASK_REPORT', subjectId: id,
      summary: `Deleted logbook entry: ${report.title}`,
      oldValues: report,
    });
  }
}
