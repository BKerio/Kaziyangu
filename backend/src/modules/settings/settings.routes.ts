import { Router } from 'express';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role } from '../../shared/types/index.js';
import { WhatsAppStatusService } from './whatsapp-status.service.js';

/** Mounted at /settings - admin-only, read-only view of integrations. */
export function settingsRoutes(ctx: AppContext): Router {
  const router = Router();
  const whatsapp = new WhatsAppStatusService(ctx);

  router.use(authenticate, requireRole([Role.ADMIN, Role.SUPER_ADMIN]));

  /** GET /settings/whatsapp?refresh=1 - phone number, account, token health, templates, limits and usage. */
  router.get('/whatsapp', async (req, res) => {
    res.send({ ok: true, data: await whatsapp.overview(req.query.refresh === '1') });
  });

  return router;
}
