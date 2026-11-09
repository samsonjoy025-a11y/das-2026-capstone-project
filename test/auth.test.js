// Build 7: signup, login, bad/expired tokens, wrong role, and booking privacy.

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketingServer } from '../src/server.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { signToken } from '../src/lib/token.js';
import { TOKEN_SECRET } from '../src/config.js';

describe('Build 7 auth and authorization', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = createTicketingServer({ repository: createMemoryRepository() });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function call(method, path, { token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  const assertError = (result, status, code) => {
    assert.equal(result.status, status);
    assert.equal(result.body.error?.code, code);
  };

  async function signup(overrides = {}) {
    return call('POST', '/api/auth/signup', {
      body: { email: 'ada@example.com', password: 'password123', role: 'attendee', ...overrides },
    });
  }

  it('signup creates an account and returns a token (password never returned)', async () => {
    const res = await signup({ email: 'org@example.com', password: 'password123', role: 'organizer' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'org@example.com');
    assert.equal(res.body.user.role, 'organizer');
    assert.equal(typeof res.body.token, 'string');
    assert.equal('password' in res.body.user, false);
    assert.equal('passwordHash' in res.body.user, false);
  });

  it('rejects a repeated email with EMAIL_TAKEN', async () => {
    assert.equal((await signup()).status, 201);
    assertError(await signup({ password: 'different88' }), 409, 'EMAIL_TAKEN');
  });

  it('login returns a token for correct credentials', async () => {
    await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' });
    const res = await call('POST', '/api/auth/login', { body: { email: 'ada@example.com', password: 'password123' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'ada@example.com');
    assert.equal(typeof res.body.token, 'string');
  });

  it('wrong password and unknown email give the same INVALID_CREDENTIALS error', async () => {
    await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' });
    const wrongPw = await call('POST', '/api/auth/login', { body: { email: 'ada@example.com', password: 'wrongpass99' } });
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'password123' } });
    assertError(wrongPw, 401, 'INVALID_CREDENTIALS');
    assertError(unknown, 401, 'INVALID_CREDENTIALS');
    assert.equal(wrongPw.body.error.message, unknown.body.error.message);
  });

  it('rejects a bad token with UNAUTHENTICATED', async () => {
    assertError(await call('GET', '/api/auth/me', { token: 'not-a-real-token' }), 401, 'UNAUTHENTICATED');
    // alg tampering / nonsense bearer
    assertError(await call('GET', '/api/auth/me', { token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIn0.' }), 401, 'UNAUTHENTICATED');
  });

  it('rejects an expired token with UNAUTHENTICATED', async () => {
    const expired = signToken({ sub: 'u1', role: 'attendee', email: 'x@x.com' }, { expiresInSeconds: -10, secret: TOKEN_SECRET });
    assertError(await call('GET', '/api/auth/me', { token: expired }), 401, 'UNAUTHENTICATED');
  });

  it('rejects the wrong role with FORBIDDEN (attendee cannot create events)', async () => {
    const { body } = await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' });
    const res = await call('POST', '/api/events', {
      token: body.token,
      body: { title: 'Nope', city: 'Lagos', startsAt: '2026-12-05T17:00:00Z' },
    });
    assertError(res, 403, 'FORBIDDEN');
  });

  it("one attendee reading another's booking gets NOT_FOUND", async () => {
    const org = (await signup({ email: 'org@example.com', password: 'password123', role: 'organizer' })).body.token;
    const ada = (await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' })).body.token;
    const bayo = (await signup({ email: 'bayo@example.com', password: 'password123', role: 'attendee' })).body.token;

    const event = (await call('POST', '/api/events', { token: org, body: { title: 'E', city: 'Lagos', startsAt: '2026-12-05T17:00:00Z' } })).body;
    const tier = (await call('POST', `/api/events/${event.id}/tiers`, { token: org, body: { name: 'G', priceCents: 100, capacity: 10 } })).body;
    await call('POST', `/api/events/${event.id}/publish`, { token: org });
    const booking = (await call('POST', '/api/bookings', { token: ada, body: { tierId: tier.id, quantity: 1 } })).body;

    assertError(await call('GET', `/api/bookings/${booking.reference}`, { token: bayo }), 404, 'NOT_FOUND');
    assert.equal((await call('GET', `/api/bookings/${booking.reference}`, { token: ada })).status, 200);
  });
});
