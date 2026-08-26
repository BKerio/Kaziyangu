import type { PrismaClient } from '../../generated/prisma/index.js';
import { Prisma } from '../../generated/prisma/index.js';
import type { Logger } from '../../lib/logger.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED' | 'REGISTER';

export type AuditSubjectType =
  | 'USER'
  | 'WORK_TASK'
  | 'TASK_ATTACHMENT'
  | 'OPPORTUNITY'
  | 'OPPORTUNITY_ACTIVITY'
  | 'OPPORTUNITY_ATTACHMENT'
  | 'OUT_OF_OFFICE'
  | 'ATTENDANCE'
  | 'TASK_REPORT'
  | 'TASK_REMINDER';

export interface RecordAuditInput {
  actorId: string;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectId: string;
  /** Short human-readable line, e.g. "Updated task: Break fixes for the Proxmox server". */
  summary?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * JSON-round-trips a value so it satisfies Prisma's `Json` input typing
 * (Dates -> ISO strings, `undefined` keys dropped, etc.), and strips
 * `passwordHash` - the audit trail must never persist a credential, even
 * hashed.
 */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const plain = JSON.parse(JSON.stringify(value));
  if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
    delete (plain as Record<string, unknown>).passwordHash;
  }
  return plain as Prisma.InputJsonValue;
}

/**
 * Central write/read point for the system-wide activity trail (`AuditLog`).
 * Every mutating service method across the app calls `record()` right after
 * its mutation, the same way task.service.ts's `broadcast()` is called after
 * every task change - see the individual services for call sites.
 */
export class AuditLogService {
  // Takes the prisma client + logger directly (not the full AppContext) so it
  // can be constructed once in server.ts and handed into `ctx` itself,
  // without a circular "ctx needs auditLog, auditLog needs ctx" dependency.
  constructor(private prisma: PrismaClient, private log: Logger) {}

  /**
   * Writes one audit entry. Never throws - a logging failure must never
   * break the real request it's describing, matching the "log and swallow"
   * contract used by whatsapp.client.ts / the reminder channel clients.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.actorId,
          action: input.action,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          summary: input.summary,
          oldValues: sanitize(input.oldValues),
          newValues: sanitize(input.newValues),
        },
      });
    } catch (err) {
      this.log.error({ err, input }, 'Failed to write audit log entry');
    }
  }

  async list(filters: {
    userId?: string;
    action?: string;
    subjectType?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.subjectType) where.subjectType = filters.subjectType;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
