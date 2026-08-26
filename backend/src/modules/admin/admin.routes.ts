import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { AdminService } from './admin.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Department, Role } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

const adminRoles = [Role.ADMIN, Role.SUPER_ADMIN];
// Attachees are created/managed through the dedicated attachment module
// (see modules/attachments/attachee.service.ts), which also fills in their
// profile fields (registration no., course, host organization, etc.) - this
// generic staff endpoint deliberately can't assign that role.
const staffRoles = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];

// ── Schemas ──────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  email: z.string().email(),
  passwordRaw: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2),
  role: z.enum(staffRoles as [Role, ...Role[]]),
  phone: z.string().optional(),
  department: z.nativeEnum(Department).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  phone: z.string().optional(),
  role: z.enum(staffRoles as [Role, ...Role[]]).optional(),
  isActive: z.boolean().optional(),
  department: z.nativeEnum(Department).optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);
  return result.data;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  const adminService = new AdminService(ctx);

  router.use(authenticate);
  router.use(requireRole(adminRoles));

  router.get('/users', async (req, res) => {
    const q = req.query as { role?: Role; page?: string; limit?: string };
    const result = await adminService.listUsers({
      role: q.role,
      page: parseInt(q.page ?? '1', 10),
      limit: parseInt(q.limit ?? '20', 10),
    });
    res.send({ ok: true, ...result });
  });

  router.get('/users/:id', async (req, res) => {
    const user = await adminService.getUserById(req.params.id);
    res.send({ ok: true, data: user });
  });

  router.post('/users', async (req, res) => {
    const data = parse(createUserSchema, req.body);
    const user = await adminService.createUser(data, req.user.userId);
    res.status(201).send({ ok: true, data: user });
  });

  router.patch('/users/:id', async (req, res) => {
    const data = parse(updateUserSchema, req.body);
    const user = await adminService.updateUser(req.params.id, data, req.user.userId);
    res.send({ ok: true, data: user });
  });

  router.delete('/users/:id', async (req, res) => {
    await adminService.deleteUser(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  /**
   * GET /admin/audit-logs?userId=&action=&subjectType=&from=&to=&page=&limit=
   * The system-wide activity trail - every mutation across the app writes
   * here via AuditLogService.record() (see context.ts / server.ts wiring).
   */
  router.get('/audit-logs', async (req, res) => {
    const q = req.query as {
      userId?: string; action?: string; subjectType?: string; from?: string; to?: string; page?: string; limit?: string;
    };
    const result = await ctx.auditLog.list({
      userId: q.userId, action: q.action, subjectType: q.subjectType, from: q.from, to: q.to,
      page: q.page ? parseInt(q.page, 10) : 1,
      limit: q.limit ? parseInt(q.limit, 10) : 20,
    });
    res.send({ ok: true, ...result });
  });

  return router;
}
