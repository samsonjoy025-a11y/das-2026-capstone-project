import { DomainError } from '../domain/errors.js';

// Simple in-memory per-IP rate limiter (fixed window). Suitable for a single process.
export function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function prune(now) {
    // light pruning to avoid unbounded growth
    if (hits.size < 5000) return;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  return {
    check(key) {
      const now = Date.now();
      prune(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      entry.count += 1;
      if (entry.count > max) {
        throw new DomainError('RATE_LIMITED', 'Too many attempts. Try again later.');
      }
    },
    reset() { hits.clear(); },
  };
}

export function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.socket?.remoteAddress || 'unknown';
}
