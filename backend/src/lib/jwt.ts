import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { JwtPayload } from '../shared/types/index.js';

/**
 * Thin wrapper around `jsonwebtoken` (replaces @fastify/jwt). Kept as two
 * plain functions rather than a class - there's no state to hold.
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as unknown as JwtPayload;
}

const OAUTH_STATE_PURPOSE = 'oauth-state';

/**
 * Signs a short-lived, stateless CSRF token for an OAuth `state` param (e.g.
 * the Microsoft login redirect) - avoids needing server-side session storage
 * just to verify the callback round-trip came from a request we issued.
 * `redirectPath` rides along so the callback can send the browser back to
 * wherever the flow started (e.g. a "Connect Outlook" button on a specific
 * page) instead of always landing on the role's default page.
 */
export function signOAuthState(redirectPath?: string): string {
  return jwt.sign({ purpose: OAUTH_STATE_PURPOSE, redirectPath }, env.JWT_SECRET, { expiresIn: '10m' });
}

export function verifyOAuthState(state: string): { redirectPath?: string } | null {
  try {
    const payload = jwt.verify(state, env.JWT_SECRET) as { purpose?: string; redirectPath?: string };
    if (payload.purpose !== OAUTH_STATE_PURPOSE) return null;
    return { redirectPath: payload.redirectPath };
  } catch {
    return null;
  }
}
