import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { AttacheeService } from './attachee.service.js';
import { AttendanceService } from './attendance.service.js';
import { LogbookService } from './logbook.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { AttendanceStatus, Department, ReportStatus, Role, WorkMode } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

const managerRoles = [Role.ADMIN, Role.SUPER_ADMIN];
// Attachees may view/log their own attendance & logbook entries alongside managers.
const selfServiceRoles = [Role.ADMIN, Role.SUPER_ADMIN, Role.ATTACHEE];
// A supervising STAFF member may also view (their own attachees' records are
// enforced in the handler) and verify/review - scoped per-record in the service.
const viewRoles = [Role.ADMIN, Role.SUPER_ADMIN, Role.ATTACHEE, Role.STAFF];
const reviewRoles = [Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF];

// ── Schemas ──────────────────────────────────────────────────────────────────

const createAttacheeSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  passwordRaw: z.string().min(6, 'Password must be at least 6 characters'),
  registrationNo: z.string().min(1, 'Registration number is required'),
  course: z.string().min(1, 'Course is required'),
  department: z.nativeEnum(Department),
  organization: z.string().min(1, 'Host organization is required'),
  supervisorId: z.string().uuid().optional(),
  attachmentStart: z.string().optional(),
  attachmentEnd: z.string().optional(),
  phone: z.string().optional(),
});

const updateAttacheeSchema = createAttacheeSchema
  .omit({ passwordRaw: true, supervisorId: true })
  .partial()
  .extend({
    password: z.string().min(6).optional(),
    isActive: z.boolean().optional(),
    // null explicitly unassigns the supervisor; omitted leaves it unchanged.
    supervisorId: z.string().uuid().nullable().optional(),
  });

const createAttendanceSchema = z.object({
  attacheeId: z.string().uuid(),
  date: z.string().min(1, 'Date is required'),
  status: z.nativeEnum(AttendanceStatus).optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  workMode: z.nativeEnum(WorkMode).optional(),
  notes: z.string().optional(),
});

const updateAttendanceSchema = createAttendanceSchema
  .omit({ attacheeId: true })
  .partial()
  .extend({ verifiedBySupervisor: z.boolean().optional() });

const createReportSchema = z.object({
  attacheeId: z.string().uuid(),
  date: z.string().min(1, 'Date is required'),
  title: z.string().min(2, 'Title is required'),
  description: z.string().min(3, 'Description is required'),
  learnings: z.string().optional(),
  category: z.string().optional(),
  hoursSpent: z.number().min(0).max(24).optional(),
});

const updateReportSchema = createReportSchema
  .omit({ attacheeId: true })
  .partial()
  .extend({
    status: z.nativeEnum(ReportStatus).optional(),
    rating: z.number().int().min(0).max(100).optional(),
    feedback: z.string().optional(),
    supervisorName: z.string().optional(),
  });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);
  return result.data;
}

