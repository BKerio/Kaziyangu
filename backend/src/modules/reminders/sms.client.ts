import { Logger } from '../../lib/logger.js';
import { EnvConfig } from '../../lib/env.js';
import { AdvantaCredentials, requireAdvantaEnv } from './reminder.config.js';

/**
 * Thin wrapper over the Advanta (QuickSMS) SMS gateway - mirrors the style of
 * whatsapp.client.ts: failures are logged and swallowed (returned as
 * `false`) rather than thrown, so one bad send doesn't take down a reminder
 * run that may still need to try other channels/reminders.
 */
export class AdvantaSmsClient {
  private readonly creds: AdvantaCredentials;

  constructor(config: EnvConfig, private readonly log: Logger) {
    this.creds = requireAdvantaEnv(config);
  }

  /** `to` is a phone number, e.g. "254712345678". Returns true iff the gateway accepted the send. */
  async sendSms(to: string, message: string): Promise<boolean> {
    try {
      const res = await fetch(this.creds.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: this.creds.apiKey,
          partnerID: this.creds.partnerId,
          shortcode: this.creds.shortcode,
          mobile: to,
          message,
        }),
      });

      if (!res.ok) {
        this.log.error({ status: res.status, body: await res.text().catch(() => undefined) }, 'Advanta SMS API error');
        return false;
      }

      // Advanta returns 200 with a JSON body even for some rejected sends
      // (e.g. invalid number) - a rejection ID prefix is the documented way
      // to tell those apart from a true delivery acceptance.
      const data = (await res.json().catch(() => null)) as { responses?: Array<{ respose_code?: number; 'response-code'?: number }> } | null;
      const code = data?.responses?.[0]?.respose_code ?? data?.responses?.[0]?.['response-code'];
      if (code !== undefined && code !== 200) {
        this.log.error({ code, data }, 'Advanta SMS rejected the message');
        return false;
      }

      return true;
    } catch (err) {
      this.log.error({ err, to }, 'Advanta SMS send errored');
      return false;
    }
  }
}
