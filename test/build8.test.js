// Build 8: refund boundaries, cancel twice, waitlist order/expiry/passing, unpaid hold expiry.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/lib/clock.js';
import { calculateRefund } from '../src/domain/refundPolicy.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createEventService } from '../src/services/eventService.js';
import { createBookingService } from '../src/services/bookingService.js';
import { createSeatService } from '../src/services/seatService.js';
import { createWaitlistService } from '../src/services/waitlistService.js';
import { runMaintenance } from '../src/jobs/maintenance.js';
import { DomainError } from '../src/domain/errors.js';
import { BOOKING_HOLD_MS, OFFER_HOLD_MS } from '../src/config.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function fixedClock(iso) {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t), set: (nextIso) => { t = new Date(nextIso).getTime(); }, advance: (ms) => { t += ms; } };
}

async function setup({ now = '2026-01-01T00:00:00.000Z', offerHoldMs = 10_000, holdMs = BOOKING_HOLD_MS } = {}) {
  const clock = fixedClock(now);
  const repository = createMemoryRepository();
  const paymentGateway = createMockPaymentGateway();
  const eventService = createEventService({ repository });
  const seatService = createSeatService({ repository, clock, offerHoldMs });
  const bookingService = createBookingService({ repository, paymentGateway, clock, seatService, holdMs });
  const waitlistService = createWaitlistService({ repository, clock, seatService });
  const org = 'org-1';
  const event = await eventService.createEvent(org, { title: 'Show', city: 'Lagos', startsAt: '2026-02-01T12:00:00.000Z' });
  const tier = await eventService.addTier(org, event.id, { name: 'General', priceCents: 10000, capacity: 1 });
  await eventService.publishEvent(org, event.id);
  return { clock, repository, paymentGateway, eventService, bookingService, waitlistService, seatService, tier, event, holdMs };
}

describe('Build 8 - refund policy boundaries (pure)', () => {
  const base = { amountCents: 10001, startsAt: '2026-02-01T12:00:00.000Z' };
  it('exactly 7 days before start => 100%', () => {
    assert.equal(calculateRefund({ ...base, now: '2026-01-25T12:00:00.000Z' }), 10001);
  });
  it('6 days 23 hours before start => 50%', () => {
    assert.equal(calculateRefund({ ...base, now: '2026-01-25T13:00:00.000Z' }), 5000); // Math.floor
  });
  it('exactly 2 days before start => 50%', () => {
    assert.equal(calculateRefund({ ...base, now: '2026-01-30T12:00:00.000Z' }), 5000);
  });
  it('1 day 23 hours before start => 0%', () => {
    assert.equal(calculateRefund({ ...base, now: '2026-01-30T13:00:00.000Z' }), 0);
  });
  it('event started throws EVENT_STARTED', () => {
    assert.throws(() => calculateRefund({ ...base, now: '2026-02-01T12:00:00.000Z' }), (e) => e instanceof DomainError && e.code === 'EVENT_STARTED');
  });
});

describe('Build 8 - cancelling twice (CAS, seats released once)', () => {
  it('paid booking: cancel twice does not release seats twice', async () => {
    const { bookingService, eventService, repository, tier, clock } = await setup({ now: '2026-01-01T00:00:00.000Z' });
    // event starts far away => 100%
    const b = await bookingService.book('ada', { tierId: tier.id, quantity: 1 });
    await bookingService.pay('ada', b.reference, { paymentToken: 'tok_success' });
    const c1 = await bookingService.cancel('ada', b.reference);
    assert.equal(c1.status, 'refunded');
    const seatsAfter1 = (await repository.findTier(tier.id)).sold;
    await assert.rejects(() => bookingService.cancel('ada', b.reference), (e) => e instanceof DomainError);
    const seatsAfter2 = (await repository.findTier(tier.id)).sold;
    assert.equal(seatsAfter1, seatsAfter2);
    assert.equal(seatsAfter2, 0);
  });

  it('pending booking: cancel twice does not release seats twice', async () => {
    const { bookingService, repository, tier } = await setup();
    const b = await bookingService.book('ada', { tierId: tier.id, quantity: 1 });
    await bookingService.cancel('ada', b.reference);
    const seatsAfter1 = (await repository.findTier(tier.id)).sold;
    await assert.rejects(() => bookingService.cancel('ada', b.reference), (e) => e instanceof DomainError);
    assert.equal((await repository.findTier(tier.id)).sold, seatsAfter1);
  });
});

