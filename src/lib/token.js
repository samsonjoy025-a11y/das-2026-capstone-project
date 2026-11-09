import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors.js';

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

function getSecret() {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw new DomainError('INTERNAL_ERROR', 'TOKEN_SECRET is not configured');
  return secret;
}

export function signToken(payload, { expiresInSeconds = 60 * 60, secret = getSecret(), nowSeconds } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = nowSeconds ?? Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + expiresInSeconds };
  const encodedHeader = b64urlEncode(JSON.stringify(header));
  const encodedBody = b64urlEncode(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export function verifyToken(token, { secret = getSecret(), nowSeconds } = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  const [encodedHeader, encodedBody, encodedSig] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(b64urlDecode(encodedBody).toString('utf8'));
  } catch {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  // Reject any token whose header says alg is anything but HS256.
  if (!header || header.alg !== 'HS256') {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = b64urlDecode(encodedSig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  return payload;
}
