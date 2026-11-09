// API-level tests: start the real server on a free port and talk to it with fetch.
// Build 7: uses bearer tokens (signup/login) instead of x-user-id.

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketingServer } from '../src/server.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';

const REPOSITORIES = { memory: createMemoryRepository, sqlite: createSqliteRepository };

for (const [name, makeRepository] of Object.entries(REPOSITORIES)) {
  describe(`REST API (${name} repository)`, () => {
    let server;
    let baseUrl;
    let gateway;
    let tokens;

    beforeEach(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      gateway = createMockPaymentGateway();
      server = createTicketingServer({ repository: makeRepository(), paymentGateway: gateway });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      tokens = {
        organizer: await signup({ email: 'org1@example.com', password: 'password123', role: 'organizer' }),
        ada: await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' }),
        bayo: await signup({ email: 'bayo@example.com', password: 'password123', role: 'attendee' }),
      };
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

    async function signup({ email, password, role }) {
      const res = await call('POST', '/api/auth/signup', { body: { email, password, role } });
      assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
      return res.body.token;
    }

    const assertError = (result, status, code) => {
      assert.equal(result.status, status);
      assert.deepEqual(Object.keys(result.body), ['error']);
      assert.deepEqual(Object.keys(result.body.error), ['code', 'message']);
      assert.equal(result.body.error.code, code);
    };

    async function createEvent(overrides = {}) {
      const result = await call('POST', '/api/events', {
        token: tokens.organizer,
        body: { title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Landmark Centre', startsAt: '2026-12-05T17:00:00Z', ...overrides },
      });
      assert.equal(result.status, 201);
      return result.body;
    }

    async function addTier(eventId, tier = {}) {
      const result = await call('POST', `/api/events/${eventId}/tiers`, {
        token: tokens.organizer,
        body: { name: 'General', priceCents: 500000, capacity: 100, ...tier },
      });
      assert.equal(result.status, 201);
      return result.body;
    }

    async function publishedEventWithTier(tier, event) {
      const created = await createEvent(event);
      const added = await addTier(created.id, tier);
      assert.equal((await call('POST', `/api/events/${created.id}/publish`, { token: tokens.organizer })).status, 200);
      return { event: created, tier: added };
    }

    async function book(token, tierId, quantity) {
      return call('POST', '/api/bookings', { token, body: { tierId, quantity } });
    }

    const pay = (token, reference, paymentToken = 'tok_success') =>
      call('POST', `/api/bookings/${reference}/pay`, { token, body: { paymentToken } });

    describe('S02 create an event', () => {
      it('saves a draft with a new id that is not on the public list', async () => {
        const event = await createEvent();
        assert.equal(event.status, 'draft');
        assert.match(event.id, /^[0-9a-f-]{36}$/);
        const list = await call('GET', '/api/events');
        assert.deepEqual(list.body.events, []);
      });

      for (const [label, body] of [
        ['a missing title', { title: '' }],
        ['a missing city', { city: undefined }],
        ['a date that is not a real date', { startsAt: 'not-a-date' }],
      ]) {
        it(`rejects ${label} with VALIDATION and saves nothing`, async () => {
          const result = await call('POST', '/api/events', {
            token: tokens.organizer,
            body: { title: 'T', city: 'Lagos', startsAt: '2026-12-05', ...body },
          });
          assertError(result, 400, 'VALIDATION');
          const event = await createEvent();
          await addTier(event.id);
          await call('POST', `/api/events/${event.id}/publish`, { token: tokens.organizer });
          assert.equal((await call('GET', '/api/events')).body.events.length, 1);
        });
      }

      it('requires authentication', async () => {
        const result = await call('POST', '/api/events', { body: { title: 'T', city: 'Lagos', startsAt: '2026-12-05' } });
        assertError(result, 401, 'UNAUTHENTICATED');
      });

      it('rejects a body that is not a JSON object', async () => {
        assertError(await call('POST', '/api/events', { token: tokens.organizer, body: [1, 2] }), 400, 'VALIDATION');
        assertError(await call('POST', '/api/events', { token: tokens.organizer }), 400, 'VALIDATION');
      });
    });

    describe('S03 add ticket tiers', () => {
      it('saves a tier with 0 sold and every seat left', async () => {
        const event = await createEvent();
        const tier = await addTier(event.id, { name: 'General', priceCents: 500000, capacity: 100 });
        assert.equal(tier.sold, 0);
        assert.equal(tier.seatsLeft, 100);
        assert.equal(tier.priceCents, 500000);
      });

      it('rejects a price that is not a whole number, or a capacity below 1', async () => {
        const event = await createEvent();
        for (const body of [
          { name: 'VIP', priceCents: 199.99, capacity: 5 },
          { name: 'VIP', priceCents: '500', capacity: 5 },
          { name: 'VIP', priceCents: 500, capacity: 0 },
        ]) {
          assertError(await call('POST', `/api/events/${event.id}/tiers`, { token: tokens.organizer, body }), 400, 'VALIDATION');
        }
      });

      it('rejects an event id that does not exist with NOT_FOUND', async () => {
        const result = await call('POST', '/api/events/no-such-event/tiers', {
          token: tokens.organizer,
          body: { name: 'General', priceCents: 100, capacity: 1 },
        });
        assertError(result, 404, 'NOT_FOUND');
      });

      it('only lets the organizer of the event add tiers', async () => {
        const event = await createEvent();
        const result = await call('POST', `/api/events/${event.id}/tiers`, {
          token: tokens.ada,
          body: { name: 'General', priceCents: 100, capacity: 1 },
        });
        assertError(result, 403, 'FORBIDDEN');
      });
    });

    describe('S04 publish and unpublish', () => {
      it('publishing puts the event on the public list, unpublishing takes it off', async () => {
        const { event } = await publishedEventWithTier();
        assert.deepEqual((await call('GET', '/api/events')).body.events.map((e) => e.id), [event.id]);

        const result = await call('POST', `/api/events/${event.id}/unpublish`, { token: tokens.organizer });
        assert.equal(result.body.status, 'draft');
        assert.deepEqual((await call('GET', '/api/events')).body.events, []);
      });

      it('cannot publish an event with no tiers', async () => {
        const event = await createEvent();
        assertError(await call('POST', `/api/events/${event.id}/publish`, { token: tokens.organizer }), 409, 'INVALID_STATE');
      });

      it('only the organizer can publish', async () => {
        const event = await createEvent();
        await addTier(event.id);
        assertError(await call('POST', `/api/events/${event.id}/publish`, { token: tokens.ada }), 403, 'FORBIDDEN');
      });

      it('hides a draft from everyone except its organizer', async () => {
        const event = await createEvent();
        assertError(await call('GET', `/api/events/${event.id}`, { token: tokens.ada }), 404, 'NOT_FOUND');
        assert.equal((await call('GET', `/api/events/${event.id}`, { token: tokens.organizer })).status, 200);
      });
    });

    describe('S05 search, filter and sort', () => {
      beforeEach(async () => {
        await publishedEventWithTier({ priceCents: 300000 }, { title: 'Lagos Tech Meetup', city: 'Lagos', startsAt: '2026-12-05T17:00:00Z' });
        await publishedEventWithTier({ priceCents: 100000 }, { title: 'Abuja Jazz Night', city: 'Abuja', startsAt: '2026-12-05T19:00:00Z' });
        await publishedEventWithTier({ priceCents: 900000 }, { title: 'Lagos Art Fair', city: 'Lagos', startsAt: '2026-12-05T17:00:00Z' });
      });

      const titles = (result) => result.body.events.map((event) => event.title);

      it('searches by text, ignoring case', async () => {
        assert.deepEqual(titles(await call('GET', '/api/events?q=JAZZ')), ['Abuja Jazz Night']);
      });

      it('filters by city, ignoring case', async () => {
        assert.deepEqual(titles(await call('GET', '/api/events?city=lagos&sort=date')), ['Lagos Art Fair', 'Lagos Tech Meetup']);
      });

      it('filters by maximum price and sorts cheapest first', async () => {
        assert.deepEqual(titles(await call('GET', '/api/events?maxPriceCents=500000&sort=price')), [
          'Abuja Jazz Night',
          'Lagos Tech Meetup',
        ]);
      });

      it('sorts by date, with same-time events in title order', async () => {
        assert.deepEqual(titles(await call('GET', '/api/events?sort=date')), [
          'Lagos Art Fair',
          'Lagos Tech Meetup',
          'Abuja Jazz Night',
        ]);
      });

      it('includes the whole day when filtering up to a date', async () => {
        assert.equal(titles(await call('GET', '/api/events?to=2026-12-05')).length, 3);
        assert.equal(titles(await call('GET', '/api/events?to=2026-12-04')).length, 0);
      });

      for (const query of ['from=yesterday', 'maxPriceCents=12.5', 'maxPriceCents=abc', 'sort=random']) {
        it(`rejects ${query} with VALIDATION`, async () => {
          assertError(await call('GET', `/api/events?${query}`), 400, 'VALIDATION');
        });
      }
    });

    describe('S06 book tickets', () => {
      it('creates a pending booking priced in whole cents and reduces the seats left', async () => {
        const { event, tier } = await publishedEventWithTier({ priceCents: 2500, capacity: 3 });
        const result = await book(tokens.ada, tier.id, 2);
        assert.equal(result.status, 201);
        assert.equal(result.body.status, 'pending');
        assert.equal(result.body.quantity, 2);
        assert.equal(result.body.amountCents, 5000);
        assert.match(result.body.reference, /^[A-Z2-9]{8}$/);
        assert.equal('userId' in result.body, false);

        const view = await call('GET', `/api/events/${event.id}`);
        assert.equal(view.body.tiers[0].seatsLeft, 1);
      });

      it('rejects booking more seats than are left with SOLD_OUT and changes nothing', async () => {
        const { event, tier } = await publishedEventWithTier({ capacity: 3 });
        await book(tokens.ada, tier.id, 2);
        assertError(await book(tokens.bayo, tier.id, 2), 409, 'SOLD_OUT');
        assert.equal((await call('GET', `/api/events/${event.id}`)).body.tiers[0].seatsLeft, 1);
      });

      for (const quantity of [0, -1, 1.5, 11, '2']) {
        it(`rejects quantity ${JSON.stringify(quantity)} with VALIDATION`, async () => {
          const { tier } = await publishedEventWithTier();
          assertError(await book(tokens.ada, tier.id, quantity), 400, 'VALIDATION');
        });
      }

      it('rejects an unknown tier with NOT_FOUND and a draft event with INVALID_STATE', async () => {
        assertError(await book(tokens.ada, 'no-such-tier', 1), 404, 'NOT_FOUND');
        const draft = await createEvent();
        const tier = await addTier(draft.id);
        assertError(await book(tokens.ada, tier.id, 1), 409, 'INVALID_STATE');
      });
    });

    describe('S07 pay for a booking (mock payment)', () => {
      async function pendingBooking() {
        const { tier } = await publishedEventWithTier({ priceCents: 2500, capacity: 5 });
        return (await book(tokens.ada, tier.id, 2)).body;
      }

      it('a valid mock card makes the booking paid and shows the reference', async () => {
        const booking = await pendingBooking();
        const result = await pay(tokens.ada, booking.reference);
        assert.equal(result.status, 200);
        assert.equal(result.body.status, 'paid');
        assert.equal(result.body.reference, booking.reference);
        assert.equal(gateway.chargeCount, 1);
      });

      it('a declined card returns PAYMENT_DECLINED, the booking stays pending, and a retry works', async () => {
        const booking = await pendingBooking();
        assertError(await pay(tokens.ada, booking.reference, 'tok_declined'), 402, 'PAYMENT_DECLINED');
        assert.equal((await call('GET', `/api/bookings/${booking.reference}`, { token: tokens.ada })).body.status, 'pending');
        assert.equal(gateway.chargeCount, 0);
        assert.equal((await pay(tokens.ada, booking.reference)).body.status, 'paid');
      });

      it('paying a cancelled booking is rejected with INVALID_TRANSITION', async () => {
        const booking = await pendingBooking();
        assert.equal((await call('POST', `/api/bookings/${booking.reference}/cancel`, { token: tokens.ada })).status, 200);
        assertError(await pay(tokens.ada, booking.reference), 409, 'INVALID_TRANSITION');
        assert.equal(gateway.chargeCount, 0);
      });

      it('paying twice is rejected and the card is charged only once', async () => {
        const booking = await pendingBooking();
        await pay(tokens.ada, booking.reference);
        assertError(await pay(tokens.ada, booking.reference), 409, 'INVALID_TRANSITION');
        assert.equal(gateway.chargeCount, 1);
      });

      it('two pay requests at the same moment still charge only once', async () => {
        const slowGateway = createMockPaymentGateway({ delayMs: 20 });
        await new Promise((resolve) => server.close(resolve));
        server = createTicketingServer({ repository: makeRepository(), paymentGateway: slowGateway });
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        tokens = {
          organizer: await signup({ email: 'org1@example.com', password: 'password123', role: 'organizer' }),
          ada: await signup({ email: 'ada@example.com', password: 'password123', role: 'attendee' }),
          bayo: await signup({ email: 'bayo@example.com', password: 'password123', role: 'attendee' }),
        };

        const booking = await pendingBooking();
        const results = await Promise.all([pay(tokens.ada, booking.reference), pay(tokens.ada, booking.reference)]);
        assert.ok(results.every((result) => result.status === 200 || result.status === 409));
        assert.equal(slowGateway.chargeCount, 1);
      });

      it('only the person who made the booking can pay for it', async () => {
        const booking = await pendingBooking();
        assertError(await pay(tokens.bayo, booking.reference), 404, 'NOT_FOUND');
        assertError(await pay(undefined, booking.reference), 401, 'UNAUTHENTICATED');
      });

      it('requires a payment token and an existing booking', async () => {
        const booking = await pendingBooking();
        assertError(await call('POST', `/api/bookings/${booking.reference}/pay`, { token: tokens.ada, body: {} }), 400, 'VALIDATION');
        assertError(await pay(tokens.ada, 'NOPE2345'), 404, 'NOT_FOUND');
      });
    });

    describe('cancel an unpaid booking', () => {
      it('cancels a pending booking and frees its seats', async () => {
        const { event, tier } = await publishedEventWithTier({ capacity: 3 });
        const booking = (await book(tokens.ada, tier.id, 3)).body;
        const result = await call('POST', `/api/bookings/${booking.reference}/cancel`, { token: tokens.ada });
        assert.equal(result.body.status, 'cancelled');
        assert.equal((await call('GET', `/api/events/${event.id}`)).body.tiers[0].seatsLeft, 3);
      });

      it('cancels a paid booking with a refund, and refuses to cancel twice (seats released once)', async () => {
        const { event, tier } = await publishedEventWithTier({ capacity: 3, priceCents: 2500 });
        const paid = (await book(tokens.ada, tier.id, 1)).body;
        await pay(tokens.ada, paid.reference);
        const cancelled = await call('POST', `/api/bookings/${paid.reference}/cancel`, { token: tokens.ada });
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.status, 'refunded');
        assert.equal(typeof cancelled.body.refundAmountCents, 'number');
        const seatsAfter = (await call('GET', `/api/events/${event.id}`)).body.tiers[0].seatsLeft;
        assert.equal(seatsAfter, 3);
        // Cancelling again must not release seats again.
        assertError(await call('POST', `/api/bookings/${paid.reference}/cancel`, { token: tokens.ada }), 409, 'INVALID_TRANSITION');
        assert.equal((await call('GET', `/api/events/${event.id}`)).body.tiers[0].seatsLeft, 3);

        const pending = (await book(tokens.ada, tier.id, 1)).body;
        await call('POST', `/api/bookings/${pending.reference}/cancel`, { token: tokens.ada });
        assertError(await call('POST', `/api/bookings/${pending.reference}/cancel`, { token: tokens.ada }), 409, 'INVALID_TRANSITION');
      });

      it("refuses to cancel someone else's booking", async () => {
        const { tier } = await publishedEventWithTier();
        const booking = (await book(tokens.ada, tier.id, 1)).body;
        assertError(await call('POST', `/api/bookings/${booking.reference}/cancel`, { token: tokens.bayo }), 404, 'NOT_FOUND');
      });
    });
  });
}
