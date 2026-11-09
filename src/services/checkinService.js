import { DomainError } from '../domain/errors.js';
import { verifyTicketToken } from '../lib/ticketToken.js';
import { systemClock } from '../lib/clock.js';

export function createCheckinService({ repository, clock = systemClock } = {}) {
  return {
    async checkIn({ token, eventId } = {}) {
      // Forged/edited/made-up codes are rejected as invalid.
      const { ref } = verifyTicketToken(token);
      const reference = String(ref).toUpperCase();

      const booking = await repository.findBookingByReference(reference);
      if (!booking) {
        throw new DomainError('INVALID_TICKET', 'The ticket code is invalid');
      }
      if (eventId && booking.eventId !== eventId) {
        throw new DomainError('WRONG_EVENT', 'This ticket is for a different event');
      }
      if (booking.status === 'checked_in') {
        throw new DomainError('DUPLICATE_SCAN', `This ticket was already used at ${booking.checkedInAt}`);
      }
      if (booking.status === 'cancelled' || booking.status === 'refunded') {
        throw new DomainError('INVALID_TICKET', 'This ticket has been cancelled or refunded');
      }
      if (booking.status !== 'paid') {
        throw new DomainError('INVALID_TICKET', 'This ticket cannot be checked in');
      }

      // Admission is a single atomic UPDATE (WHERE status='paid') — not read-then-write.
      const checkedInAt = clock.now().toISOString();
      const admitted = await repository.checkInBooking(reference, checkedInAt);
      if (!admitted) {
        // Lost the race or state changed: report accurately.
        const current = await repository.findBookingByReference(reference);
        if (current?.status === 'checked_in') {
          throw new DomainError('DUPLICATE_SCAN', `This ticket was already used at ${current.checkedInAt}`);
        }
        if (current?.status === 'cancelled' || current?.status === 'refunded') {
          throw new DomainError('INVALID_TICKET', 'This ticket has been cancelled or refunded');
        }
        throw new DomainError('INVALID_TICKET', 'This ticket cannot be checked in');
      }

      return { status: 'admitted', reference: admitted.reference, checkedInAt: admitted.checkedInAt, eventId: admitted.eventId };
    },
  };
}
