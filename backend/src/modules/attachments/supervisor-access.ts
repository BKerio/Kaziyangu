import { PrismaClient } from '../../generated/prisma/index.js';
import { Role } from '../../shared/types/index.js';
import { ForbiddenError } from '../../shared/errors/AppError.js';

export interface Actor {
  userId: string;
  role: Role;
}

/**
 * Throws unless `actor` may manage records belonging to `attacheeId`:
 * ADMIN/SUPER_ADMIN are unrestricted; a STAFF actor must be that attachee's
 * assigned supervisor. Shared by AttendanceService and LogbookService so a
 * supervisor's verify/review privileges stay consistent across both.
 */
export async function assertCanManageAttachee(prisma: PrismaClient, attacheeId: string, actor: Actor): Promise<void> {
  if (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.STAFF) {
    const attachee = await prisma.user.findUnique({ where: { id: attacheeId }, select: { supervisorId: true } });
    if (attachee?.supervisorId === actor.userId) return;
  }
  throw new ForbiddenError('You do not supervise this attachee');
}
