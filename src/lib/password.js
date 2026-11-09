import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Passwords are hashed with scrypt + a random salt per password.
// The stored format is: scrypt$N$r$p$saltB64$hashB64
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export function hashPassword(password) {
  const plain = String(password ?? '');
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, n, rr, pp, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (!salt.length || !expected.length) return false;
  const derived = scryptSync(String(password ?? ''), salt, expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
