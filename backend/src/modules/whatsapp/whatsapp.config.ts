import { EnvConfig } from '../../lib/env.js';

/**
 * The WhatsApp bot is entirely opt-in: with any of these three unset, the
 * routes module registers no routes at all rather than 500ing on first use.
 */
export function isWhatsAppEnabled(config: EnvConfig): boolean {
  return Boolean(config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_VERIFY_TOKEN);
}

export interface WhatsAppCredentials {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
}

export function requireWhatsAppEnv(config: EnvConfig): WhatsAppCredentials {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN } = config;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_VERIFY_TOKEN) {
    throw new Error(
      'WhatsApp is not configured. Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN.'
    );
  }
  return { token: WHATSAPP_TOKEN, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, verifyToken: WHATSAPP_VERIFY_TOKEN };
}
