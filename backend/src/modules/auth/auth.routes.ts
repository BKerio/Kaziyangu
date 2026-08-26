import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { AuthService } from './auth.service.js';
import { isMicrosoftAuthEnabled } from './microsoft-oauth.config.js';
import { MicrosoftOAuthService } from './microsoft-oauth.service.js';
import { MicrosoftAccountService } from './microsoft-account.service.js';
import { BadRequestError } from '../../shared/errors/AppError.js';
import { authenticate } from '../../middleware/auth.js';
import { signOAuthState, signToken, verifyOAuthState } from '../../lib/jwt.js';

/** Only ever follow a same-app relative path from a `redirect` param - never an absolute/protocol-relative URL. */
function safeRedirectPath(path: unknown): string | undefined {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return undefined;
  return path;
}

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  passwordRaw: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  passwordRaw: z.string().min(1, 'Password is required'),
});

const updateMeSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').optional(),
    phone: z.string().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
  })
  .refine((data) => !data.newPassword || !!data.currentPassword, {
    message: 'Current password is required to set a new password',
    path: ['currentPassword'],
  });

export function authRoutes(ctx: AppContext): Router {
  const router = Router();
  const authService = new AuthService(ctx);

  router.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0].message);
    }

    const user = await authService.register(parsed.data);
    res.status(201).send({ ok: true, data: user });
  });

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0].message);
    }

    const result = await authService.login(parsed.data);
    res.send({ ok: true, data: result });
  });

  router.get('/me', authenticate, async (req, res) => {
    const profile = await authService.getProfile(req.user.userId);
    res.send({ ok: true, data: profile });
  });

  router.patch('/me', authenticate, async (req, res) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0].message);
    }

    const user = await authService.updateProfile(req.user.userId, parsed.data);
    res.send({ ok: true, data: user });
  });

  // ── "Login with Outlook" (Microsoft identity platform) - opt-in; routes
  //    only exist when every MICROSOFT_* env var is set. Login/callback are
  //    redirect-based (not JSON), since that's a browser navigation flow, not
  //    an API call: the account must already exist (matched by email) - this
  //    signs into an existing account rather than self-provisioning a new
  //    one. The same flow also doubles as "connect my calendar", since a
  //    successful login with offline_access always (re)saves a refresh
  //    token for the signed-in user. ─────────────────────────────────────────
  if (isMicrosoftAuthEnabled(ctx.config)) {
    const microsoft = new MicrosoftOAuthService(ctx.config, ctx.log);
    const microsoftAccounts = new MicrosoftAccountService(ctx, microsoft);
    // Where to send the browser back to once we're done - falls back to the
    // typical local dev origin when CORS_ORIGIN isn't a real URL (e.g. "*").
    const frontendOrigin = ctx.config.CORS_ORIGIN.startsWith('http') ? ctx.config.CORS_ORIGIN : 'http://localhost:5173';

    router.get('/microsoft/login', (req, res) => {
      const redirectPath = safeRedirectPath(req.query.redirect);
      res.redirect(microsoft.buildAuthorizationUrl(signOAuthState(redirectPath)));
    });

    // Path must exactly match MICROSOFT_REDIRECT_URI as registered in Azure -
    // this router is also mounted at /api/auth (see app.ts) for that reason.
    router.get('/microsoft/callback', async (req, res) => {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
      const parsedState = state ? verifyOAuthState(state) : null;

      if (error || !code || !parsedState) {
        res.redirect(`${frontendOrigin}/login?error=microsoft_auth_failed`);
        return;
      }

      const tokens = await microsoft.exchangeCodeForTokens(code);
      const profile = tokens ? await microsoft.fetchProfile(tokens.accessToken) : null;
      if (!tokens || !profile) {
        res.redirect(`${frontendOrigin}/login?error=microsoft_auth_failed`);
        return;
      }

      // Case-insensitive: we don't control how Microsoft capitalizes the email.
      const user = await ctx.prisma.user.findFirst({ where: { email: { equals: profile.email, mode: 'insensitive' } } });
      if (!user || !user.isActive) {
        res.redirect(`${frontendOrigin}/login?error=no_account&email=${encodeURIComponent(profile.email)}`);
        return;
      }

      await microsoftAccounts.saveTokens(user.id, { refreshToken: tokens.refreshToken, scope: tokens.scope });

      const appToken = signToken({ userId: user.id, role: user.role });
      const redirectQuery = parsedState.redirectPath ? `&redirect=${encodeURIComponent(parsedState.redirectPath)}` : '';
      res.redirect(`${frontendOrigin}/auth/callback?token=${encodeURIComponent(appToken)}${redirectQuery}`);
    });

    router.get('/microsoft/status', authenticate, async (req, res) => {
      const connected = await microsoftAccounts.isConnected(req.user.userId);
      res.send({ ok: true, data: { connected } });
    });

    router.delete('/microsoft/connection', authenticate, async (req, res) => {
      await microsoftAccounts.disconnect(req.user.userId);
      res.send({ ok: true });
    });

    /** GET /auth/microsoft/calendar?days=14 - the signed-in user's own upcoming Outlook events. */
    router.get('/microsoft/calendar', authenticate, async (req, res) => {
      const accessToken = await microsoftAccounts.getValidAccessToken(req.user.userId);
      if (!accessToken) {
        res.send({ ok: true, data: { connected: false, events: [] } });
        return;
      }

      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '14'), 10) || 14, 1), 60);
      const from = new Date();
      const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
      const events = await microsoft.fetchCalendarEvents(accessToken, from.toISOString(), to.toISOString());

      res.send({ ok: true, data: { connected: true, events: events ?? [] } });
    });
  }

  return router;
}
