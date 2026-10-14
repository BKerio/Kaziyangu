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

  private async post(body: Record<string, unknown>): Promise<void> {
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
  }

  async sendMessage(to: string, message: OutgoingMessage): Promise<void> {
    await this.post({ messaging_product: 'whatsapp', to, ...buildPayload(message) });
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
