import { AppContext } from '../../context.js';
import { signToken } from '../../lib/jwt.js';
import { hashPassword, comparePassword } from '../../shared/utils/hash.js';
import { Role } from '../../shared/types/index.js';
import { UnauthorizedError, ConflictError, NotFoundError } from '../../shared/errors/AppError.js';

export class AuthService {
  constructor(private app: AppContext) {}

  /**
   * Registers a new user. Self-registration always creates a STAFF account -
   * promotions to ADMIN/SUPER_ADMIN happen via AdminService.updateUser.
   */
  async register(data: { email: string; passwordRaw: string; name: string; phone?: string }) {
    const existingUser = await this.app.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    const passwordHash = await hashPassword(data.passwordRaw);

    const user = await this.app.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        phone: data.phone,
        role: Role.STAFF,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    await this.app.auditLog.record({
      actorId: user.id,
      action: 'REGISTER',
      subjectType: 'USER',
      subjectId: user.id,
      summary: `Self-registered: ${user.email}`,
      newValues: user,
    });

    return user;
  }

  /**
   * Logs in a user and returns a JWT token.
   */
  async login(data: { email: string; passwordRaw: string }) {
    const user = await this.app.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user || !user.isActive) {
      // No FK-able userId when the email doesn't match a real account, so
      // there's nothing to audit-log against in that case.
      if (user) {
        await this.app.auditLog.record({
          actorId: user.id, action: 'LOGIN_FAILED', subjectType: 'USER', subjectId: user.id,
          summary: `Failed login attempt (account inactive): ${user.email}`,
        });
      }
      throw new UnauthorizedError('Invalid email or password');
    }

    const isPasswordValid = await comparePassword(data.passwordRaw, user.passwordHash);
    if (!isPasswordValid) {
      await this.app.auditLog.record({
        actorId: user.id, action: 'LOGIN_FAILED', subjectType: 'USER', subjectId: user.id,
        summary: `Failed login attempt (wrong password): ${user.email}`,
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
    });

    await this.app.auditLog.record({
      actorId: user.id, action: 'LOGIN', subjectType: 'USER', subjectId: user.id,
      summary: `Signed in: ${user.email}`,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department,
      },
    };
  }

  /**
   * Returns the signed-in user's own profile.
   */
  async getProfile(userId: string) {
    const user = await this.app.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        isActive: true, department: true, createdAt: true, updatedAt: true,
      },
    });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  /**
   * Lets the signed-in user update their own name/phone, and optionally
   * change their password (requires the current password). Deliberately
   * excludes email/role/isActive - those stay admin-only (see AdminService.updateUser).
   */
  async updateProfile(
    userId: string,
    data: { name?: string; phone?: string; currentPassword?: string; newPassword?: string }
  ) {
    const user = await this.app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    let passwordHash: string | undefined;
    if (data.newPassword) {
      const isCurrentValid = await comparePassword(data.currentPassword ?? '', user.passwordHash);
      if (!isCurrentValid) throw new UnauthorizedError('Current password is incorrect');
      passwordHash = await hashPassword(data.newPassword);
    }

    const updated = await this.app.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        isActive: true, department: true, createdAt: true, updatedAt: true,
      },
    });

    await this.app.auditLog.record({
      actorId: userId,
      action: 'UPDATE',
      subjectType: 'USER',
      subjectId: userId,
      summary: `Updated own profile${passwordHash ? ' (password changed)' : ''}: ${updated.email}`,
      oldValues: user,
      newValues: updated,
    });

    return updated;
  }
}
