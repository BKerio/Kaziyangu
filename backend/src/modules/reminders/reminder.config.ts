import { EnvConfig } from '../../lib/env.js';

/**
 * Each reminder channel is independently opt-in, mirroring
 * modules/whatsapp/whatsapp.config.ts: an unconfigured channel doesn't break
 * reminder creation, it just no-ops (and logs) whenever the scheduler tries
 * to actually send on it.
 */
export function isSmsEnabled(config: EnvConfig): boolean {
  return Boolean(config.ADVANTA_SMS_URL && config.ADVANTA_API_KEY && config.ADVANTA_PARTNER_ID && config.ADVANTA_SHORTCODE);
}

export function isEmailEnabled(config: EnvConfig): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_USER && config.SMTP_PASS);
}

export interface AdvantaCredentials {
  url: string;
  apiKey: string;
  partnerId: string;
  shortcode: string;
}

export function requireAdvantaEnv(config: EnvConfig): AdvantaCredentials {
  const { ADVANTA_SMS_URL, ADVANTA_API_KEY, ADVANTA_PARTNER_ID, ADVANTA_SHORTCODE } = config;
  if (!ADVANTA_SMS_URL || !ADVANTA_API_KEY || !ADVANTA_PARTNER_ID || !ADVANTA_SHORTCODE) {
    throw new Error('SMS is not configured. Set ADVANTA_SMS_URL, ADVANTA_API_KEY, ADVANTA_PARTNER_ID, and ADVANTA_SHORTCODE.');
  }
  return { url: ADVANTA_SMS_URL, apiKey: ADVANTA_API_KEY, partnerId: ADVANTA_PARTNER_ID, shortcode: ADVANTA_SHORTCODE };
}

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function requireSmtpEnv(config: EnvConfig): SmtpCredentials {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = config;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.');
  }
  return { host: SMTP_HOST, port: parseInt(SMTP_PORT, 10), user: SMTP_USER, pass: SMTP_PASS, from: SMTP_FROM || SMTP_USER };
}
