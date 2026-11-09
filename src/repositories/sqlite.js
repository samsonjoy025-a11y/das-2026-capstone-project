// SQLite repository. Same async method contract shape as memory.js.
// Every query uses ? placeholders.

import { openDatabase } from '../db/connection.js';

function withoutNulls(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value != null));
}

const toUser = (row) => row && withoutNulls({
  id: row.id, name: row.name, email: row.email, role: row.role, passwordHash: row.password_hash, createdAt: row.created_at,
});
const toEvent = (row) => row && ({
  id: row.id, organizerId: row.organizer_id, title: row.title, city: row.city, venue: row.venue, startsAt: row.starts_at, status: row.status,
});
const toTier = (row) => row && ({
  id: row.id, eventId: row.event_id, name: row.name, priceCents: row.price_cents, capacity: row.capacity, sold: row.sold,
});
const toBooking = (row) => row && withoutNulls({
  id: row.id, reference: row.reference, userId: row.user_id, eventId: row.event_id, tierId: row.tier_id,
  quantity: row.quantity, amountCents: row.amount_cents, status: row.status, chargeId: row.charge_id,
  refundId: row.refund_id, refundAmountCents: row.refund_amount_cents,
  createdAt: row.created_at, paidAt: row.paid_at, cancelledAt: row.cancelled_at, refundedAt: row.refunded_at,
  checkedInAt: row.checked_in_at,
});
const toWaitlistEntry = (row) => row && withoutNulls({
  id: row.id, tierId: row.tier_id, eventId: row.event_id, userId: row.user_id, quantity: row.quantity, status: row.status, createdAt: row.created_at,
});
const toOffer = (row) => row && withoutNulls({
  id: row.id, entryId: row.entry_id, tierId: row.tier_id, eventId: row.event_id, userId: row.user_id,
  quantity: row.quantity, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, acceptedAt: row.accepted_at,
});

