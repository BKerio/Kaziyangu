import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { AppContext } from './context.js';
import { env } from './lib/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { taskRoutes } from './modules/tasks/task.routes.js';
import { attachmentRoutes } from './modules/attachments/attachment.routes.js';
import { opportunityRoutes } from './modules/opportunities/opportunity.routes.js';
import { teamCalendarRoutes } from './modules/team-calendar/team-calendar.routes.js';
import { reminderRoutes } from './modules/reminders/reminder.routes.js';
import { whatsappRoutes } from './modules/whatsapp/whatsapp.routes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

/**
 * Builds and returns the configured Express application instance.
 * Separating app creation from server startup allows for clean testing.
 */
export function buildApp(ctx: AppContext): Express {
  const app = express();

  // Structured request logging (Pino)
  app.use(pinoHttp({ logger: ctx.log }));

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production',
      // The frontend is intentionally a different origin (its own dev server
      // port, or a separate domain in production) and CORS is already wide
      // open below - helmet's default `same-origin` Cross-Origin-Resource-Policy
      // would otherwise block the frontend's own <img>/<iframe> tags from
      // loading authenticated files (task/opportunity attachments) straight
      // from this API, even though the request itself is allowed.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '2mb' }));

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.send({ ok: true, service: 'Org Task Management API', version: '1.0.0' });
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  // Mounted at both paths: /auth matches this app's convention, while
  // /api/auth is also registered because MICROSOFT_REDIRECT_URI (set in the
  // Azure app registration) points at /api/auth/microsoft/callback.
  const auth = authRoutes(ctx);
  app.use('/auth', auth);
  app.use('/api/auth', auth);
  app.use('/admin', adminRoutes(ctx));
  app.use('/tasks', taskRoutes(ctx));
  app.use('/attachments', attachmentRoutes(ctx));
  app.use('/opportunities', opportunityRoutes(ctx));
  app.use('/team-calendar', teamCalendarRoutes(ctx));
  app.use('/reminders', reminderRoutes(ctx));

  // Mounted at both paths: /whatsapp matches this app's convention, while
  // /api/whatsapp is kept as an alias since that's the callback URL already
  // configured in the Meta App dashboard (from the earlier src-design setup)
  // - re-pointing it there would mean re-verifying the webhook in Meta.
  const whatsapp = whatsappRoutes(ctx);
  app.use('/whatsapp', whatsapp);
  app.use('/api/whatsapp', whatsapp);

  app.use(notFoundHandler);
  // Error handler MUST be registered last, and MUST take 4 args for Express
  // to recognize it as an error handler.
  app.use(errorHandler);

  return app;
}
