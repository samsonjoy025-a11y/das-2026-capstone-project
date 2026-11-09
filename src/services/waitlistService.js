import { DomainError } from '../domain/errors.js';
import { newId, referenceCode } from '../domain/ids.js';
import { requireQuantity, requireText } from '../domain/validation.js';
import { systemClock } from '../lib/clock.js';

function actorIdOf(actor) { return typeof actor === 'string' ? actor : (actor?.sub || actor?.id); }
function requireActor(actor) {
  const id = actorIdOf(actor);
  if (!id) throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  return id;
}
function toPublicBooking(booking) { const { id, userId, chargeId, ...v } = booking; return v; }

export function createWaitlistService({ repository, clock = systemClock, seatService }) {
  async function uniqueReference() {
    let ref; do { ref = referenceCode(); } while (await repository.findBookingByReference(ref));
    return ref;
  }

  return {
    async join(actor, input) {
      const userId = requireActor(actor);
      if (!input || typeof input !== 'object') throw new DomainError('VALIDATION', 'Request body must be a JSON object');
      const { tierId, quantity } = input;
      requireText(tierId, 'tierId');
      requireQuantity(quantity);
      const tier = await repository.findTier(tierId);
      if (!tier) throw new DomainError('NOT_FOUND', 'Ticket tier not found');
      const event = await repository.findEvent(tier.eventId);
      if (!event || event.status !== 'published') throw new DomainError('INVALID_STATE', 'This event is not open for booking');
      if (tier.capacity - tier.sold >= quantity) throw new DomainError('NOT_SOLD_OUT', 'Seats are still available for this tier');
      const existing = await repository.findActiveWaitlistEntry({ tierId, userId });
      if (existing) throw new DomainError('ALREADY_ON_WAITLIST', 'You are already on the waitlist for this tier');
      const entry = {
        id: newId(), tierId, eventId: event.id, userId, quantity, status: 'waiting', createdAt: clock.now().toISOString(),
      };
      return repository.insertWaitlistEntry(entry);
    },

    async listMyOffers(actor) {
      const userId = requireActor(actor);
      const offers = await repository.listActiveOffersForUser(userId);
      // Filter out expired-in-time (job may not have run yet) and surface as active with expiry info.
      const now = clock.now().getTime();
      return offers.map((o) => ({ ...o, expired: new Date(o.expiresAt).getTime() <= now }));
    },

    async acceptOffer(actor, offerId) {
      const userId = requireActor(actor);
      const offer = await repository.findOffer(offerId);
      if (!offer || offer.userId !== userId) throw new DomainError('NOT_FOUND', 'Offer not found');
      const now = clock.now();
      if (offer.status !== 'active' || new Date(offer.expiresAt).getTime() <= now.getTime()) {
        // Ensure it passes on if still active-but-expired.
        if (offer.status === 'active') await seatService.passExpiredOffer(offer, now);
        throw new DomainError('OFFER_EXPIRED', 'This offer has expired');
      }
      // Seats are already held by the offer. Create a pending booking without reserving again.
      const tier = await repository.findTier(offer.tierId);
      if (!tier) throw new DomainError('NOT_FOUND', 'Ticket tier not found');
      const booking = {
        id: newId(), reference: await uniqueReference(), userId, eventId: offer.eventId, tierId: offer.tierId,
        quantity: offer.quantity, amountCents: tier.priceCents * offer.quantity, status: 'pending', createdAt: now.toISOString(),
      };
      await repository.insertBooking(booking);
      await repository.updateOffer({ ...offer, status: 'accepted', acceptedAt: now.toISOString() });
      const entry = await repository.findWaitlistEntry(offer.entryId);
      if (entry) await repository.updateWaitlistEntry({ ...entry, status: 'accepted' });
      return toPublicBooking(booking);
    },
  };
}
