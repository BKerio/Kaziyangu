import { Logger } from '../../lib/logger.js';
import { requireWhatsAppEnv, WhatsAppCredentials } from './whatsapp.config.js';
import { EnvConfig } from '../../lib/env.js';
import type { ListRow, ListSection, ReplyButton } from './whatsapp.types.js';

const GRAPH_API_VERSION = 'v20.0';

/** Optional bold title line above, and small grey line below, an interactive message. */
interface Chrome {
  header?: string;
  footer?: string;
}

export type OutgoingMessage =
  | { type: 'text'; text: string }
  | ({ type: 'buttons'; text: string; buttons: ReplyButton[] } & Chrome)
  // A flat list of rows (e.g. a picker) renders under one implicit section;
  // pass `sections` instead for a menu grouped under labeled headings.
  | ({ type: 'list'; text: string; buttonLabel: string; rows: ListRow[] } & Chrome)
  | ({ type: 'list'; text: string; buttonLabel: string; sections: ListSection[] } & Chrome);

// Cloud API field limits - anything longer is rejected outright, so every
// outgoing field is trimmed to fit rather than risking a silently lost reply.
const LIMITS = {
  text: 4096,
  body: 1024,
  header: 60,
  footer: 60,
  buttonTitle: 20,
  listButton: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
};

function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A business-scoped user id: two-letter country code, a dot, then letters/digits - e.g. "KE.13491208655302741918". */
export function isBusinessScopedUserId(value: string | undefined): value is string {
  return !!value && /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(value);
}

/**
 * Thin wrapper over the Meta WhatsApp Cloud API. Failures are logged and
 * swallowed here rather than thrown - a bot reply that never arrives
 * shouldn't crash the webhook handler that's already ack'd the request.
 */
export class WhatsAppClient {
  private readonly creds: WhatsAppCredentials;

  constructor(config: EnvConfig, private readonly log: Logger) {
    this.creds = requireWhatsAppEnv(config);
  }

  private apiBase(): string {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.creds.phoneNumberId}`;
  }

  private async post(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`${this.apiBase()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      this.log.error({ status: res.status, body: await res.text().catch(() => undefined) }, 'WhatsApp API error');
    }
    return res.ok;
  }

  /**
   * Sends to a phone number, or - for a sender who uses a WhatsApp username
   * and hides their number - to their business-scoped user id ("KE.1234…"),
   * which Meta addresses via `recipient` with `to` left out entirely.
   * Resolves false if Meta rejected the request.
   */
  async sendMessage(to: string, message: OutgoingMessage): Promise<boolean> {
    const address = isBusinessScopedUserId(to) ? { recipient: to } : { to };
    return this.post({ messaging_product: 'whatsapp', ...address, ...buildPayload(message) });
  }

  /**
   * Sends an approved message template - the only kind of message WhatsApp
   * delivers outside the 24-hour window after someone last wrote to us.
   * Body parameters can't contain newlines or tabs, so they're flattened.
   */
  async sendTemplate(
    to: string,
    name: string,
    language: string,
    bodyParams: string[],
    options: { maxParamLength?: number; quickReplyPayloads?: string[] } = {}
  ): Promise<boolean> {
    const { maxParamLength = 200, quickReplyPayloads = [] } = options;
    const address = isBusinessScopedUserId(to) ? { recipient: to } : { to };
    return this.post({
      messaging_product: 'whatsapp',
      ...address,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text: fit(text.replace(/\s+/g, ' ').trim(), maxParamLength) })),
          },
          // A quick-reply button can carry a hidden payload that comes back
          // when it's tapped - e.g. which notice the person wants to read.
          ...quickReplyPayloads.map((payload, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload }],
          })),
        ],
      },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    } catch {
      // Non-critical; ignore read receipt failures.
    }
  }

  /**
   * Downloads a media object (e.g. a photo sent as a proof-of-work
   * attachment) via the two-step Graph API flow: look up its short-lived
   * download URL by media id, then fetch the bytes from that URL - both
   * requests need the same bearer token. Returns null (and logs) on failure
   * rather than throwing, so a bad/expired media id doesn't crash the bot.
   */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.creds.token}` },
      });
      if (!metaRes.ok) {
        this.log.error({ status: metaRes.status, mediaId }, 'WhatsApp media lookup failed');
        return null;
      }
      const meta = (await metaRes.json()) as { url: string; mime_type: string };

      const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${this.creds.token}` } });
      if (!fileRes.ok) {
        this.log.error({ status: fileRes.status, mediaId }, 'WhatsApp media download failed');
        return null;
      }

      const buffer = Buffer.from(await fileRes.arrayBuffer());
      return { buffer, mimeType: meta.mime_type };
    } catch (err) {
      this.log.error({ err, mediaId }, 'WhatsApp media download errored');
      return null;
    }
  }
}

function chrome(message: Chrome): Record<string, unknown> {
  return {
    ...(message.header ? { header: { type: 'text', text: fit(message.header, LIMITS.header) } } : {}),
    ...(message.footer ? { footer: { text: fit(message.footer, LIMITS.footer) } } : {}),
  };
}

function buildPayload(message: OutgoingMessage): Record<string, unknown> {
  if (message.type === 'text') {
    return { type: 'text', text: { body: fit(message.text, LIMITS.text) } };
  }

  if (message.type === 'buttons') {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...chrome(message),
        body: { text: fit(message.text, LIMITS.body) },
        action: {
          // The API allows at most three reply buttons.
          buttons: message.buttons.slice(0, 3).map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: fit(button.title, LIMITS.buttonTitle) },
          })),
        },
      },
    };
  }

  const sections = 'sections' in message ? message.sections : [{ title: 'Options', rows: message.rows }];
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      ...chrome(message),
      body: { text: fit(message.text, LIMITS.body) },
      action: {
        button: fit(message.buttonLabel, LIMITS.listButton),
        sections: sections.map((section) => ({
          title: fit(section.title, LIMITS.sectionTitle),
          rows: section.rows.map((row) => ({
            id: row.id,
            title: fit(row.title, LIMITS.rowTitle),
            ...(row.description ? { description: fit(row.description, LIMITS.rowDescription) } : {}),
          })),
        })),
      },
    },
  };
}
