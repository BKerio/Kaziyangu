import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { AttendanceStatus, Role, WorkMode } from '../../shared/types/index.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { Actor, assertCanManageAttachee } from './supervisor-access.js';

export interface CreateAttendanceInput {
  attacheeId: string;
  date: string;
  status?: AttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  workMode?: WorkMode;
  notes?: string;
}

export type UpdateAttendanceInput = Partial<Omit<CreateAttendanceInput, 'attacheeId'>> & {
  verifiedBySupervisor?: boolean;
};

const ATTENDANCE_INCLUDE = {
  attachee: { select: { id: true, name: true, registrationNo: true, organization: true } },
} satisfies Prisma.AttendanceInclude;

/** Attendance logging + supervisor verification for attachees. */
export class AttendanceService {
  constructor(private app: AppContext) {}

  async list(filters: {
    attacheeId?: string;
    /** Restrict to attachees supervised by this staff member (a supervisor's own list view). */
    supervisorId?: string;
    status?: AttendanceStatus;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = {};
    if (filters.attacheeId) where.attacheeId = filters.attacheeId;
    if (filters.supervisorId) where.attachee = { supervisorId: filters.supervisorId };
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.app.prisma.attendance.findMany({
        where, skip, take: limit, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: ATTENDANCE_INCLUDE,
      }),
      this.app.prisma.attendance.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  private async assertAttacheeExists(attacheeId: string) {
    const attachee = await this.app.prisma.user.findFirst({ where: { id: attacheeId, role: Role.ATTACHEE } });
    if (!attachee) throw new NotFoundError('Attachee');
  }

  async create(data: CreateAttendanceInput, actorId: string) {
    await this.assertAttacheeExists(data.attacheeId);

    const record = await this.app.prisma.attendance.create({
      data: {
        attacheeId: data.attacheeId,
        date: new Date(data.date),
        status: data.status ?? AttendanceStatus.PRESENT,
        checkInTime: data.checkInTime,
        checkOutTime: data.checkOutTime,
        workMode: data.workMode ?? WorkMode.ON_SITE,
        notes: data.notes,
      },
      include: ATTENDANCE_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'ATTENDANCE', subjectId: record.id,
      summary: `Logged attendance for ${record.attachee.name}: ${data.date}`,
      newValues: record,
    });

    return record;
  }

  /** `actor` must be a manager or the attachee's assigned supervisor. */
  async update(id: string, data: UpdateAttendanceInput, actor: Actor) {
    const record = await this.app.prisma.attendance.findUnique({ where: { id }, include: ATTENDANCE_INCLUDE });
    if (!record) throw new NotFoundError('Attendance record');
    await assertCanManageAttachee(this.app.prisma, record.attacheeId, actor);

    const updated = await this.app.prisma.attendance.update({
      where: { id },
      data: {
        ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.checkInTime !== undefined ? { checkInTime: data.checkInTime } : {}),
        ...(data.checkOutTime !== undefined ? { checkOutTime: data.checkOutTime } : {}),
        ...(data.workMode !== undefined ? { workMode: data.workMode } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.verifiedBySupervisor !== undefined ? { verifiedBySupervisor: data.verifiedBySupervisor } : {}),
      },
      include: ATTENDANCE_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'ATTENDANCE', subjectId: id,
      summary: `Updated attendance for ${updated.attachee.name}: ${updated.date.toISOString().slice(0, 10)}`,
      oldValues: record,
      newValues: updated,
    });

    return updated;
  }

  async delete(id: string, actorId: string) {
    const record = await this.app.prisma.attendance.findUnique({ where: { id }, include: ATTENDANCE_INCLUDE });
    if (!record) throw new NotFoundError('Attendance record');
    await this.app.prisma.attendance.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'ATTENDANCE', subjectId: id,
      summary: `Deleted attendance record for ${record.attachee.name}: ${record.date.toISOString().slice(0, 10)}`,
      oldValues: record,
    });
  }
}
