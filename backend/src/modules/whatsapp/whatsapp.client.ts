import { Logger } from '../../lib/logger.js';
import { requireWhatsAppEnv, WhatsAppCredentials } from './whatsapp.config.js';
import { EnvConfig } from '../../lib/env.js';
import type { ListRow, ListSection, ReplyButton } from './whatsapp.types.js';

const GRAPH_API_VERSION = 'v20.0';

type OutgoingMessage =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: ReplyButton[] }
  // A flat list of rows (e.g. a picker) renders under one implicit section;
  // pass `sections` instead for a menu grouped under labeled headings.
  | { type: 'list'; text: string; buttonLabel: string; rows: ListRow[] }
  | { type: 'list'; text: string; buttonLabel: string; sections: ListSection[] };

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

function buildPayload(message: OutgoingMessage): Record<string, unknown> {
  if (message.type === 'text') {
    return { type: 'text', text: { body: message.text } };
  }

  if (message.type === 'buttons') {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: message.text },
        action: {
          buttons: message.buttons.map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: button.title },
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
      body: { text: message.text },
      action: {
        button: message.buttonLabel,
        sections,
      },
    },
  };
}