describe('Build 8 - waitlist order, offer expiry passes on', () => {
  it('offers A (not B or C) first and holds seats for A; expiry passes to B', async () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z');
    const repository = createMemoryRepository();
    const eventService = createEventService({ repository });
    const seatService = createSeatService({ repository, clock, offerHoldMs: 5_000 });
    const waitlistService = createWaitlistService({ repository, clock, seatService });
    const bookingService = createBookingService({ repository, paymentGateway: createMockPaymentGateway(), clock, seatService });
    const org = 'org-1';
    const event = await eventService.createEvent(org, { title: 'S', city: 'Lagos', startsAt: '2026-06-01T12:00:00.000Z' });
    const tier = await eventService.addTier(org, event.id, { name: 'G', priceCents: 100, capacity: 1 });
    await eventService.publishEvent(org, event.id);
    // Sell out
    await bookingService.book('buyer', { tierId: tier.id, quantity: 1 });

    clock.set('2026-01-01T00:00:01.000Z'); await waitlistService.join('A', { tierId: tier.id, quantity: 1 });
    clock.set('2026-01-01T00:00:02.000Z'); await waitlistService.join('B', { tierId: tier.id, quantity: 1 });
    clock.set('2026-01-01T00:00:03.000Z'); await waitlistService.join('C', { tierId: tier.id, quantity: 1 });

    // Free the seat (cancel buyer's pending booking)
    const buyerBooking = (await repository.listBookingsByUserId('buyer'))[0];
    await bookingService.cancel('buyer', buyerBooking.reference);

    const tierAfter = await repository.findTier(tier.id);
    assert.equal(tierAfter.sold, 1, 'seat held for offer');
    let offersA = await waitlistService.listMyOffers('A');
    let offersB = await waitlistService.listMyOffers('B');
    let offersC = await waitlistService.listMyOffers('C');
    assert.equal(offersA.length, 1);
    assert.equal(offersB.length, 0);
    assert.equal(offersC.length, 0);

    // Expire A's offer and pass to B
    clock.advance(6_000);
    const active = await repository.listActiveOffersForUser('A');
    await seatService.passExpiredOffer(active[0], clock.now());
    await assert.rejects(() => waitlistService.acceptOffer('A', active[0].id), (e) => e instanceof DomainError && e.code === 'OFFER_EXPIRED');

    offersB = await waitlistService.listMyOffers('B');
    assert.equal(offersB.length, 1);
    assert.equal((await repository.findTier(tier.id)).sold, 1, 'seat still held for B');
  });

  it('rejects joining when seats remain (NOT_SOLD_OUT) and repeat join (ALREADY_ON_WAITLIST)', async () => {
    const { waitlistService, tier, bookingService } = await setup();
    await assert.rejects(() => waitlistService.join('A', { tierId: tier.id, quantity: 1 }), (e) => e.code === 'NOT_SOLD_OUT');
    await bookingService.book('x', { tierId: tier.id, quantity: 1 });
    await waitlistService.join('A', { tierId: tier.id, quantity: 1 });
    await assert.rejects(() => waitlistService.join('A', { tierId: tier.id, quantity: 1 }), (e) => e.code === 'ALREADY_ON_WAITLIST');
  });
});

describe('Build 8 - unpaid hold expires', () => {
  it('maintenance cancels pending booking older than hold time and releases seats once', async () => {
    const holdMs = 1_000;
    const { bookingService, repository, tier, clock, seatService } = await setup({ holdMs });
    const b = await bookingService.book('ada', { tierId: tier.id, quantity: 1 });
    assert.equal((await repository.findTier(tier.id)).sold, 1);
    // not old enough
    clock.advance(500);
    let res = await runMaintenance({ repository, bookingService, seatService, clock, holdMs });
    assert.equal(res.cancelledPendingBookings, 0);
    assert.equal((await repository.findBookingByReference(b.reference)).status, 'pending');
    // expired
    clock.advance(600);
    res = await runMaintenance({ repository, bookingService, seatService, clock, holdMs });
    assert.equal(res.cancelledPendingBookings, 1);
    const after = await repository.findBookingByReference(b.reference);
    assert.equal(after.status, 'cancelled');
    assert.equal((await repository.findTier(tier.id)).sold, 0);
    // run again - no double release
    res = await runMaintenance({ repository, bookingService, seatService, clock, holdMs });
    assert.equal(res.cancelledPendingBookings, 0);
    assert.equal((await repository.findTier(tier.id)).sold, 0);
  });

  it('paying an expired booking is rejected with BOOKING_EXPIRED', async () => {
    const { bookingService, tier, clock } = await setup();
    const b = await bookingService.book('ada', { tierId: tier.id, quantity: 1 });
    clock.advance(BOOKING_HOLD_MS + 1);
    await assert.rejects(() => bookingService.pay('ada', b.reference, { paymentToken: 'tok_success' }), (e) => e instanceof DomainError && e.code === 'BOOKING_EXPIRED');
  });
});
