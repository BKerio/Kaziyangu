import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { Department, Role } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { hashPassword } from '../../shared/utils/hash.js';

export interface CreateAttacheeInput {
  name: string;
  email: string;
  passwordRaw: string;
  registrationNo: string;
  course: string;
  department: Department;
  organization: string;
  supervisorId?: string;
  attachmentStart?: string;
  attachmentEnd?: string;
  phone?: string;
}

export type UpdateAttacheeInput = Partial<Omit<CreateAttacheeInput, 'passwordRaw' | 'supervisorId'>> & {
  password?: string;
  isActive?: boolean;
  /** undefined = leave unchanged, null = unassign the supervisor. */
  supervisorId?: string | null;
};

const ATTACHEE_SELECT = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true,
  registrationNo: true, course: true, department: true, organization: true,
  supervisorId: true, supervisor: { select: { id: true, name: true, email: true } },
  attachmentStart: true, attachmentEnd: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

/** Manages the attachee (attachment candidate) roster - profiles that also double as their login accounts. */
export class AttacheeService {
  constructor(private app: AppContext) {}

  async list(filters: { search?: string; page: number; limit: number }) {
    const { search, page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      role: Role.ATTACHEE,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { registrationNo: { contains: search, mode: 'insensitive' } },
              { organization: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.app.prisma.user.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: ATTACHEE_SELECT,
      }),
      this.app.prisma.user.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** The roster a given staff member supervises - powers their "My Attachees" page. */
  async listSupervisedBy(supervisorId: string) {
    return this.app.prisma.user.findMany({
      where: { role: Role.ATTACHEE, supervisorId },
      orderBy: { name: 'asc' },
      select: ATTACHEE_SELECT,
    });
  }

  async getById(id: string) {
    const attachee = await this.app.prisma.user.findFirst({ where: { id, role: Role.ATTACHEE }, select: ATTACHEE_SELECT });
    if (!attachee) throw new NotFoundError('Attachee');
    return attachee;
  }

  /** A supervisor must be a real, non-attachee account - checked before assigning. */
  private async assertValidSupervisor(supervisorId: string | null | undefined) {
    if (!supervisorId) return;
    const supervisor = await this.app.prisma.user.findUnique({ where: { id: supervisorId } });
    if (!supervisor || supervisor.role === Role.ATTACHEE) {
      throw new BadRequestError('The selected supervisor is not a valid staff member');
    }
  }

  async create(data: CreateAttacheeInput, actorId: string) {
    const existing = await this.app.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictError('An account with this email already exists');
    await this.assertValidSupervisor(data.supervisorId);

    const passwordHash = await hashPassword(data.passwordRaw);
    const attachee = await this.app.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        phone: data.phone,
        role: Role.ATTACHEE,
        registrationNo: data.registrationNo,
        course: data.course,
        department: data.department,
        organization: data.organization,
        supervisorId: data.supervisorId,
        attachmentStart: data.attachmentStart ? new Date(data.attachmentStart) : undefined,
        attachmentEnd: data.attachmentEnd ? new Date(data.attachmentEnd) : undefined,
      },
      select: ATTACHEE_SELECT,
    });

    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'USER', subjectId: attachee.id,
      summary: `Created attachee profile: ${attachee.email}`,
      newValues: attachee,
    });

    return attachee;
  }

  async update(id: string, data: UpdateAttacheeInput, actorId: string) {
    const attachee = await this.app.prisma.user.findFirst({ where: { id, role: Role.ATTACHEE } });
    if (!attachee) throw new NotFoundError('Attachee');

    if (data.email && data.email !== attachee.email) {
      const existing = await this.app.prisma.user.findUnique({ where: { email: data.email } });
      if (existing) throw new ConflictError('An account with this email already exists');
    }
    if (data.supervisorId !== undefined) await this.assertValidSupervisor(data.supervisorId);

    const { password, attachmentStart, attachmentEnd, ...rest } = data;
    const updated = await this.app.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
        ...(attachmentStart !== undefined ? { attachmentStart: attachmentStart ? new Date(attachmentStart) : null } : {}),
        ...(attachmentEnd !== undefined ? { attachmentEnd: attachmentEnd ? new Date(attachmentEnd) : null } : {}),
      },
      select: ATTACHEE_SELECT,
    });

    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'USER', subjectId: id,
      summary: `Updated attachee profile${password ? ' (password reset)' : ''}: ${updated.email}`,
      oldValues: attachee,
      newValues: updated,
    });

    return updated;
  }

  async delete(id: string, actorId: string) {
    const attachee = await this.app.prisma.user.findFirst({ where: { id, role: Role.ATTACHEE } });
    if (!attachee) throw new NotFoundError('Attachee');

    try {
      await this.app.prisma.user.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictError(
          'This attachee has attendance or logbook records and cannot be permanently deleted. Deactivate the account instead.'
        );
      }
      throw err;
    }

    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'USER', subjectId: id,
      summary: `Deleted attachee profile: ${attachee.email}`,
      oldValues: attachee,
    });
  }
}
