// Event rules for the API: create, add tiers, publish, unpublish, search.
// The repository is passed in (DI). Domain rules are reused.

import { DomainError } from '../domain/errors.js';
import { searchEvents, summarizeEvent } from '../domain/eventSearch.js';
import { newId } from '../domain/ids.js';
import { requireDate, requireText, requireWholeNumber } from '../domain/validation.js';

function actorIdOf(actor) {
  return typeof actor === 'string' ? actor : (actor?.sub || actor?.id);
}

export function requireActor(actor) {
  const id = actorIdOf(actor);
  if (typeof id !== 'string' || id.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  }
  return id.trim();
}

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('VALIDATION', 'Request body must be a JSON object');
  }
  return input;
}

export function createEventService({ repository }) {
  async function getEvent(eventId) {
    const event = await repository.findEvent(eventId);
    if (!event) throw new DomainError('NOT_FOUND', 'Event not found');
    return event;
  }

  async function getOwnEvent(actor, eventId) {
    const id = requireActor(actor);
    const event = await getEvent(eventId);
    // An organizer can only change their own events (otherwise FORBIDDEN).
    if (event.organizerId !== id) {
      throw new DomainError('FORBIDDEN', 'Only the organizer of this event can change it');
    }
    return event;
  }

  async function withTiers(event) {
    const tiers = await repository.listTiersForEvent(event.id);
    return {
      ...summarizeEvent(event, tiers),
      organizerId: event.organizerId,
      tiers: tiers.map((tier) => ({ ...tier, seatsLeft: tier.capacity - tier.sold })),
    };
  }

  return {
    async createEvent(actor, input) {
      const organizerId = requireActor(actor);
      const role = typeof actor === 'object' ? actor?.role : undefined;
      if (role && role !== 'organizer') {
        throw new DomainError('FORBIDDEN', 'You do not have permission to do that');
      }
      const { title, city, venue, startsAt } = requireObject(input);
      const event = {
        id: newId(),
        organizerId,
        title: requireText(title, 'title'),
        city: requireText(city, 'city'),
        venue: venue === undefined ? '' : String(venue).trim(),
        startsAt: requireDate(startsAt, 'startsAt'),
        status: 'draft',
      };
      return withTiers(await repository.insertEvent(event));
    },

    async addTier(actor, eventId, input) {
      const organizerId = requireActor(actor);
      const role = typeof actor === 'object' ? actor?.role : undefined;
      if (role && role !== 'organizer') {
        throw new DomainError('FORBIDDEN', 'You do not have permission to do that');
      }
      const { name, priceCents, capacity } = requireObject(input);
      await getOwnEvent(organizerId, eventId);
      const tier = {
        id: newId(),
        eventId,
        name: requireText(name, 'name'),
        priceCents: requireWholeNumber(priceCents, 'priceCents', 0),
        capacity: requireWholeNumber(capacity, 'capacity', 1),
        sold: 0,
      };
      const saved = await repository.insertTier(tier);
      return { ...saved, seatsLeft: saved.capacity - saved.sold };
    },

    async publishEvent(actor, eventId) {
      const event = await getOwnEvent(actor, eventId);
      const tiers = await repository.listTiersForEvent(eventId);
      if (tiers.length === 0) {
        throw new DomainError('INVALID_STATE', 'Add at least one ticket tier before publishing');
      }
      return withTiers(await repository.updateEvent({ ...event, status: 'published' }));
    },

    async unpublishEvent(actor, eventId) {
      const event = await getOwnEvent(actor, eventId);
      return withTiers(await repository.updateEvent({ ...event, status: 'draft' }));
    },

    async getEvent(actor, eventId) {
      const event = await getEvent(eventId);
      const actorId = actorIdOf(actor);
      if (event.status !== 'published' && event.organizerId !== actorId) {
        throw new DomainError('NOT_FOUND', 'Event not found');
      }
      return withTiers(event);
    },

    async searchPublishedEvents(criteria = {}, sortBy = 'date') {
      const published = (await repository.listEvents()).filter((event) => event.status === 'published');
      const summaries = await Promise.all(
        published.map(async (event) => summarizeEvent(event, await repository.listTiersForEvent(event.id))),
      );
      return searchEvents(summaries, criteria, sortBy);
    },
  };
}
