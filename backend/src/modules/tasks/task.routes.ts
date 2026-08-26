import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { TaskService } from './task.service.js';
import { TaskAttachmentService } from './task-attachment.service.js';
import { getTaskOptions } from './task-options.js';
import { authenticate } from '../../middleware/auth.js';
import { taskAttachmentUpload } from '../../middleware/upload.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

const managerRoles = [Role.ADMIN, Role.SUPER_ADMIN];

const createTaskSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  vertical: z.nativeEnum(TaskVertical),
  category: z.nativeEnum(TaskCategory),
  description: z.string().min(3, 'Task description is required'),
  customerProject: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  hoursSpent: z.number().min(0).max(24).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  percentComplete: z.number().int().min(0).max(100).optional(),
  keyDeliverable: z.string().optional(),
  blockersNotes: z.string().optional(),
  userId: z.string().uuid().optional(),
});

const updateTaskSchema = createTaskSchema.omit({ userId: true }).partial();

export function taskRoutes(ctx: AppContext): Router {
  const router = Router();
  const taskService = new TaskService(ctx);
  const attachmentService = new TaskAttachmentService(ctx);

  router.use(authenticate);

  /**
   * GET /tasks/options
   * Vertical / category / status dropdown options with display labels.
   */
  router.get('/options', (_req, res) => {
    res.send({ ok: true, data: getTaskOptions() });
  });

  /**
   * GET /tasks/my-stats?from=&to=
   * Personal vertical/category hour mix for the signed-in user (sidebar tracker).
   * Defaults to the last 30 days.
   */
  router.get('/my-stats', async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    const data = await taskService.getMyTimeStats(req.user.userId, { from, to });
    res.send({ ok: true, data });
  });

  /**
   * GET /tasks/reports/resource-weekly?weekStart=YYYY-MM-DD
   * Per-person weekly hours breakdown (mirrors the "Resource C & W Tracker" sheet).
   */
  router.get('/reports/resource-weekly', requireRole(managerRoles), async (req, res) => {
    const weekStart = req.query.weekStart as string | undefined;
    const data = await taskService.getResourceWeeklyReport(weekStart);
    res.send({ ok: true, data });
  });

  /**
   * GET /tasks/reports/vertical-weekly?weekStart=YYYY-MM-DD
   * Per-vertical weekly rollup (mirrors the "Weekly Vertical Summary" sheet).
   */
  router.get('/reports/vertical-weekly', requireRole(managerRoles), async (req, res) => {
    const weekStart = req.query.weekStart as string | undefined;
    const data = await taskService.getVerticalWeeklySummary(weekStart);
    res.send({ ok: true, data });
  });

  /**
   * GET /tasks/reports/org-overview?weekStart=YYYY-MM-DD
   * Headcount by department (staff + attachees), this week's task status mix,
   * and a per-member task-load histogram - powers the Vertical Summary charts.
   */
  router.get('/reports/org-overview', requireRole(managerRoles), async (req, res) => {
    const weekStart = req.query.weekStart as string | undefined;
    const data = await taskService.getOrgOverview(weekStart);
    res.send({ ok: true, data });
  });

  /**
   * POST /tasks
   * Log a new daily task. Staff log their own; Admin/Super Admin may pass
   * `userId` to log on behalf of someone else.
   */
  router.post('/', async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);

    const task = await taskService.createTask({ userId: req.user.userId, role: req.user.role }, parsed.data);
    res.status(201).send({ ok: true, data: task });
  });

  /**
   * GET /tasks?userId=&vertical=&category=&status=&from=&to=&page=&limit=
   * Staff see only their own tasks; Admin/Super Admin can filter by any user
   * or omit userId to see everyone's.
   */
  router.get('/', async (req, res) => {
    const q = req.query as {
      userId?: string; vertical?: TaskVertical; category?: TaskCategory; status?: TaskStatus;
      from?: string; to?: string; page?: string; limit?: string;
    };
    const result = await taskService.getTasks(
      { userId: req.user.userId, role: req.user.role },
      {
        userId: q.userId,
        vertical: q.vertical,
        category: q.category,
        status: q.status,
        from: q.from,
        to: q.to,
        page: q.page ? parseInt(q.page, 10) : 1,
        limit: q.limit ? parseInt(q.limit, 10) : 20,
      }
    );
    res.send({ ok: true, ...result });
  });

  /** GET /tasks/:id */
  router.get('/:id', async (req, res) => {
    const task = await taskService.getTaskById(req.params.id, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true, data: task });
  });

  /** PATCH /tasks/:id */
  router.patch('/:id', async (req, res) => {
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);

    const task = await taskService.updateTask(
      req.params.id,
      { userId: req.user.userId, role: req.user.role },
      parsed.data
    );
    res.send({ ok: true, data: task });
  });

  /** DELETE /tasks/:id */
  router.delete('/:id', async (req, res) => {
    await taskService.deleteTask(req.params.id, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true });
  });

  // ── Attachments - screenshots (or a PDF) attached to a task as proof of
  //    work. Same ownership rule as the task itself: the logger, or any
  //    Admin/Super Admin, may view/add/remove. ──────────────────────────────

  /** GET /tasks/:id/attachments */
  router.get('/:id/attachments', async (req, res) => {
    const data = await attachmentService.list(req.params.id, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true, data });
  });

  /** POST /tasks/:id/attachments - multipart, field name "files" (up to 5 at a time). */
  router.post('/:id/attachments', taskAttachmentUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError('At least one file is required');

    const data = await attachmentService.addMany(
      req.params.id,
      { userId: req.user.userId, role: req.user.role },
      files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype, originalName: f.originalname, size: f.size }))
    );
    res.status(201).send({ ok: true, data });
  });

  /** GET /tasks/:id/attachments/:attachmentId/file - streams the raw file (viewable in an <img>/<iframe> tag). */
  router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
    const attachment = await attachmentService.getFile(req.params.id, req.params.attachmentId, {
      userId: req.user.userId,
      role: req.user.role,
    });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    // The frontend embeds this in an <iframe> (e.g. a PDF preview) from its own
    // origin - helmet's default X-Frame-Options: SAMEORIGIN would block that
    // even though it's our own app doing the embedding.
    res.removeHeader('X-Frame-Options');
    res.sendFile(attachment.path);
  });

  /** DELETE /tasks/:id/attachments/:attachmentId */
  router.delete('/:id/attachments/:attachmentId', async (req, res) => {
    await attachmentService.remove(req.params.id, req.params.attachmentId, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true });
  });

  return router;
}
