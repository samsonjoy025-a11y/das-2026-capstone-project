// Coordinates freed seats with the waitlist. A waitlist offer really holds seats.

import { newId } from '../domain/ids.js';
import { OFFER_HOLD_MS } from '../config.js';
import { systemClock } from '../lib/clock.js';

export function createSeatService({ repository, clock = systemClock, offerHoldMs = OFFER_HOLD_MS }) {
  async function createOfferForEntry(entry, now = clock.now()) {
    // Hold the seats for the offer.
    const held = await repository.reserveSeats(entry.tierId, entry.quantity);
    if (!held) return null;
    const offer = {
      id: newId(),
      entryId: entry.id,
      tierId: entry.tierId,
      eventId: entry.eventId,
      userId: entry.userId,
      quantity: entry.quantity,
      status: 'active',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + offerHoldMs).toISOString(),
    };
    try {
      await repository.insertOffer(offer);
      await repository.updateWaitlistEntry({ ...entry, status: 'offered' });
      return offer;
    } catch (error) {
      await repository.releaseSeats(entry.tierId, entry.quantity);
      throw error;
    }
  }

  async function passExpiredOffer(offer, now = clock.now()) {
    if (!offer || offer.status !== 'active') return null;
    if (new Date(offer.expiresAt).getTime() > now.getTime()) return null;
    await repository.updateOffer({ ...offer, status: 'expired' });
    const entry = await repository.findWaitlistEntry(offer.entryId);
    if (entry) await repository.updateWaitlistEntry({ ...entry, status: 'expired' });
    await repository.releaseSeats(offer.tierId, offer.quantity);
    // Pass the freed seats to the next person.
    await onSeatsFreed(offer.tierId, offer.quantity, now);
    return offer;
  }

  async function onSeatsFreed(tierId, quantity, now = clock.now()) {
    let remaining = quantity;
    while (remaining > 0) {
      const tier = await repository.findTier(tierId);
      if (!tier) return;
      const waiting = await repository.listWaitingEntries(tierId);
      const next = waiting.find((e) => e.quantity <= remaining);
      if (!next) return;
      const offer = await createOfferForEntry(next, now);
      if (!offer) return;
      remaining -= next.quantity;
    }
  }

  return { onSeatsFreed, createOfferForEntry, passExpiredOffer, offerHoldMs };
}
