// API routes. Translation only.

import { openApiDocument } from './openapi.js';
import { optionalUser, requireRole, requireUser } from './guards.js';
import { clientIp } from '../lib/rateLimit.js';

function toNumber(value) { return value === undefined || value === '' ? undefined : Number(value); }
function searchCriteria(query) {
  return { q: query.q, city: query.city, from: query.from, to: query.to,
    maxPriceCents: toNumber(query.maxPriceCents), onlyAvailable: query.onlyAvailable === 'true' || query.onlyAvailable === '1' };
}

export function registerApiRoutes(router, { eventService, bookingService, waitlistService, checkinService, checkinLimiter } = {}) {
  router.get('/openapi.json', () => ({ status: 200, body: openApiDocument }));

  router.post('/api/events', async ({ request, body }) => ({ status: 201, body: await eventService.createEvent(requireRole(request, 'organizer'), body) }));
  router.get('/api/events', async ({ query }) => ({ status: 200, body: { events: await eventService.searchPublishedEvents(searchCriteria(query), query.sort || 'date') } }));
  router.get('/api/events/:id', async ({ request, params }) => ({ status: 200, body: await eventService.getEvent(optionalUser(request), params.id) }));
  router.post('/api/events/:id/tiers', async ({ request, params, body }) => ({ status: 201, body: await eventService.addTier(requireRole(request, 'organizer'), params.id, body) }));
  router.post('/api/events/:id/publish', async ({ request, params }) => ({ status: 200, body: await eventService.publishEvent(requireRole(request, 'organizer'), params.id) }));
  router.post('/api/events/:id/unpublish', async ({ request, params }) => ({ status: 200, body: await eventService.unpublishEvent(requireRole(request, 'organizer'), params.id) }));

  router.get('/api/bookings', async ({ request }) => ({ status: 200, body: { bookings: await bookingService.listMyBookings(requireUser(request)) } }));
  router.post('/api/bookings', async ({ request, body }) => ({ status: 201, body: await bookingService.book(requireUser(request), body) }));
  router.get('/api/bookings/:reference', async ({ request, params }) => ({ status: 200, body: await bookingService.getBooking(requireUser(request), params.reference) }));
  router.get('/api/bookings/:reference/refund-quote', async ({ request, params }) => ({ status: 200, body: await bookingService.refundQuote(requireUser(request), params.reference) }));
  router.post('/api/bookings/:reference/pay', async ({ request, params, body }) => ({ status: 200, body: await bookingService.pay(requireUser(request), params.reference, body) }));
  router.post('/api/bookings/:reference/cancel', async ({ request, params }) => ({ status: 200, body: await bookingService.cancel(requireUser(request), params.reference) }));
  router.get('/api/bookings/:reference/ticket', async ({ request, params }) => ({ status: 200, body: await bookingService.getTicketToken(requireUser(request), params.reference) }));

  if (checkinService) {
    router.post('/api/checkin', async ({ request, body }) => {
      requireRole(request, 'staff');
      if (checkinLimiter) checkinLimiter.check(`checkin:${clientIp(request)}`);
      return { status: 200, body: await checkinService.checkIn(body || {}) };
    });
  }

  if (waitlistService) {
    router.post('/api/waitlist', async ({ request, body }) => ({ status: 201, body: await waitlistService.join(requireUser(request), body) }));
    router.get('/api/waitlist/offers', async ({ request }) => ({ status: 200, body: { offers: await waitlistService.listMyOffers(requireUser(request)) } }));
    router.post('/api/waitlist/offers/:id/accept', async ({ request, params }) => ({ status: 200, body: await waitlistService.acceptOffer(requireUser(request), params.id) }));
  }

  return router;
}
