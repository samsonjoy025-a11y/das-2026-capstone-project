// Data access for the pages. Pages must never call fetch directly.
// Build 7: uses fetch and sends Authorization: Bearer <token>.

import { getToken } from './session.js';

async function request(method, path, { body, auth = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
}

export async function listEvents({ q, city, maxPriceCents, sort = 'date' } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (city) params.set('city', city);
  if (maxPriceCents != null && maxPriceCents !== '') params.set('maxPriceCents', maxPriceCents);
  if (sort) params.set('sort', sort);
  const qs = params.toString();
  return request('GET', `/api/events${qs ? `?${qs}` : ''}`);
}

export async function getEvent(id) {
  return request('GET', `/api/events/${encodeURIComponent(id)}`, { auth: true });
}

export async function createBooking({ tierId, quantity }) {
  return request('POST', '/api/bookings', { body: { tierId, quantity }, auth: true });
}

export async function pay(reference, { paymentToken } = {}) {
  return request('POST', `/api/bookings/${encodeURIComponent(reference)}/pay`, { body: { paymentToken }, auth: true });
}

export async function signup({ email, password, role, name }) {
  return request('POST', '/api/auth/signup', { body: { email, password, role, name } });
}

export async function login({ email, password }) {
  return request('POST', '/api/auth/login', { body: { email, password } });
}

export async function me() {
  return request('GET', '/api/auth/me', { auth: true });
}

export async function listMyBookings() {
  return request('GET', '/api/bookings', { auth: true });
}

export async function cancelBooking(reference) {
  return request('POST', `/api/bookings/${encodeURIComponent(reference)}/cancel`, { auth: true });
}

export async function getRefundQuote(reference) {
  return request('GET', `/api/bookings/${encodeURIComponent(reference)}/refund-quote`, { auth: true });
}

export async function joinWaitlist({ tierId, quantity }) {
  return request('POST', '/api/waitlist', { body: { tierId, quantity }, auth: true });
}

export async function listMyOffers() {
  return request('GET', '/api/waitlist/offers', { auth: true });
}

export async function acceptOffer(offerId) {
  return request('POST', `/api/waitlist/offers/${encodeURIComponent(offerId)}/accept`, { auth: true });
}

export async function getTicketToken(reference) {
  return request('GET', `/api/bookings/${encodeURIComponent(reference)}/ticket`, { auth: true });
}

export async function checkInTicket({ token, eventId } = {}) {
  return request('POST', '/api/checkin', { body: { token, eventId }, auth: true });
}

export async function createEvent(body) {
  return request('POST', '/api/events', { body, auth: true });
}

export async function addTier(eventId, body) {
  return request('POST', `/api/events/${encodeURIComponent(eventId)}/tiers`, { body, auth: true });
}

export async function publishEvent(eventId) {
  return request('POST', `/api/events/${encodeURIComponent(eventId)}/publish`, { auth: true });
}
