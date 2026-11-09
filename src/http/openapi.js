// OpenAPI 3.1 description, served at GET /openapi.json. public/docs.html renders it.
// When you add or change a route in routes.js, update this file too.

const json = (schema) => ({ content: { 'application/json': { schema } } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description, codes) => ({
  description: `${description} Possible codes: ${codes.map((code) => `\`${code}\``).join(', ')}.`,
  ...json(ref('Error')),
});

const bearer = [{ BearerAuth: [] }];
const anyone = [];
const eventIdParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const referenceParam = { name: 'reference', in: 'path', required: true, schema: { type: 'string' }, description: 'Booking reference' };
const offerIdParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Waitlist offer id' };

const errors = {
  validation: errorResponse('The input is missing or wrong.', ['VALIDATION', 'INVALID_JSON']),
  unauthenticated: errorResponse('Missing, invalid, or expired bearer token.', ['UNAUTHENTICATED']),
  forbidden: errorResponse('You do not have permission.', ['FORBIDDEN']),
  notFound: errorResponse('It does not exist (or is hidden).', ['NOT_FOUND']),
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Event Ticketing API',
    version: '0.9.0',
    description: [
      'Event ticketing API (Builds 4–9).',
      '',
      '**Auth (Build 7):** `POST /api/auth/signup` or `/login` returns a token. Send `Authorization: Bearer <token>` on protected calls.',
      '**Tickets/Check-in (Build 9):** paid bookings get a signed ticket token (HMAC) for QR codes. Staff check in via `POST /api/checkin`.',
      '**Money** is whole cents (e.g. `500000` = 5,000.00).',
      '**Errors:** `{ "error": { "code": "...", "message": "..." } }`.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Auth', description: 'Signup, login, and current user.' },
    { name: 'Events', description: 'Create/publish events and search published ones.' },
    { name: 'Bookings', description: 'Book, pay, cancel/refund, and view own bookings.' },
    { name: 'Waitlist', description: 'Join sold-out tiers and accept timed offers.' },
    { name: 'Check-in', description: 'Staff admit paid tickets by signed QR code.' },
    { name: 'System' },
  ],
  paths: {
    '/health': { get: { tags: ['System'], summary: 'Health check', operationId: 'health', security: anyone, responses: { 200: { description: 'OK', ...json({ type: 'object', properties: { status: { const: 'ok' } } }) } } } },

    '/api/auth/signup': { post: { tags: ['Auth'], summary: 'Sign up', operationId: 'signup', security: anyone, requestBody: { required: true, ...json(ref('Signup')) }, responses: { 201: { description: 'Account created', ...json(ref('AuthResult')) }, 400: errors.validation, 409: errorResponse('Email already registered.', ['EMAIL_TAKEN']) } } },
    '/api/auth/login': { post: { tags: ['Auth'], summary: 'Log in', operationId: 'login', security: anyone, requestBody: { required: true, ...json(ref('Login')) }, responses: { 200: { description: 'Token issued', ...json(ref('AuthResult')) }, 401: errorResponse('Wrong password or unknown email (same message).', ['INVALID_CREDENTIALS']) } } },
    '/api/auth/me': { get: { tags: ['Auth'], summary: 'Current user', operationId: 'me', security: bearer, responses: { 200: { description: 'Current user', ...json(ref('Me')) }, 401: errors.unauthenticated } } },

    '/api/events': {
      post: { tags: ['Events'], summary: 'Create an event (organizer)', operationId: 'createEvent', security: bearer, requestBody: { required: true, ...json(ref('NewEvent')) }, responses: { 201: { description: 'Draft event', ...json(ref('EventDetail')) }, 400: errors.validation, 401: errors.unauthenticated, 403: errors.forbidden } },
      get: { tags: ['Events'], summary: 'Search published events', operationId: 'searchEvents', security: anyone, parameters: [
        { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'city', in: 'query', schema: { type: 'string' } },
        { name: 'from', in: 'query', schema: { type: 'string' } }, { name: 'to', in: 'query', schema: { type: 'string' } },
        { name: 'maxPriceCents', in: 'query', schema: { type: 'integer', minimum: 0 } }, { name: 'onlyAvailable', in: 'query', schema: { type: 'boolean' } },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['date', 'price', 'availability'], default: 'date' } },
      ], responses: { 200: { description: 'Matching events', ...json({ type: 'object', properties: { events: { type: 'array', items: ref('EventSummary') } } }) }, 400: errors.validation } },
    },
    '/api/events/{id}': { get: { tags: ['Events'], summary: 'View an event', operationId: 'getEvent', security: [{}, { BearerAuth: [] }], parameters: [eventIdParam], responses: { 200: { description: 'Event', ...json(ref('EventDetail')) }, 404: errors.notFound } } },
    '/api/events/{id}/tiers': { post: { tags: ['Events'], summary: 'Add a ticket tier (organizer)', operationId: 'addTier', security: bearer, parameters: [eventIdParam], requestBody: { required: true, ...json(ref('NewTier')) }, responses: { 201: { description: 'Tier', ...json(ref('Tier')) }, 400: errors.validation, 401: errors.unauthenticated, 403: errors.forbidden, 404: errors.notFound } } },
    '/api/events/{id}/publish': { post: { tags: ['Events'], summary: 'Publish an event (organizer)', operationId: 'publishEvent', security: bearer, parameters: [eventIdParam], responses: { 200: { description: 'Published', ...json(ref('EventDetail')) }, 401: errors.unauthenticated, 403: errors.forbidden, 404: errors.notFound, 409: errorResponse('No tiers.', ['INVALID_STATE']) } } },
    '/api/events/{id}/unpublish': { post: { tags: ['Events'], summary: 'Unpublish an event (organizer)', operationId: 'unpublishEvent', security: bearer, parameters: [eventIdParam], responses: { 200: { description: 'Draft', ...json(ref('EventDetail')) }, 401: errors.unauthenticated, 403: errors.forbidden, 404: errors.notFound } } },

    '/api/bookings': {
      get: { tags: ['Bookings'], summary: 'List my bookings', operationId: 'listMyBookings', security: bearer, responses: { 200: { description: 'My bookings', ...json({ type: 'object', properties: { bookings: { type: 'array', items: ref('Booking') } } }) }, 401: errors.unauthenticated } },
      post: { tags: ['Bookings'], summary: 'Book tickets', operationId: 'book', security: bearer, requestBody: { required: true, ...json(ref('NewBooking')) }, responses: { 201: { description: 'Pending booking', ...json(ref('Booking')) }, 400: errors.validation, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Not enough seats / invalid state.', ['SOLD_OUT', 'INVALID_STATE']) } },
    },
    '/api/bookings/{reference}': { get: { tags: ['Bookings'], summary: 'View a booking (owner)', operationId: 'getBooking', security: bearer, parameters: [referenceParam], responses: { 200: { description: 'Booking', ...json(ref('Booking')) }, 401: errors.unauthenticated, 404: errors.notFound } } },
    '/api/bookings/{reference}/refund-quote': { get: { tags: ['Bookings'], summary: 'Refund quote before cancelling', operationId: 'refundQuote', security: bearer, parameters: [referenceParam], responses: { 200: { description: 'Quote', ...json(ref('RefundQuote')) }, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Cannot quote/cancel in this state.', ['INVALID_TRANSITION', 'EVENT_STARTED']) } } },
    '/api/bookings/{reference}/pay': { post: { tags: ['Bookings'], summary: 'Pay for a booking (mock)', operationId: 'pay', security: bearer, parameters: [referenceParam], requestBody: { required: true, ...json({ type: 'object', required: ['paymentToken'], properties: { paymentToken: { type: 'string', enum: ['tok_success', 'tok_declined'] } } }) }, responses: { 200: { description: 'Paid', ...json(ref('Booking')) }, 400: errors.validation, 401: errors.unauthenticated, 402: errorResponse('Declined; booking stays pending.', ['PAYMENT_DECLINED']), 404: errors.notFound, 409: errorResponse('Invalid transition or expired.', ['INVALID_TRANSITION', 'BOOKING_EXPIRED']) } } },
    '/api/bookings/{reference}/cancel': { post: { tags: ['Bookings'], summary: 'Cancel (pending or paid/refund per policy)', operationId: 'cancel', security: bearer, parameters: [referenceParam], responses: { 200: { description: 'Cancelled/refunded (CAS; seats released once)', ...json(ref('Booking')) }, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Cannot cancel in this state.', ['INVALID_TRANSITION', 'EVENT_STARTED']) } } },
    '/api/bookings/{reference}/ticket': { get: { tags: ['Bookings'], summary: 'Get signed ticket token for QR (owner, paid/checked-in)', operationId: 'ticketToken', security: bearer, parameters: [referenceParam], responses: { 200: { description: 'Ticket token', ...json(ref('TicketToken')) }, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Not a paid ticket.', ['INVALID_STATE']) } } },

    '/api/waitlist': { post: { tags: ['Waitlist'], summary: 'Join waitlist for a sold-out tier', operationId: 'joinWaitlist', security: bearer, requestBody: { required: true, ...json(ref('JoinWaitlist')) }, responses: { 201: { description: 'Joined', ...json(ref('WaitlistEntry')) }, 400: errors.validation, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Seats remain or already waiting.', ['NOT_SOLD_OUT', 'ALREADY_ON_WAITLIST', 'INVALID_STATE']) } } },
    '/api/waitlist/offers': { get: { tags: ['Waitlist'], summary: 'List my active waitlist offers', operationId: 'listMyOffers', security: bearer, responses: { 200: { description: 'Offers', ...json({ type: 'object', properties: { offers: { type: 'array', items: ref('WaitlistOffer') } } }) }, 401: errors.unauthenticated } } },
    '/api/waitlist/offers/{id}/accept': { post: { tags: ['Waitlist'], summary: 'Accept a waitlist offer', operationId: 'acceptOffer', security: bearer, parameters: [offerIdParam], responses: { 200: { description: 'Accepted; pending booking created (seats held by offer)', ...json(ref('Booking')) }, 401: errors.unauthenticated, 404: errors.notFound, 409: errorResponse('Offer expired.', ['OFFER_EXPIRED']) } } },

    '/api/checkin': { post: { tags: ['Check-in'], summary: 'Check in a ticket (staff only)', operationId: 'checkin', security: bearer, requestBody: { required: true, ...json(ref('CheckInRequest')) }, responses: { 200: { description: 'Admitted', ...json(ref('CheckInResult')) }, 400: errorResponse('Invalid/forged ticket code.', ['INVALID_TICKET', 'VALIDATION']), 401: errors.unauthenticated, 403: errors.forbidden, 409: errorResponse('Duplicate, wrong event, or not valid for admission.', ['DUPLICATE_SCAN', 'WRONG_EVENT']) } } },
  },
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'HS256 token from signup/login.' },
    },
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      Signup: { type: 'object', required: ['email', 'password', 'role'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 }, role: { type: 'string', enum: ['attendee', 'organizer', 'staff'] }, name: { type: 'string' } } },
      Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
      User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' }, name: { type: ['string', 'null'] } } },
      AuthResult: { type: 'object', properties: { user: ref('User'), token: { type: 'string' } } },
      Me: { type: 'object', properties: { user: ref('User') } },
      NewEvent: { type: 'object', required: ['title', 'city', 'startsAt'], properties: { title: { type: 'string' }, city: { type: 'string' }, venue: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' } } },
      EventSummary: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, city: { type: 'string' }, venue: { type: 'string' }, startsAt: { type: 'string' }, status: { type: 'string' }, tierCount: { type: 'integer' }, minPriceCents: { type: ['integer', 'null'] }, seatsLeft: { type: 'integer' } } },
      EventDetail: { allOf: [ref('EventSummary'), { type: 'object', properties: { organizerId: { type: 'string' }, tiers: { type: 'array', items: ref('Tier') } } }] },
      NewTier: { type: 'object', required: ['name', 'priceCents', 'capacity'], properties: { name: { type: 'string' }, priceCents: { type: 'integer', minimum: 0 }, capacity: { type: 'integer', minimum: 1 } } },
      Tier: { type: 'object', properties: { id: { type: 'string' }, eventId: { type: 'string' }, name: { type: 'string' }, priceCents: { type: 'integer' }, capacity: { type: 'integer' }, sold: { type: 'integer' }, seatsLeft: { type: 'integer' } } },
      NewBooking: { type: 'object', required: ['tierId', 'quantity'], properties: { tierId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 10 } } },
      Booking: { type: 'object', properties: { reference: { type: 'string' }, eventId: { type: 'string' }, tierId: { type: 'string' }, quantity: { type: 'integer' }, amountCents: { type: 'integer' }, status: { type: 'string', enum: ['pending', 'paid', 'cancelled', 'refunded', 'checked_in'] }, refundAmountCents: { type: 'integer' }, createdAt: { type: 'string' }, paidAt: { type: 'string' }, cancelledAt: { type: 'string' }, refundedAt: { type: 'string' } } },
      RefundQuote: { type: 'object', properties: { reference: { type: 'string' }, refundAmountCents: { type: 'integer' }, amountCents: { type: 'integer' }, canCancel: { type: 'boolean' } } },
      JoinWaitlist: { type: 'object', required: ['tierId', 'quantity'], properties: { tierId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 10 } } },
      WaitlistEntry: { type: 'object', properties: { id: { type: 'string' }, tierId: { type: 'string' }, eventId: { type: 'string' }, quantity: { type: 'integer' }, status: { type: 'string' }, createdAt: { type: 'string' } } },
      WaitlistOffer: { type: 'object', properties: { id: { type: 'string' }, tierId: { type: 'string' }, quantity: { type: 'integer' }, status: { type: 'string' }, expiresAt: { type: 'string' } } },
      TicketToken: { type: 'object', properties: { reference: { type: 'string' }, token: { type: 'string' } } },
      CheckInRequest: { type: 'object', required: ['token'], properties: { token: { type: 'string' }, eventId: { type: 'string' } } },
      CheckInResult: { type: 'object', properties: { status: { type: 'string' }, reference: { type: 'string' }, checkedInAt: { type: 'string' }, eventId: { type: 'string' } } },
    },
  },
};
