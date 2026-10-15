import { AppContext } from '../../context.js';

const GRAPH = 'https://graph.facebook.com/v25.0';
// Meta's figures change slowly; caching keeps the page snappy and well under rate limits.
const CACHE_MS = 60_000;

// Unique people the business may start conversations with per rolling 24h.
const TIER_LIMITS: Record<string, number | null> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: null,
};

type Json = Record<string, any>;

/** Safely reads a Graph API object - an error becomes `{ error }` rather than failing the whole overview. */
async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as Json;
    return res.ok ? body : { error: body?.error?.message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed' };
  }
}

/**
 * Read-only overview of the WhatsApp Business setup for the Settings page:
 * the phone number, the business account, the access token's health,
 * templates, the messaging limit, and recent usage. The token itself never
 * leaves the server - only its last few characters are shown.
 */
export class WhatsAppStatusService {
  private cache: { at: number; data: Json } | null = null;

  constructor(private app: AppContext) {}

  async overview(refresh = false): Promise<Json> {
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.data;

    const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId, WHATSAPP_BUSINESS_ACCOUNT_ID: wabaId } = this.app.config;
    const configured = {
      token: Boolean(token),
      phoneNumberId: phoneId ?? null,
      businessAccountId: wabaId ?? null,
      tokenHint: token ? `…${token.slice(-6)}` : null,
    };
    if (!token || !phoneId) {
      return { configured, error: 'WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set in the server .env' };
    }

    const now = Math.floor(Date.now() / 1000);
    const monthAgo = now - 30 * 86_400;

    const [phone, waba, tokenInfo, templates, analytics] = await Promise.all([
      graph(phoneId, token, {
        fields: 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,name_status,status,code_verification_status,platform_type',
      }),
      wabaId
        ? graph(wabaId, token, { fields: 'name,account_review_status,business_verification_status,currency,ownership_type' })
        : Promise.resolve<Json>({ error: 'WHATSAPP_BUSINESS_ACCOUNT_ID is not set' }),
      graph('debug_token', token, { input_token: token }),
      wabaId
        ? graph(`${wabaId}/message_templates`, token, { fields: 'name,status,category,language', limit: '50' })
        : Promise.resolve<Json>({ data: [] }),
      wabaId
        ? graph(wabaId, token, { fields: `analytics.start(${monthAgo}).end(${now}).granularity(DAY)` })
        : Promise.resolve<Json>({}),
    ]);

    const tier = typeof phone.messaging_limit_tier === 'string' ? phone.messaging_limit_tier : null;
    const limit = tier && tier in TIER_LIMITS ? TIER_LIMITS[tier] : null;
    const usedLast24h = await this.businessInitiatedLast24h();

    const points: Json[] = analytics?.analytics?.data_points ?? [];
    const sent30d = points.reduce((sum, p) => sum + (Number(p.sent) || 0), 0);
    const delivered30d = points.reduce((sum, p) => sum + (Number(p.delivered) || 0), 0);

    const td: Json = tokenInfo?.data ?? {};
    const data = {
      configured,
      fetchedAt: new Date().toISOString(),
      phone: phone.error
        ? { error: phone.error }
        : {
            number: phone.display_phone_number,
            verifiedName: phone.verified_name,
            status: phone.status,
            qualityRating: phone.quality_rating,
            nameStatus: phone.name_status,
            verification: phone.code_verification_status,
            platform: phone.platform_type,
            throughput: phone.throughput?.level ?? null,
          },
      businessAccount: waba.error
        ? { error: waba.error }
        : {
            id: wabaId,
            name: waba.name,
            reviewStatus: waba.account_review_status,
            businessVerification: waba.business_verification_status,
            currency: waba.currency,
          },
      token: tokenInfo.error
        ? { error: tokenInfo.error }
        : {
            valid: Boolean(td.is_valid),
            type: td.type ?? null,
            app: td.application ?? null,
            expiresAt: td.expires_at ? new Date(td.expires_at * 1000).toISOString() : null,
            scopes: (td.scopes as string[] | undefined)?.filter((s) => s.startsWith('whatsapp')) ?? [],
          },
      messaging: {
        tier,
        limit,
        usedLast24h,
        remaining: limit == null ? null : Math.max(0, limit - usedLast24h),
        sent30d: points.length ? sent30d : null,
        delivered30d: points.length ? delivered30d : null,
      },
      templates: templates.error
        ? { error: templates.error }
        : ((templates.data as Json[]) ?? []).map((t) => ({ name: t.name, status: t.status, category: t.category, language: t.language })),
    };

    this.cache = { at: Date.now(), data };
    return data;
  }

  /**
   * Unique people this system messaged first (reminders and campaign notices)
   * in the last 24 hours - what counts against Meta's messaging limit. Meta
   * doesn't expose its own running count, so this is our side's tally.
   */
  private async businessInitiatedLast24h(): Promise<number> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [reminders, campaigns] = await Promise.all([
      this.app.prisma.taskReminderLog.findMany({
        where: { channel: 'WHATSAPP', status: 'SENT', sentAt: { gte: since } },
        select: { reminder: { select: { userId: true } } },
      }),
      this.app.prisma.campaignRecipient.findMany({
        where: { channel: 'WHATSAPP', status: 'SENT', sentAt: { gte: since } },
        select: { userId: true },
      }),
    ]);
    return new Set([...reminders.map((r) => r.reminder.userId), ...campaigns.map((c) => c.userId)]).size;
  }
}
