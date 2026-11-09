// Maintenance: expire unpaid holds and expire/pass on waitlist offers.
// Tests call runMaintenance directly. The server can run it with setInterval.

import { BOOKING_HOLD_MS } from '../config.js';

export async function runMaintenance({ repository, bookingService, seatService, clock, holdMs = BOOKING_HOLD_MS }) {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - holdMs).toISOString();
  const expiredBookings = await repository.listPendingBookingsCreatedBefore(cutoff);

  let cancelledCount = 0;
  for (const booking of expiredBookings) {
    // expirePendingBooking uses CAS + releases seats + offers to waitlist via seatService hook
    const result = await bookingService.expirePendingBooking(booking.reference, now, holdMs);
    if (result) cancelledCount += 1;
  }

  let expiredOffers = 0;
  if (seatService) {
    const offers = await repository.listExpiredActiveOffers(now.toISOString());
    for (const offer of offers) {
      const passed = await seatService.passExpiredOffer(offer, now);
      if (passed) expiredOffers += 1;
    }
  }

  return { cancelledPendingBookings: cancelledCount, expiredOffers, at: now.toISOString() };
}
