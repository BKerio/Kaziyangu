import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { ReminderService } from './reminder.service.js';
import { authenticate } from '../../middleware/auth.js';
import { ReminderChannel } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

const createReminderSchema = z.object({
  taskId: z.string().uuid(),
  dueAt: z.string().min(1, 'Due date/time is required'),
  channels: z.array(z.nativeEnum(ReminderChannel)).min(1, 'Pick at least one reminder channel'),
  repeatCount: z.number().int().min(1).max(5),
});

const updateReminderSchema = createReminderSchema.omit({ taskId: true }).partial();

export function reminderRoutes(ctx: AppContext): Router {
  const router = Router();
  const reminderService = new ReminderService(ctx);

  router.use(authenticate);

  /** GET /reminders - the signed-in user's own reminders, with their task attached. */
  router.get('/', async (req, res) => {
    const data = await reminderService.listMine({ userId: req.user.userId, role: req.user.role });
    res.send({ ok: true, data });
  });

  /**
   * POST /reminders
   * Set a reminder on one of the caller's own tasks (Admin/Super Admin may
   * set one on anyone's task). One reminder per task - edit it instead of
   * creating a second one.
   */
  router.post('/', async (req, res) => {
    const parsed = createReminderSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);

    const reminder = await reminderService.createReminder({ userId: req.user.userId, role: req.user.role }, parsed.data);
    res.status(201).send({ ok: true, data: reminder });
  });

  /** PATCH /reminders/:id */
  router.patch('/:id', async (req, res) => {
    const parsed = updateReminderSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);

    const reminder = await reminderService.updateReminder(
      req.params.id,
      { userId: req.user.userId, role: req.user.role },
      parsed.data
    );
    res.send({ ok: true, data: reminder });
  });

  /** DELETE /reminders/:id */
  router.delete('/:id', async (req, res) => {
    await reminderService.deleteReminder(req.params.id, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true });
  });

  return router;
}