export function createSqliteRepository({ path, db = openDatabase(path) } = {}) {
  const sql = {
    ensureUser: db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)'),
    insertUser: db.prepare('INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findUserByEmail: db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)'),

    insertEvent: db.prepare(`INSERT INTO events (id, organizer_id, title, city, venue, starts_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    findEvent: db.prepare('SELECT * FROM events WHERE id = ?'),
    updateEvent: db.prepare(`UPDATE events SET title = ?, city = ?, venue = ?, starts_at = ?, status = ? WHERE id = ?`),
    listEvents: db.prepare('SELECT * FROM events ORDER BY rowid'),

    insertTier: db.prepare(`INSERT INTO ticket_tiers (id, event_id, name, price_cents, capacity, sold) VALUES (?, ?, ?, ?, ?, ?)`),
    findTier: db.prepare('SELECT * FROM ticket_tiers WHERE id = ?'),
    updateTier: db.prepare('UPDATE ticket_tiers SET name = ?, price_cents = ?, capacity = ?, sold = ? WHERE id = ?'),
    listTiersForEvent: db.prepare('SELECT * FROM ticket_tiers WHERE event_id = ? ORDER BY rowid'),
    reserveSeats: db.prepare('UPDATE ticket_tiers SET sold = sold + ? WHERE id = ? AND sold + ? <= capacity'),
    releaseSeats: db.prepare('UPDATE ticket_tiers SET sold = sold - ? WHERE id = ? AND sold >= ?'),

    insertBooking: db.prepare(`INSERT INTO bookings (id, reference, user_id, event_id, tier_id, quantity, amount_cents, status, charge_id, refund_id, refund_amount_cents, created_at, paid_at, cancelled_at, refunded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    findBookingByReference: db.prepare('SELECT * FROM bookings WHERE reference = ?'),
    updateBooking: db.prepare(`UPDATE bookings SET status = ?, charge_id = ?, refund_id = ?, refund_amount_cents = ?, paid_at = ?, cancelled_at = ?, refunded_at = ? WHERE reference = ?`),
    listBookingsByUserId: db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY rowid DESC'),
    casBooking: db.prepare(`UPDATE bookings SET status = ?, charge_id = COALESCE(?, charge_id), refund_id = ?, refund_amount_cents = ?, paid_at = COALESCE(?, paid_at), cancelled_at = ?, refunded_at = ?
       WHERE reference = ? AND status IN (SELECT value FROM json_each(?))`),
    checkInBooking: db.prepare(`UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE reference = ? AND status = 'paid'`),
    listPendingBefore: db.prepare(`SELECT * FROM bookings WHERE status = 'pending' AND created_at < ?`),

    insertWaitlist: db.prepare(`INSERT INTO waitlist_entries (id, tier_id, event_id, user_id, quantity, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    findWaitlist: db.prepare('SELECT * FROM waitlist_entries WHERE id = ?'),
    findActiveWaitlist: db.prepare(`SELECT * FROM waitlist_entries WHERE tier_id = ? AND user_id = ? AND status IN ('waiting','offered') LIMIT 1`),
    listWaiting: db.prepare(`SELECT * FROM waitlist_entries WHERE tier_id = ? AND status = 'waiting' ORDER BY created_at, rowid`),
    updateWaitlist: db.prepare(`UPDATE waitlist_entries SET status = ? WHERE id = ?`),

    insertOffer: db.prepare(`INSERT INTO waitlist_offers (id, entry_id, tier_id, event_id, user_id, quantity, status, expires_at, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    findOffer: db.prepare('SELECT * FROM waitlist_offers WHERE id = ?'),
    listOffersForUser: db.prepare(`SELECT * FROM waitlist_offers WHERE user_id = ? AND status = 'active' ORDER BY expires_at`),
    listExpiredOffers: db.prepare(`SELECT * FROM waitlist_offers WHERE status = 'active' AND expires_at <= ?`),
    updateOffer: db.prepare(`UPDATE waitlist_offers SET status = ?, accepted_at = ? WHERE id = ?`),
  };

  const findEvent = (id) => toEvent(sql.findEvent.get(id));
  const findTier = (id) => toTier(sql.findTier.get(id));
  const findBooking = (reference) => toBooking(sql.findBookingByReference.get(reference));
  const findWaitlist = (id) => toWaitlistEntry(sql.findWaitlist.get(id));
  const findOffer = (id) => toOffer(sql.findOffer.get(id));

  return {
    async insertUser(user) {
      sql.insertUser.run(user.id, user.name ?? null, user.email ?? null, user.role ?? null, user.passwordHash ?? null);
      return toUser(sql.findUserById.get(user.id));
    },
    async findUserById(id) { return toUser(sql.findUserById.get(id)); },
    async findUserByEmail(email) { return toUser(sql.findUserByEmail.get(String(email ?? '').trim())); },

    async insertEvent(event) {
      sql.ensureUser.run(event.organizerId);
      sql.insertEvent.run(event.id, event.organizerId, event.title, event.city, event.venue, event.startsAt, event.status);
      return findEvent(event.id);
    },
    async findEvent(id) { return findEvent(id); },
    async updateEvent(event) { sql.updateEvent.run(event.title, event.city, event.venue, event.startsAt, event.status, event.id); return findEvent(event.id); },
    async listEvents() { return sql.listEvents.all().map(toEvent); },

    async insertTier(tier) { sql.insertTier.run(tier.id, tier.eventId, tier.name, tier.priceCents, tier.capacity, tier.sold); return findTier(tier.id); },
    async findTier(id) { return findTier(id); },
    async updateTier(tier) { sql.updateTier.run(tier.name, tier.priceCents, tier.capacity, tier.sold, tier.id); return findTier(tier.id); },
    async listTiersForEvent(eventId) { return sql.listTiersForEvent.all(eventId).map(toTier); },
    async reserveSeats(tierId, quantity) { return sql.reserveSeats.run(quantity, tierId, quantity).changes === 1; },
    async releaseSeats(tierId, quantity) { return sql.releaseSeats.run(quantity, tierId, quantity).changes === 1; },

    async insertBooking(booking) {
      sql.ensureUser.run(booking.userId);
      sql.insertBooking.run(booking.id, booking.reference, booking.userId, booking.eventId, booking.tierId, booking.quantity, booking.amountCents,
        booking.status, booking.chargeId ?? null, booking.refundId ?? null, booking.refundAmountCents ?? null, booking.createdAt, booking.paidAt ?? null, booking.cancelledAt ?? null, booking.refundedAt ?? null);
      return findBooking(booking.reference);
    },
    async findBookingByReference(reference) { return findBooking(reference); },
    async updateBooking(booking) {
      sql.updateBooking.run(booking.status, booking.chargeId ?? null, booking.refundId ?? null, booking.refundAmountCents ?? null,
        booking.paidAt ?? null, booking.cancelledAt ?? null, booking.refundedAt ?? null, booking.reference);
      return findBooking(booking.reference);
    },
    async listBookingsByUserId(userId) { return sql.listBookingsByUserId.all(userId).map(toBooking); },
    async transitionBookingStatus(reference, fromStatuses, patch) {
      const res = sql.casBooking.run(
        patch.status, patch.chargeId ?? null, patch.refundId ?? null, patch.refundAmountCents ?? null,
        patch.paidAt ?? null, patch.cancelledAt ?? null, patch.refundedAt ?? null,
        reference, JSON.stringify(fromStatuses),
      );
      return res.changes === 1 ? findBooking(reference) : null;
    },
    async listPendingBookingsCreatedBefore(isoCutoff) { return sql.listPendingBefore.all(isoCutoff).map(toBooking); },
    async checkInBooking(reference, checkedInAt) {
      const res = sql.checkInBooking.run(checkedInAt, reference);
      return res.changes === 1 ? findBooking(reference) : null;
    },

    async insertWaitlistEntry(entry) {
      sql.ensureUser.run(entry.userId);
      sql.insertWaitlist.run(entry.id, entry.tierId, entry.eventId, entry.userId, entry.quantity, entry.status, entry.createdAt);
      return findWaitlist(entry.id);
    },
    async findWaitlistEntry(id) { return findWaitlist(id); },
    async findActiveWaitlistEntry({ tierId, userId }) { return toWaitlistEntry(sql.findActiveWaitlist.get(tierId, userId)); },
    async listWaitingEntries(tierId) { return sql.listWaiting.all(tierId).map(toWaitlistEntry); },
    async updateWaitlistEntry(entry) { sql.updateWaitlist.run(entry.status, entry.id); return findWaitlist(entry.id); },

    async insertOffer(offer) {
      sql.ensureUser.run(offer.userId);
      sql.insertOffer.run(offer.id, offer.entryId, offer.tierId, offer.eventId, offer.userId, offer.quantity, offer.status, offer.expiresAt, offer.createdAt, offer.acceptedAt ?? null);
      return findOffer(offer.id);
    },
    async findOffer(id) { return findOffer(id); },
    async listActiveOffersForUser(userId) { return sql.listOffersForUser.all(userId).map(toOffer); },
    async listExpiredActiveOffers(nowIso) { return sql.listExpiredOffers.all(nowIso).map(toOffer); },
    async updateOffer(offer) { sql.updateOffer.run(offer.status, offer.acceptedAt ?? null, offer.id); return findOffer(offer.id); },

    close() { if (db.isOpen) db.close(); },
  };
}
