import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Department, Role } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';
import { CampaignService, MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH } from './campaign.service.js';

const audienceSchema = z.object({
  everyone: z.boolean().default(false),
  roles: z.array(z.nativeEnum(Role)).default([]),
  departments: z.array(z.nativeEnum(Department)).default([]),
  userIds: z.array(z.string().uuid()).max(500).default([]),
});

const createCampaignSchema = z.object({
  title: z.string().min(1, 'Add a title').max(MAX_TITLE_LENGTH),
  message: z.string().min(1, 'Write a message').max(MAX_MESSAGE_LENGTH),
  channels: z.array(z.enum(['WHATSAPP', 'SMS'])).min(1, 'Choose at least one channel'),
  audience: audienceSchema,
});

/** Mounted at /campaigns - admin-only broadcasts to staff over WhatsApp and SMS. */
export function campaignRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new CampaignService(ctx);

  router.use(authenticate, requireRole([Role.ADMIN, Role.SUPER_ADMIN]));

  /** GET /campaigns/options - channels the server can send on, plus the people picker list. */
  router.get('/options', async (_req, res) => {
    res.send({
      ok: true,
      data: {
        channels: service.availableChannels(),
        people: await service.listPeople(),
        limits: { title: MAX_TITLE_LENGTH, message: MAX_MESSAGE_LENGTH },
      },
    });
  });

  /** POST /campaigns/preview - how many people an audience reaches, before sending. */
  router.post('/preview', async (req, res) => {
    const parsed = audienceSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);
    res.send({ ok: true, data: await service.previewAudience(parsed.data) });
  });

  router.get('/', async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    res.send({ ok: true, ...(await service.list(page, limit)) });
  });

  router.get('/:id', async (req, res) => {
    res.send({ ok: true, data: await service.get(req.params.id) });
  });

  /** POST /campaigns - create and start sending. Returns at once; poll GET /campaigns/:id for progress. */
  router.post('/', async (req, res) => {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);
    const campaign = await service.create({ userId: req.user.userId }, parsed.data);
    res.status(201).send({ ok: true, data: campaign });
  });

  return router;
}
