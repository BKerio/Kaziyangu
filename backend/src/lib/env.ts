/**
 * Environment variable loading & validation.
 *
 * Runs once at import time (before anything else touches process.env),
 * applies defaults, and throws with a clear message if a required variable
 * is missing - so the app refuses to start rather than fail confusingly later.
 */
import 'dotenv/config';

export interface EnvConfig {
  PORT: string;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  // WhatsApp bot (Meta Cloud API) - all optional. The bot stays disabled
  // until every one of these is set; see modules/whatsapp/whatsapp.config.ts.
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  // "Login with Outlook" (Microsoft identity platform) - all optional. Stays
  // disabled until every one of these is set; see modules/auth/microsoft-oauth.config.ts.
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_VALUE?: string;
  MICROSOFT_REDIRECT_URI?: string;
  // Task reminders - SMS (Advanta) - all optional. The SMS channel logs a
  // warning and no-ops until every one of these is set; see
  // modules/reminders/reminder.config.ts.
  ADVANTA_SMS_URL?: string;
  ADVANTA_API_KEY?: string;
  ADVANTA_PARTNER_ID?: string;
  ADVANTA_SHORTCODE?: string;
  // Task reminders - Email (SMTP via nodemailer) - all optional, same
  // opt-in/no-op pattern as the SMS block above.
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
}

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'] as const;

function loadEnv(): EnvConfig {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters long');
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of development|production|test, got "${nodeEnv}"`);
  }

  return {
    PORT: process.env.PORT ?? '3000',
    HOST: process.env.HOST ?? '0.0.0.0',
    NODE_ENV: nodeEnv as EnvConfig['NODE_ENV'],
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN?.trim() || undefined,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || undefined,
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID?.trim() || undefined,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID?.trim() || undefined,
    // Azure's app registration page shows two things for a client secret: a
    // "Secret ID" and a "Value" - only the Value is a usable OAuth client
    // secret. MICROSOFT_CLIENT_SECRET (the Secret ID) is intentionally never
    // read here; MICROSOFT_CLIENT_VALUE is the one actually sent to Microsoft.
    MICROSOFT_CLIENT_VALUE: process.env.MICROSOFT_CLIENT_VALUE?.trim() || undefined,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI?.trim() || undefined,
    ADVANTA_SMS_URL: process.env.ADVANTA_SMS_URL?.trim() || undefined,
    ADVANTA_API_KEY: process.env.ADVANTA_API_KEY?.trim() || undefined,
    ADVANTA_PARTNER_ID: process.env.ADVANTA_PARTNER_ID?.trim() || undefined,
    ADVANTA_SHORTCODE: process.env.ADVANTA_SHORTCODE?.trim() || undefined,
    SMTP_HOST: process.env.SMTP_HOST?.trim() || undefined,
    SMTP_PORT: process.env.SMTP_PORT?.trim() || undefined,
    SMTP_USER: process.env.SMTP_USER?.trim() || undefined,
    SMTP_PASS: process.env.SMTP_PASS?.trim() || undefined,
    SMTP_FROM: process.env.SMTP_FROM?.trim() || undefined,
  };
}

export const env: EnvConfig = loadEnv();
