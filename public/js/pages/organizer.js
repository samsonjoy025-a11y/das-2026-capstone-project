import { addTier, createEvent, publishEvent } from '../api.js';
import { clear, el, formatPrice } from '../ui.js';
import { getUser, isLoggedIn } from '../session.js';

function notice(kind, text) {
  return el('div', { className: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
}

function field(id, labelText, input) {
  return el('div', { className: 'field' }, [el('label', { htmlFor: id, text: labelText }), input]);
}

export async function initOrganizer() {
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);
  app.appendChild(el('h1', { text: 'Organizer' }));

  if (!isLoggedIn()) {
    app.appendChild(el('div', { className: 'panel' }, [
      el('p', { text: 'Log in as an organizer to manage events.' }),
      el('p', {}, [el('a', { href: 'login.html?next=organizer.html', text: 'Log in or sign up' })]),
    ]));
    return;
  }
  const user = getUser();
  if (user?.role && user.role !== 'organizer') {
    app.appendChild(notice('error', 'You must be an organizer to create events. Sign up or log in as an organizer.'));
    app.appendChild(el('p', {}, [el('a', { href: 'login.html?next=organizer.html', text: 'Switch account' })]));
    return;
  }

  const status = el('div', { className: 'status', 'aria-live': 'polite' });
  let currentEvent = null;
  const eventStatus = el('div', { className: 'panel', hidden: true });

  // Create event
  const title = el('input', { id: 'ev-title', type: 'text', required: true });
  const city = el('input', { id: 'ev-city', type: 'text', required: true });
  const venue = el('input', { id: 'ev-venue', type: 'text' });
  const startsAt = el('input', { id: 'ev-starts', type: 'datetime-local', required: true });
  const createBtn = el('button', { type: 'submit', className: 'btn-primary', text: 'Create draft event' });
  const createForm = el('form', { className: 'checkout-form panel' }, [
    el('h2', { text: 'Create an event' }),
    field('ev-title', 'Title', title),
    field('ev-city', 'City', city),
    field('ev-venue', 'Venue', venue),
    field('ev-starts', 'Starts at', startsAt),
    el('div', { className: 'actions' }, [createBtn]),
  ]);

  // Add tier
  const tierName = el('input', { id: 'tier-name', type: 'text', required: true });
  const tierPrice = el('input', { id: 'tier-price', type: 'number', min: '0', step: '1', required: true, inputmode: 'numeric' });
  const tierCap = el('input', { id: 'tier-cap', type: 'number', min: '1', step: '1', required: true, inputmode: 'numeric' });
  const tierBtn = el('button', { type: 'submit', className: 'btn-primary', text: 'Add tier' });
  const tierForm = el('form', { className: 'checkout-form panel', hidden: true }, [
    el('h2', { text: 'Add a ticket tier' }),
    el('p', { className: 'muted', text: 'Price is in whole cents (e.g. 250000 = ₦2,500).' }),
    field('tier-name', 'Tier name', tierName),
    field('tier-price', 'Price (whole cents)', tierPrice),
    field('tier-cap', 'Capacity', tierCap),
    el('div', { className: 'actions' }, [tierBtn]),
  ]);

  const publishBtn = el('button', { type: 'button', className: 'btn-primary', text: 'Publish event' });
  const publishPanel = el('div', { className: 'panel', hidden: true }, [
    el('h2', { text: 'Publish' }),
    el('p', { text: 'Add at least one tier, then publish to make the event public.' }),
    el('div', { className: 'actions' }, [publishBtn]),
  ]);

  function renderEvent() {
    clear(eventStatus);
    if (!currentEvent) { eventStatus.hidden = true; tierForm.hidden = true; publishPanel.hidden = true; return; }
    eventStatus.hidden = false; tierForm.hidden = false; publishPanel.hidden = currentEvent.status === 'published';
    eventStatus.append(
      el('h2', { text: 'Current event' }),
      el('p', { text: `${currentEvent.title} (${currentEvent.status})` }),
      el('p', { className: 'meta', text: `ID: ${currentEvent.id}` }),
    );
    const tiers = currentEvent.tiers || [];
    if (tiers.length) {
      const ul = el('ul');
      for (const t of tiers) ul.appendChild(el('li', { text: `${t.name} — ${formatPrice(t.priceCents)} · ${t.capacity} seats` }));
      eventStatus.appendChild(ul);
    }
  }

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(status); createBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Creating event…' }));
    try {
      // datetime-local has no timezone; treat as UTC for simplicity.
      const iso = startsAt.value ? new Date(startsAt.value).toISOString() : '';
      currentEvent = await createEvent({ title: title.value, city: city.value, venue: venue.value, startsAt: iso });
      clear(status);
      status.appendChild(notice('success', `Draft event created: ${currentEvent.id}`));
      renderEvent();
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err?.body?.error?.message || err.message || 'Could not create event.'));
    } finally { createBtn.disabled = false; }
  });

  tierForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEvent) return;
    clear(status); tierBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Adding tier…' }));
    try {
      await addTier(currentEvent.id, { name: tierName.value, priceCents: Number(tierPrice.value), capacity: Number(tierCap.value) });
      // Refresh local view (simple: refetch tiers not directly available; keep minimal)
      if (!currentEvent.tiers) currentEvent.tiers = [];
      currentEvent.tiers.push({ name: tierName.value, priceCents: Number(tierPrice.value), capacity: Number(tierCap.value) });
      tierName.value = ''; tierPrice.value = ''; tierCap.value = '';
      clear(status);
      status.appendChild(notice('success', 'Tier added.'));
      renderEvent();
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err?.body?.error?.message || err.message || 'Could not add tier.'));
    } finally { tierBtn.disabled = false; }
  });

  publishBtn.addEventListener('click', async () => {
    if (!currentEvent) return;
    clear(status); publishBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Publishing…' }));
    try {
      currentEvent = await publishEvent(currentEvent.id);
      clear(status);
      status.appendChild(notice('success', 'Event published.'));
      renderEvent();
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err?.body?.error?.message || err.message || 'Could not publish.'));
      publishBtn.disabled = false;
    }
  });

  app.append(status, createForm, eventStatus, tierForm, publishPanel);
}
