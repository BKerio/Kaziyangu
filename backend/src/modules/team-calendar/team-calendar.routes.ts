import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { TeamCalendarService } from './team-calendar.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

// Any internal staff member can see and mark themselves on the shared calendar.
const staffRoles = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];

const markOutSchema = z.object({
  dates: z.array(z.string().min(1)).min(1, 'Select at least one date'),
  reason: z.string().trim().min(2, 'Add a brief reason').max(200, 'Keep the reason under 200 characters'),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);
  return result.data;
}

export function teamCalendarRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new TeamCalendarService(ctx);

  router.use(authenticate);
  router.use(requireRole(staffRoles));

  /** GET /team-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD */
  router.get('/', async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) throw new BadRequestError('from and to are required');
    const data = await service.list(from, to);
    res.send({ ok: true, data });
  });

  /** POST /team-calendar - mark the caller out for one or more dates. */
  router.post('/', async (req, res) => {
    const { dates, reason } = parse(markOutSchema, req.body);
    const data = await service.markOut(req.user.userId, dates, reason);
    res.status(201).send({ ok: true, data });
  });

  /** DELETE /team-calendar/:id - clear a day (own, or any if manager). */
  router.delete('/:id', async (req, res) => {
    await service.remove(req.params.id, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true });
  });

  return router;
}
