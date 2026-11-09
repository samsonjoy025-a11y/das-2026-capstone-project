// Booking rules: book, pay (mock), cancel/refund, expiry checks.

import { assertTransition } from '../domain/bookingStateMachine.js';
import { DomainError } from '../domain/errors.js';
import { calculateRefund } from '../domain/refundPolicy.js';
import { newId, referenceCode } from '../domain/ids.js';
import { requireQuantity, requireText, soldOutError } from '../domain/validation.js';
import { BOOKING_HOLD_MS } from '../config.js';
import { systemClock } from '../lib/clock.js';
import { signTicketToken } from '../lib/ticketToken.js';

function actorIdOf(actor) { return typeof actor === 'string' ? actor : (actor?.sub || actor?.id); }
function requireActor(actor) {
  const id = actorIdOf(actor);
  if (typeof id !== 'string' || id.trim() === '') throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  return id.trim();
}
function toPublicBooking(booking) {
  const { id, userId, chargeId, ...visible } = booking;
  return visible;
}

export function createBookingService({ repository, paymentGateway, clock = systemClock, seatService = null, holdMs = BOOKING_HOLD_MS }) {
  async function getOwnBooking(actor, reference) {
    const id = requireActor(actor);
    const booking = await repository.findBookingByReference(String(reference).toUpperCase());
    if (!booking || booking.userId !== id) throw new DomainError('NOT_FOUND', 'Booking not found');
    return booking;
  }
  async function uniqueReference() {
    let reference;
    do { reference = referenceCode(); } while (await repository.findBookingByReference(reference));
    return reference;
  }
  async function afterSeatsFreed(tierId, quantity) {
    if (seatService?.onSeatsFreed) await seatService.onSeatsFreed(tierId, quantity);
  }

  return {
    async book(actor, input) {
      const userId = requireActor(actor);
      if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('VALIDATION', 'Request body must be a JSON object');
      const { tierId, quantity } = input;
      requireText(tierId, 'tierId');
      requireQuantity(quantity);

      const tier = await repository.findTier(tierId);
      if (!tier) throw new DomainError('NOT_FOUND', 'Ticket tier not found');
      const event = await repository.findEvent(tier.eventId);
      if (!event || event.status !== 'published') throw new DomainError('INVALID_STATE', 'This event is not open for booking');

      if (!(await repository.reserveSeats(tierId, quantity))) throw soldOutError((await repository.findTier(tierId)) ?? tier);

      const booking = {
        id: newId(), reference: await uniqueReference(), userId, eventId: event.id, tierId, quantity,
        amountCents: tier.priceCents * quantity, status: 'pending', createdAt: clock.now().toISOString(),
      };
      try {
        return toPublicBooking(await repository.insertBooking(booking));
      } catch (error) {
        await repository.releaseSeats(tierId, quantity);
        throw error;
      }
    },

    async getBooking(actor, reference) { return toPublicBooking(await getOwnBooking(actor, reference)); },

    async refundQuote(actor, reference) {
      const booking = await getOwnBooking(actor, reference);
      if (booking.status === 'pending') {
        return { reference: booking.reference, status: booking.status, refundAmountCents: 0, canCancel: true };
      }
      if (booking.status !== 'paid') throw new DomainError('INVALID_TRANSITION', `Cannot cancel a ${booking.status} booking`);
      const event = await repository.findEvent(booking.eventId);
      const refundAmountCents = calculateRefund({ amountCents: booking.amountCents, startsAt: event.startsAt, now: clock.now() });
      return { reference: booking.reference, status: booking.status, amountCents: booking.amountCents, refundAmountCents, canCancel: true };
    },

    async listMyBookings(actor) {
      const userId = requireActor(actor);
      return (await repository.listBookingsByUserId(userId)).map(toPublicBooking);
    },

    async getTicketToken(actor, reference) {
      const booking = await getOwnBooking(actor, reference);
      if (booking.status !== 'paid' && booking.status !== 'checked_in') {
        throw new DomainError('INVALID_STATE', 'Only paid tickets have a QR code');
      }
      return { reference: booking.reference, token: signTicketToken(booking.reference) };
    },

    async pay(actor, reference, input) {
      const booking = await getOwnBooking(actor, reference);
      // Expired pending bookings cannot be paid.
      if (booking.status === 'pending') {
        const age = clock.now().getTime() - new Date(booking.createdAt).getTime();
        if (age >= holdMs) throw new DomainError('BOOKING_EXPIRED', 'This booking has expired');
      }
      assertTransition(booking.status, 'paid');
      const paymentToken = requireText(input?.paymentToken, 'paymentToken');
      const charge = await paymentGateway.charge({ amountCents: booking.amountCents, paymentToken, idempotencyKey: booking.reference });
      if (charge.status !== 'succeeded') throw new DomainError('PAYMENT_DECLINED', 'The card was declined. Try another card.');
      const paid = await repository.transitionBookingStatus(booking.reference, ['pending'], {
        status: 'paid', chargeId: charge.chargeId, paidAt: clock.now().toISOString(),
      });
      if (paid) return toPublicBooking(paid);
      const current = await repository.findBookingByReference(booking.reference);
      if (current?.status === 'paid') return toPublicBooking(current);
      throw new DomainError('INVALID_TRANSITION', `Cannot transition booking from ${current?.status || 'unknown'} to paid`);
    },

    async cancel(actor, reference) {
      const booking = await getOwnBooking(actor, reference);
      if (booking.status === 'cancelled' || booking.status === 'refunded') {
        throw new DomainError('INVALID_TRANSITION', `Cannot transition booking from ${booking.status} to cancelled`);
      }

      if (booking.status === 'pending') {
        assertTransition('pending', 'cancelled');
        const updated = await repository.transitionBookingStatus(booking.reference, ['pending'], {
          status: 'cancelled', cancelledAt: clock.now().toISOString(),
        });
        if (!updated) throw new DomainError('INVALID_TRANSITION', 'Cannot transition booking from pending to cancelled');
        await repository.releaseSeats(booking.tierId, booking.quantity);
        await afterSeatsFreed(booking.tierId, booking.quantity);
        return toPublicBooking(updated);
      }

      if (booking.status === 'paid') {
        // Paid cancellation/refund: calculate refund, refund via gateway, CAS status, release once.
        assertTransition('paid', 'refunded');
        const event = await repository.findEvent(booking.eventId);
        const refundAmountCents = calculateRefund({ amountCents: booking.amountCents, startsAt: event.startsAt, now: clock.now() });
        const refund = await paymentGateway.refund({
          chargeId: booking.chargeId, amountCents: refundAmountCents, idempotencyKey: `refund:${booking.reference}`,
        });
        const updated = await repository.transitionBookingStatus(booking.reference, ['paid'], {
          status: 'refunded', refundId: refund.refundId, refundAmountCents, refundedAt: clock.now().toISOString(), cancelledAt: clock.now().toISOString(),
        });
        if (!updated) throw new DomainError('INVALID_TRANSITION', 'Cannot transition booking from paid to refunded');
        await repository.releaseSeats(booking.tierId, booking.quantity);
        await afterSeatsFreed(booking.tierId, booking.quantity);
        return toPublicBooking(updated);
      }

      throw new DomainError('INVALID_TRANSITION', `Cannot transition booking from ${booking.status} to cancelled`);
    },

    // For maintenance job / tests: expire a specific stale pending booking (CAS).
    async expirePendingBooking(reference, now = clock.now(), holdMsOverride = holdMs) {
      const booking = await repository.findBookingByReference(String(reference).toUpperCase());
      if (!booking || booking.status !== 'pending') return null;
      const age = now.getTime() - new Date(booking.createdAt).getTime();
      if (age < holdMsOverride) return null;
      const updated = await repository.transitionBookingStatus(booking.reference, ['pending'], {
        status: 'cancelled', cancelledAt: now.toISOString(),
      });
      if (!updated) return null;
      await repository.releaseSeats(booking.tierId, booking.quantity);
      await afterSeatsFreed(booking.tierId, booking.quantity);
      return toPublicBooking(updated);
    },
  };
}
