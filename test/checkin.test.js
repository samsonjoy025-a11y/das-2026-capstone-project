// Build 9: ticket tokens, QR/check-in, forged/duplicate/cancelled, wrong role, simultaneous scans.

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketingServer } from '../src/server.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { signTicketToken } from '../src/lib/ticketToken.js';
import { TICKET_SECRET } from '../src/config.js';

const REPOSITORIES = { memory: createMemoryRepository, sqlite: createSqliteRepository };

for (const [name, makeRepository] of Object.entries(REPOSITORIES)) {
  describe(`Build 9 check-in (${name} repository)`, () => {
    let server;
    let baseUrl;
    let tokens;

    beforeEach(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      server = createTicketingServer({ repository: makeRepository() });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      tokens = {
        organizer: await signup({ email: 'org1@example.com', password: 'password123', role: 'organizer' }),
        staff: await signup({ email: 'staff@example.com', password: 'password123', role: 'staff' }),
        ada: await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' }),
      };
    });

    after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
    });

    async function call(method, path, { token, body } = {}) {
      const headers = {};
      if (token) headers.authorization = `Bearer ${token}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }

    async function signup({ email, password, role }) {
      const res = await call('POST', '/api/auth/signup', { body: { email, password, role } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.token;
    }

    const assertError = (result, status, code) => {
      assert.equal(result.status, status, JSON.stringify(result.body));
      assert.equal(result.body.error?.code, code);
    };

    async function paidBooking() {
      const event = (await call('POST', '/api/events', { token: tokens.organizer, body: { title: 'E', city: 'Lagos', startsAt: '2026-12-05T17:00:00Z' } })).body;
      const tier = (await call('POST', `/api/events/${event.id}/tiers`, { token: tokens.organizer, body: { name: 'G', priceCents: 1000, capacity: 10 } })).body;
      await call('POST', `/api/events/${event.id}/publish`, { token: tokens.organizer });
      const booking = (await call('POST', '/api/bookings', { token: tokens.ada, body: { tierId: tier.id, quantity: 1 } })).body;
      const paid = await call('POST', `/api/bookings/${booking.reference}/pay`, { token: tokens.ada, body: { paymentToken: 'tok_success' } });
      assert.equal(paid.status, 200);
      return { event, tier, booking: paid.body };
    }

    it('a forged token is rejected as INVALID', async () => {
      await paidBooking();
      const forged = signTicketToken('AAAAAA', { secret: 'wrong-secret-not-the-real-one' });
      const res = await call('POST', '/api/checkin', { token: tokens.staff, body: { token: forged } });
      assertError(res, 400, 'INVALID_TICKET');
    });

    it('a tampered/made-up token is rejected as INVALID', async () => {
      await paidBooking();
      assertError(await call('POST', '/api/checkin', { token: tokens.staff, body: { token: 'not.valid.sig' } }), 400, 'INVALID_TICKET');
      assertError(await call('POST', '/api/checkin', { token: tokens.staff, body: { token: '' } }), 400, 'INVALID_TICKET');
    });

    it('a duplicate scan is rejected and shows when it was first used', async () => {
      const { booking } = await paidBooking();
      const ticket = (await call('GET', `/api/bookings/${booking.reference}/ticket`, { token: tokens.ada })).body;
      assert.equal(typeof ticket.token, 'string');
      assert.equal(ticket.token.includes('@'), false); // no email/PII

      const first = await call('POST', '/api/checkin', { token: tokens.staff, body: { token: ticket.token } });
      assert.equal(first.status, 200);
      assert.equal(first.body.status, 'admitted');
      assert.equal(first.body.reference, booking.reference);
      assert.ok(first.body.checkedInAt);

      const second = await call('POST', '/api/checkin', { token: tokens.staff, body: { token: ticket.token } });
      assertError(second, 409, 'DUPLICATE_SCAN');
      assert.match(second.body.error.message, /already used/i);
      assert.match(second.body.error.message, /checked in|used at/i);
    });

    it("a cancelled booking's code is rejected", async () => {
      const { booking } = await paidBooking();
      const ticket = (await call('GET', `/api/bookings/${booking.reference}/ticket`, { token: tokens.ada })).body;
      // cancel the paid booking (refunded) — Build 8
      const cancelled = await call('POST', `/api/bookings/${booking.reference}/cancel`, { token: tokens.ada });
      assert.equal(cancelled.status, 200);
      assert.ok(cancelled.body.status === 'refunded' || cancelled.body.status === 'cancelled');

      const res = await call('POST', '/api/checkin', { token: tokens.staff, body: { token: ticket.token } });
      assertError(res, 400, 'INVALID_TICKET');
      assert.match(res.body.error.message, /cancelled|refunded/i);
    });

    it('a wrong role is rejected with FORBIDDEN', async () => {
      const { booking } = await paidBooking();
      const ticket = (await call('GET', `/api/bookings/${booking.reference}/ticket`, { token: tokens.ada })).body;
      const res = await call('POST', '/api/checkin', { token: tokens.ada, body: { token: ticket.token } });
      assertError(res, 403, 'FORBIDDEN');
    });

    it('two simultaneous scans: exactly one is admitted', async () => {
      const { booking } = await paidBooking();
      const ticket = (await call('GET', `/api/bookings/${booking.reference}/ticket`, { token: tokens.ada })).body;
      const [a, b] = await Promise.all([
        call('POST', '/api/checkin', { token: tokens.staff, body: { token: ticket.token } }),
        call('POST', '/api/checkin', { token: tokens.staff, body: { token: ticket.token } }),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      assert.deepEqual(statuses, [200, 409], `expected one admitted, one duplicate; got ${JSON.stringify([a, b])}`);
      const admitted = a.status === 200 ? a : b;
      const dup = a.status === 409 ? a : b;
      assert.equal(admitted.body.status, 'admitted');
      assert.equal(dup.body.error.code, 'DUPLICATE_SCAN');
    });

    it('check-in requires staff authentication', async () => {
      const res = await call('POST', '/api/checkin', { body: { token: 'x' } });
      assertError(res, 401, 'UNAUTHENTICATED');
    });

    it('ticket token payload contains no name or email', async () => {
      const { booking } = await paidBooking();
      const ticket = (await call('GET', `/api/bookings/${booking.reference}/ticket`, { token: tokens.ada })).body;
      // decode payload part (base64url JSON) — should only have ref/iat
      const payloadPart = ticket.token.split('.')[0];
      const json = JSON.parse(Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      assert.deepEqual(Object.keys(json).sort(), ['iat', 'ref']);
      assert.equal(json.ref, booking.reference);
    });
  });
}
