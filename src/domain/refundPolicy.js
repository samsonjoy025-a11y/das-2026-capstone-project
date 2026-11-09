import { DomainError } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(value, field) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(t)) throw new DomainError('VALIDATION', `${field} must be a valid date`);
  return t;
}

export function calculateRefund({ amountCents, startsAt, now }) {
  const startTime = toTime(startsAt, 'startsAt');
  const nowTime = toTime(now, 'now');
  if (nowTime >= startTime) throw new DomainError('EVENT_STARTED', 'The event has already started');

  const daysBefore = (startTime - nowTime) / DAY_MS;
  // 7 days or more before start: 100%; 2 days or more: 50%; under 2 days: 0%.
  // An exact boundary belongs to the better tier.
  let percent = 0;
  if (daysBefore >= 7) percent = 100;
  else if (daysBefore >= 2) percent = 50;
  else percent = 0;

  return Math.floor((amountCents * percent) / 100);
}
