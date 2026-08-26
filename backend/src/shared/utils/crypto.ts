import crypto from 'node:crypto';
import { env } from '../../lib/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

// Derives a stable 32-byte key from JWT_SECRET rather than requiring a
// separate encryption-key env var - scrypt with a fixed, purpose-specific
// salt keeps this key distinct from JWT signing even though it comes from
// the same secret.
const KEY = crypto.scryptSync(env.JWT_SECRET, 'microsoft-oauth-token-v1', 32);

/** Encrypts a secret (e.g. an OAuth refresh token) for storage. Returns base64(iv || authTag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/** Reverses encryptSecret(). Throws if the payload was tampered with or the key doesn't match. */
export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const encrypted = raw.subarray(IV_BYTES + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
