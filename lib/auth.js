// Family Hub - password hashing + session token helpers.
// scrypt "salt:hash" (built-in crypto, no bcrypt dependency).
import crypto from 'node:crypto';

export function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  // Constant-time compare to avoid leaking timing information.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(attempt, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// A well-formed but unmatchable hash. Verify against this when the user is not
// found so login spends the same scrypt time either way (defeats user-enumeration
// timing attacks). 32 hex salt chars + 128 hex hash chars (64 bytes).
export const DUMMY_PASSWORD_HASH = '0'.repeat(32) + ':' + '0'.repeat(128);
