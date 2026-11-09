// Fake data for Build 6. Shapes mirror the real API responses in docs/api-examples.md.
// All money is whole cents.

export const events = [
  {
    id: 'evt-lagos-tech',
    title: 'Lagos Tech Meetup',
    city: 'Lagos',
    venue: 'Landmark Centre',
    startsAt: '2026-12-05T17:00:00Z',
    status: 'published',
    organizerId: 'org-1',
    tiers: [
      { id: 'tier-lt-general', eventId: 'evt-lagos-tech', name: 'General', priceCents: 500000, capacity: 100, sold: 42 },
      { id: 'tier-lt-vip', eventId: 'evt-lagos-tech', name: 'VIP', priceCents: 1500000, capacity: 20, sold: 20 },
      { id: 'tier-lt-student', eventId: 'evt-lagos-tech', name: 'Student', priceCents: 250000, capacity: 30, sold: 10 },
    ],
  },
  {
    id: 'evt-abuja-jazz',
    title: 'Abuja Jazz Night',
    city: 'Abuja',
    venue: 'Moscow Road Amphitheatre',
    startsAt: '2026-11-20T19:00:00Z',
    status: 'published',
    organizerId: 'org-1',
    tiers: [
      { id: 'tier-aj-regular', eventId: 'evt-abuja-jazz', name: 'Regular', priceCents: 300000, capacity: 150, sold: 60 },
      { id: 'tier-aj-table', eventId: 'evt-abuja-jazz', name: 'Table (4 seats)', priceCents: 2000000, capacity: 10, sold: 3 },
    ],
  },
  {
    id: 'evt-ibadan-food',
    title: 'Ibadan Food Fair',
    city: 'Ibadan',
    venue: 'Agodi Gardens',
    startsAt: '2026-10-10T11:00:00Z',
    status: 'published',
    organizerId: 'org-1',
    tiers: [
      { id: 'tier-if-entry', eventId: 'evt-ibadan-food', name: 'Entry', priceCents: 150000, capacity: 200, sold: 200 },
    ],
  },
  {
    id: 'evt-ph-startup',
    title: 'Port Harcourt Startup Day',
    city: 'Port Harcourt',
    venue: 'Hotel Presidential',
    startsAt: '2027-01-15T09:00:00Z',
    status: 'published',
    organizerId: 'org-1',
    tiers: [
      { id: 'tier-ph-founder', eventId: 'evt-ph-startup', name: 'Founder', priceCents: 750000, capacity: 50, sold: 5 },
      { id: 'tier-ph-early', eventId: 'evt-ph-startup', name: 'Early Bird', priceCents: 400000, capacity: 80, sold: 80 },
    ],
  },
  {
    id: 'evt-kano-art',
    title: 'Kano Art & Culture Expo',
    city: 'Kano',
    venue: 'Ado Bayero Mall Hall',
    startsAt: '2026-12-28T10:00:00Z',
    status: 'published',
    organizerId: 'org-1',
    tiers: [
      { id: 'tier-ka-standard', eventId: 'evt-kano-art', name: 'Standard', priceCents: 100000, capacity: 300, sold: 12 },
    ],
  },
];

export function seatsLeft(tier) {
  return Math.max(0, tier.capacity - tier.sold);
}

export function summarizeEvent(event) {
  const tiers = event.tiers || [];
  const left = tiers.reduce((sum, t) => sum + seatsLeft(t), 0);
  const prices = tiers.map((t) => t.priceCents);
  return {
    id: event.id,
    title: event.title,
    city: event.city,
    venue: event.venue,
    startsAt: event.startsAt,
    status: event.status,
    tierCount: tiers.length,
    minPriceCents: prices.length ? Math.min(...prices) : null,
    seatsLeft: left,
  };
}

export function withTierSeatsLeft(tier) {
  return { ...tier, seatsLeft: seatsLeft(tier) };
}
