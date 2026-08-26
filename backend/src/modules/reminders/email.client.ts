import nodemailer, { Transporter } from 'nodemailer';
import { Logger } from '../../lib/logger.js';
import { EnvConfig } from '../../lib/env.js';
import { requireSmtpEnv, SmtpCredentials } from './reminder.config.js';

/**
 * Thin wrapper over nodemailer's SMTP transport - same "log and return false
 * on failure" contract as sms.client.ts / whatsapp.client.ts, so a bad send
 * never throws out of the reminder scheduler.
 */
export class EmailClient {
  private readonly creds: SmtpCredentials;
  private readonly transporter: Transporter;

  constructor(config: EnvConfig, private readonly log: Logger) {
    this.creds = requireSmtpEnv(config);
    this.transporter = nodemailer.createTransport({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.port === 465,
      auth: { user: this.creds.user, pass: this.creds.pass },
    });
  }

  async sendMail(to: string, subject: string, text: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({ from: this.creds.from, to, subject, text });
      return true;
    } catch (err) {
      this.log.error({ err, to }, 'Reminder email send errored');
      return false;
    }
  }
}
