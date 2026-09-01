import { AppContext } from '../../context.js';
import { Role } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';

const OOO_INCLUDE = {
  user: { select: { id: true, name: true, role: true } },
} as const;

/** Team Collaboration - a shared "who's out" calendar the whole team can see and mark themselves on. */
export class TeamCalendarService {
  constructor(private app: AppContext) {}

  async list(from: string, to: string) {
    return this.app.prisma.outOfOffice.findMany({
      where: { date: { gte: new Date(from), lte: new Date(to) } },
      orderBy: [{ date: 'asc' }],
      include: OOO_INCLUDE,
    });
  }

  /** Active staff/admin roster (attachees excluded, same scope as the rest of this module) - names only. */
  async roster() {
    return this.app.prisma.user.findMany({
      where: { isActive: true, role: { not: Role.ATTACHEE } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Marks the given dates as out-of-office for `userId`. Idempotent - a date
   * already marked is left as-is rather than erroring (the unique constraint
   * on [userId, date] means a plain create would otherwise conflict).
   */
  async markOut(userId: string, dates: string[], reason: string) {
    const results = [];
    for (const date of dates) {
      const entry = await this.app.prisma.outOfOffice.upsert({
        where: { userId_date: { userId, date: new Date(date) } },
        update: { reason },
        create: { userId, date: new Date(date), reason },
        include: OOO_INCLUDE,
      });
      results.push(entry);
      await this.app.auditLog.record({
        actorId: userId, action: 'CREATE', subjectType: 'OUT_OF_OFFICE', subjectId: entry.id,
        summary: `Marked out of office: ${date} (${reason})`,
        newValues: entry,
      });
    }
    return results;
  }

  /** A user may only clear their own days; managers may clear anyone's (typo/cleanup). */
  async remove(id: string, actor: { userId: string; role: Role }) {
    const entry = await this.app.prisma.outOfOffice.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('Out-of-office entry');

    const isManager = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    if (entry.userId !== actor.userId && !isManager) {
      throw new ForbiddenError('You can only clear your own out-of-office days');
    }

    await this.app.prisma.outOfOffice.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'OUT_OF_OFFICE', subjectId: id,
      summary: `Cleared out-of-office day: ${entry.date.toISOString().slice(0, 10)}`,
      oldValues: entry,
    });
  }
}