function pageLimit(q: { page?: string; limit?: string }) {
  return { page: q.page ? parseInt(q.page, 10) : 1, limit: q.limit ? parseInt(q.limit, 10) : 20 };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function attachmentRoutes(ctx: AppContext): Router {
  const router = Router();
  const attacheeService = new AttacheeService(ctx);
  const attendanceService = new AttendanceService(ctx);
  const logbookService = new LogbookService(ctx);

  router.use(authenticate);

  // ── Attachees (roster) - manager-only ─────────────────────────────────────
  router.get('/attachees', requireRole(managerRoles), async (req, res) => {
    const q = req.query as { search?: string; page?: string; limit?: string };
    const result = await attacheeService.list({ search: q.search, ...pageLimit(q) });
    res.send({ ok: true, ...result });
  });

  router.get('/attachees/:id', requireRole(managerRoles), async (req, res) => {
    const attachee = await attacheeService.getById(req.params.id);
    res.send({ ok: true, data: attachee });
  });

  router.post('/attachees', requireRole(managerRoles), async (req, res) => {
    const data = parse(createAttacheeSchema, req.body);
    const attachee = await attacheeService.create(data, req.user.userId);
    res.status(201).send({ ok: true, data: attachee });
  });

  router.patch('/attachees/:id', requireRole(managerRoles), async (req, res) => {
    const data = parse(updateAttacheeSchema, req.body);
    const attachee = await attacheeService.update(req.params.id, data, req.user.userId);
    res.send({ ok: true, data: attachee });
  });

  router.delete('/attachees/:id', requireRole(managerRoles), async (req, res) => {
    await attacheeService.delete(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  // ── My Attachees - the roster a supervising staff member (or manager) owns ─
  router.get('/my-attachees', requireRole(reviewRoles), async (req, res) => {
    const data = await attacheeService.listSupervisedBy(req.user.userId);
    res.send({ ok: true, data });
  });

  // ── Attendance - managers see/manage everyone; a supervisor sees/verifies
  //    only their own attachees; attachees see/log their own ─────────────────
  router.get('/attendance', requireRole(viewRoles), async (req, res) => {
    const q = req.query as { attacheeId?: string; status?: AttendanceStatus; from?: string; to?: string; page?: string; limit?: string };
    // Attachees can only ever see their own records; a supervising staff
    // member is scoped to the attachees assigned to them - the attacheeId
    // query param, if also given, narrows further within that set.
    const attacheeId = req.user.role === Role.ATTACHEE ? req.user.userId : q.attacheeId;
    const supervisorId = req.user.role === Role.STAFF ? req.user.userId : undefined;
    const result = await attendanceService.list({
      attacheeId, supervisorId, status: q.status, from: q.from, to: q.to, ...pageLimit(q),
    });
    res.send({ ok: true, ...result });
  });

  router.post('/attendance', requireRole(selfServiceRoles), async (req, res) => {
    const data = parse(createAttendanceSchema, req.body);
    // An attachee may only ever log attendance for themselves.
    if (req.user.role === Role.ATTACHEE) data.attacheeId = req.user.userId;
    const record = await attendanceService.create(data, req.user.userId);
    res.status(201).send({ ok: true, data: record });
  });

  // Verifying attendance: managers (any attachee) or the assigned supervisor
  // (their own attachees only, enforced in the service) - never the attachee
  // who submitted it. Editing/deleting stays manager-only.
  router.patch('/attendance/:id', requireRole(reviewRoles), async (req, res) => {
    const data = parse(updateAttendanceSchema, req.body);
    const record = await attendanceService.update(req.params.id, data, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true, data: record });
  });

  router.delete('/attendance/:id', requireRole(managerRoles), async (req, res) => {
    await attendanceService.delete(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  // ── Logbook (task reports) - same access pattern as attendance above ──────
  router.get('/reports', requireRole(viewRoles), async (req, res) => {
    const q = req.query as { attacheeId?: string; status?: ReportStatus; page?: string; limit?: string };
    const attacheeId = req.user.role === Role.ATTACHEE ? req.user.userId : q.attacheeId;
    const supervisorId = req.user.role === Role.STAFF ? req.user.userId : undefined;
    const result = await logbookService.list({ attacheeId, supervisorId, status: q.status, ...pageLimit(q) });
    res.send({ ok: true, ...result });
  });

  router.post('/reports', requireRole(selfServiceRoles), async (req, res) => {
    const data = parse(createReportSchema, req.body);
    if (req.user.role === Role.ATTACHEE) data.attacheeId = req.user.userId;
    const report = await logbookService.create(data, req.user.userId);
    res.status(201).send({ ok: true, data: report });
  });

  // Reviewing/grading: managers (any attachee) or the assigned supervisor
  // (their own attachees only, enforced in the service). Editing/deleting
  // the underlying entry stays manager-only.
  router.patch('/reports/:id', requireRole(reviewRoles), async (req, res) => {
    const data = parse(updateReportSchema, req.body);
    const report = await logbookService.update(req.params.id, data, { userId: req.user.userId, role: req.user.role });
    res.send({ ok: true, data: report });
  });

  router.delete('/reports/:id', requireRole(managerRoles), async (req, res) => {
    await logbookService.delete(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  return router;
}
