import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { TICKET_SECRET } from '../config.js';

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

// Payload holds only booking reference and issued-at time (no name/email).
export function signTicketToken(reference, { secret = TICKET_SECRET, nowSeconds } = {}) {
  if (!reference || typeof reference !== 'string') {
    throw new DomainError('VALIDATION', 'reference is required');
  }
  const payload = { ref: String(reference).toUpperCase(), iat: nowSeconds ?? Math.floor(Date.now() / 1000) };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${b64urlEncode(sig)}`;
}

export function verifyTicketToken(token, { secret = TICKET_SECRET } = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  }
  const parts = token.split('.');
  if (parts.length !== 2) throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  const [encoded, encodedSig] = parts;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString('utf8'));
  } catch {
    throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  }
  const expected = createHmac('sha256', secret).update(encoded).digest();
  let actual;
  try {
    actual = b64urlDecode(encodedSig);
  } catch {
    throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  }
  if (!payload || typeof payload.ref !== 'string' || typeof payload.iat !== 'number') {
    throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
  }
  return { ref: payload.ref, iat: payload.iat };
}
