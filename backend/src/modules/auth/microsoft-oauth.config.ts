import { EnvConfig } from '../../lib/env.js';

/**
 * "Login with Outlook" is entirely opt-in: with any of these unset, the
 * routes stay unregistered rather than 500ing on first use - same pattern as
 * modules/whatsapp/whatsapp.config.ts.
 */
export function isMicrosoftAuthEnabled(config: EnvConfig): boolean {
  return Boolean(
    config.MICROSOFT_CLIENT_ID && config.MICROSOFT_TENANT_ID && config.MICROSOFT_CLIENT_VALUE && config.MICROSOFT_REDIRECT_URI
  );
}

export interface MicrosoftOAuthCredentials {
  clientId: string;
  tenantId: string;
  clientSecret: string;
  redirectUri: string;
}

export function requireMicrosoftAuthEnv(config: EnvConfig): MicrosoftOAuthCredentials {
  const { MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_VALUE, MICROSOFT_REDIRECT_URI } = config;
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_TENANT_ID || !MICROSOFT_CLIENT_VALUE || !MICROSOFT_REDIRECT_URI) {
    throw new Error(
      'Microsoft login is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_VALUE, and MICROSOFT_REDIRECT_URI.'
    );
  }
  return {
    clientId: MICROSOFT_CLIENT_ID,
    tenantId: MICROSOFT_TENANT_ID,
    clientSecret: MICROSOFT_CLIENT_VALUE,
    redirectUri: MICROSOFT_REDIRECT_URI,
  };
}
