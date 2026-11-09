// In-memory repository. Same async method contract shape as sqlite.js.

const copy = (record) => (record === undefined ? undefined : structuredClone(record));

export function createMemoryRepository() {
  const users = new Map();
  const events = new Map();
  const tiers = new Map();
  const bookings = new Map(); // reference -> booking
  const waitlistEntries = new Map(); // id -> entry
  const offers = new Map(); // id -> offer

  function normEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  return {
    async insertUser(user) { users.set(user.id, copy(user)); return copy(user); },
    async findUserById(id) { return copy(users.get(id)); },
    async findUserByEmail(email) {
      const target = normEmail(email);
      if (!target) return undefined;
      for (const user of users.values()) if (normEmail(user.email) === target) return copy(user);
      return undefined;
    },

    async insertEvent(event) { events.set(event.id, copy(event)); return copy(event); },
    async findEvent(id) { return copy(events.get(id)); },
    async updateEvent(event) { events.set(event.id, copy(event)); return copy(event); },
    async listEvents() { return [...events.values()].map(copy); },

    async insertTier(tier) { tiers.set(tier.id, copy(tier)); return copy(tier); },
    async findTier(id) { return copy(tiers.get(id)); },
    async updateTier(tier) { tiers.set(tier.id, copy(tier)); return copy(tier); },
    async listTiersForEvent(eventId) { return [...tiers.values()].filter((t) => t.eventId === eventId).map(copy); },

    async reserveSeats(tierId, quantity) {
      const tier = tiers.get(tierId);
      if (!tier || tier.sold + quantity > tier.capacity) return false;
      tier.sold += quantity; return true;
    },
    async releaseSeats(tierId, quantity) {
      const tier = tiers.get(tierId);
      if (!tier || tier.sold < quantity) return false;
      tier.sold -= quantity; return true;
    },

    async insertBooking(booking) { bookings.set(booking.reference, copy(booking)); return copy(booking); },
    async findBookingByReference(reference) { return copy(bookings.get(reference)); },
    async updateBooking(booking) { bookings.set(booking.reference, copy(booking)); return copy(booking); },
    async listBookingsByUserId(userId) { return [...bookings.values()].filter((b) => b.userId === userId).map(copy); },

    // Compare-and-set: update only if current status is in fromStatuses.
    async transitionBookingStatus(reference, fromStatuses, patch) {
      const booking = bookings.get(reference);
      if (!booking || !fromStatuses.includes(booking.status)) return null;
      Object.assign(booking, patch);
      return copy(booking);
    },
    async listPendingBookingsCreatedBefore(isoCutoff) {
      return [...bookings.values()]
        .filter((b) => b.status === 'pending' && b.createdAt < isoCutoff)
        .map(copy);
    },

    // Atomic admission: only a paid booking becomes checked_in (single-step gate).
    async checkInBooking(reference, checkedInAt) {
      const booking = bookings.get(reference);
      if (!booking || booking.status !== 'paid') return null;
      booking.status = 'checked_in';
      booking.checkedInAt = checkedInAt;
      return copy(booking);
    },

    async insertWaitlistEntry(entry) { waitlistEntries.set(entry.id, copy(entry)); return copy(entry); },
    async findWaitlistEntry(id) { return copy(waitlistEntries.get(id)); },
    async findActiveWaitlistEntry({ tierId, userId }) {
      for (const e of waitlistEntries.values()) {
        if (e.tierId === tierId && e.userId === userId && (e.status === 'waiting' || e.status === 'offered')) return copy(e);
      }
      return undefined;
    },
    async listWaitingEntries(tierId) {
      return [...waitlistEntries.values()]
        .filter((e) => e.tierId === tierId && e.status === 'waiting')
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        .map(copy);
    },
    async updateWaitlistEntry(entry) { waitlistEntries.set(entry.id, copy(entry)); return copy(entry); },

    async insertOffer(offer) { offers.set(offer.id, copy(offer)); return copy(offer); },
    async findOffer(id) { return copy(offers.get(id)); },
    async listActiveOffersForUser(userId) {
      return [...offers.values()].filter((o) => o.userId === userId && o.status === 'active').map(copy);
    },
    async listExpiredActiveOffers(nowIso) {
      return [...offers.values()].filter((o) => o.status === 'active' && o.expiresAt <= nowIso).map(copy);
    },
    async updateOffer(offer) { offers.set(offer.id, copy(offer)); return copy(offer); },

    close() {},
  };
}
