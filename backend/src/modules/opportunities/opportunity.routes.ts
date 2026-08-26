import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { OpportunityService } from './opportunity.service.js';
import { OpportunityAttachmentService } from './opportunity-attachment.service.js';
import { authenticate } from '../../middleware/auth.js';
import { opportunityAttachmentUpload } from '../../middleware/upload.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ActivityType, OpportunityPriority, OpportunityStage, Role } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';
import { canonicalOpportunityMime } from './attachment-constants.js';

// Any internal staff member can view/create/update - a shared team pipeline,
// same as the rest of the Opportunity Tracker. Deleting stays manager-only.
const staffRoles = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];
const managerRoles = [Role.ADMIN, Role.SUPER_ADMIN];

// ── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(2, 'Opportunity name is required'),
  customerName: z.string().min(1, 'Customer / organization is required'),
  contactPerson: z.string().optional(),
  source: z.string().optional(),
  dateIdentified: z.string().min(1, 'Date identified is required'),
  estimatedValue: z.number().min(0).optional(),
  description: z.string().optional(),
  priority: z.nativeEnum(OpportunityPriority).optional(),
  assignedToId: z.string().uuid().optional(),
  followUpDate: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  stage: z.nativeEnum(OpportunityStage).optional(),

  isGenuine: z.boolean().optional(),
  customerNeed: z.string().optional(),
  budgetConfirmed: z.string().optional(),
  decisionMaker: z.string().optional(),
  expectedTimeline: z.string().optional(),
  probability: z.number().int().min(0).max(100).optional(),

  proposalSubmittedDate: z.string().optional(),
  proposedValue: z.number().min(0).optional(),
  expectedClosingDate: z.string().optional(),

  customerFeedback: z.string().optional(),
  revisedValue: z.number().min(0).optional(),
  negotiationNotes: z.string().optional(),
  competitors: z.string().optional(),

  finalValue: z.number().min(0).optional(),
  contractNumber: z.string().optional(),
  closingDate: z.string().optional(),

  reasonLost: z.string().optional(),
  competitorSelected: z.string().optional(),
  lostValue: z.number().min(0).optional(),
  lessonsLearned: z.string().optional(),
});

const activitySchema = z.object({
  type: z.nativeEnum(ActivityType),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
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

export function opportunityRoutes(ctx: AppContext): Router {
  const router = Router();
  const opportunityService = new OpportunityService(ctx);
  const attachmentService = new OpportunityAttachmentService(ctx);

  router.use(authenticate);
  router.use(requireRole(staffRoles));

  router.get('/stats', async (_req, res) => {
    const stats = await opportunityService.getStats();
    res.send({ ok: true, data: stats });
  });

  router.get('/', async (req, res) => {
    const q = req.query as {
      stage?: OpportunityStage; priority?: OpportunityPriority; assignedToId?: string; search?: string;
      page?: string; limit?: string;
    };
    const result = await opportunityService.list({
      stage: q.stage, priority: q.priority, assignedToId: q.assignedToId, search: q.search, ...pageLimit(q),
    });
    res.send({ ok: true, ...result });
  });

  router.get('/:id', async (req, res) => {
    const opportunity = await opportunityService.getById(req.params.id);
    res.send({ ok: true, data: opportunity });
  });

  router.post('/', async (req, res) => {
    const data = parse(createSchema, req.body);
    const opportunity = await opportunityService.create(data, req.user.userId);
    res.status(201).send({ ok: true, data: opportunity });
  });

  router.patch('/:id', async (req, res) => {
    const data = parse(updateSchema, req.body);
    const opportunity = await opportunityService.update(req.params.id, data, req.user.userId);
    res.send({ ok: true, data: opportunity });
  });

  router.delete('/:id', requireRole(managerRoles), async (req, res) => {
    await opportunityService.delete(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  router.post('/:id/activities', async (req, res) => {
    const data = parse(activitySchema, req.body);
    const activity = await opportunityService.logActivity(req.params.id, data, req.user.userId);
    res.status(201).send({ ok: true, data: activity });
  });

  router.get('/:id/attachments', async (req, res) => {
    const data = await attachmentService.list(req.params.id);
    res.send({ ok: true, data });
  });

  router.post('/:id/attachments', opportunityAttachmentUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError('At least one file is required');

    const data = await attachmentService.addMany(
      req.params.id,
      req.user.userId,
      files.map((f) => ({
        buffer: f.buffer,
        mimeType: canonicalOpportunityMime(f.mimetype, f.originalname),
        originalName: f.originalname,
        size: f.size,
      }))
    );
    res.status(201).send({ ok: true, data });
  });

  router.get('/:id/attachments/:attachmentId/file', async (req, res) => {
    const attachment = await attachmentService.getFile(req.params.id, req.params.attachmentId);
    const isPdf = attachment.mimeType === 'application/pdf';
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${isPdf ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.sendFile(attachment.path);
  });

  router.delete('/:id/attachments/:attachmentId', async (req, res) => {
    await attachmentService.remove(req.params.id, req.params.attachmentId, req.user.userId);
    res.send({ ok: true });
  });

  return router;
}
