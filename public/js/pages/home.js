import { listEvents } from '../api.js';
import { clear, el, formatDate, formatPrice } from '../ui.js';

function uniqueCities(events) {
  return [...new Set(events.map((e) => e.city))].sort((a, b) => a.localeCompare(b));
}

function eventCard(event) {
  const min = event.minPriceCents == null ? '—' : formatPrice(event.minPriceCents);
  return el('article', { className: 'card' }, [
    el('h2', { text: event.title }),
    el('p', { className: 'meta', text: `${event.city} · ${event.venue}` }),
    el('p', { className: 'meta', text: formatDate(event.startsAt) }),
    el('p', {}, [el('span', { className: 'price', text: `From ${min}` }), ` · ${event.seatsLeft} seat(s) left`]),
    el('div', { className: 'actions' }, [
      el('a', { href: `event.html?id=${encodeURIComponent(event.id)}`, text: 'View event' }),
    ]),
  ]);
}

export async function initHome() {
  const app = document.getElementById('app');
  if (!app) return;

  const title = el('h1', { text: 'Browse events' });
  const intro = el('p', { className: 'muted', text: 'Search published events, then choose tickets and check out with a mock card.' });
  const status = el('div', { className: 'status', 'aria-live': 'polite' });
  const results = el('div', { className: 'grid event-list', id: 'results' });

  const q = el('input', { id: 'q', name: 'q', type: 'search', autocomplete: 'off' });
  const city = el('select', { id: 'city', name: 'city' }, [el('option', { value: '', text: 'All cities' })]);
  const maxPrice = el('input', { id: 'maxPrice', name: 'maxPrice', type: 'number', min: '0', step: '1', inputmode: 'numeric' });
  const sort = el('select', { id: 'sort', name: 'sort' }, [
    el('option', { value: 'date', text: 'Date' }),
    el('option', { value: 'price', text: 'Price (lowest)' }),
    el('option', { value: 'availability', text: 'Availability (most seats)' }),
  ]);

  const form = el('form', { className: 'filters', 'aria-label': 'Search and filter events' }, [
    el('div', { className: 'field' }, [el('label', { htmlFor: 'q', text: 'Search' }), q]),
    el('div', { className: 'field' }, [el('label', { htmlFor: 'city', text: 'City' }), city]),
    el('div', { className: 'field' }, [el('label', { htmlFor: 'maxPrice', text: 'Maximum price (₦, whole cents value)' }), maxPrice]),
    el('div', { className: 'field' }, [el('label', { htmlFor: 'sort', text: 'Sort by' }), sort]),
    el('div', { className: 'field actions' }, [el('button', { type: 'submit', className: 'btn-primary', text: 'Search' })]),
  ]);

  async function populateCities() {
    try {
      const all = await listEvents();
      for (const name of uniqueCities(all.events || [])) {
        city.appendChild(el('option', { value: name, text: name }));
      }
    } catch {
      // Filters still work without the city list.
    }
  }

  async function runSearch() {
    clear(status);
    clear(results);
    status.appendChild(el('p', { className: 'muted', text: 'Loading events…' }));
    try {
      const params = {
        q: q.value,
        city: city.value,
        maxPriceCents: maxPrice.value === '' ? undefined : maxPrice.value,
        sort: sort.value,
      };
      const data = await listEvents(params);
      clear(status);
      const list = data.events || [];
      if (!list.length) {
        results.appendChild(el('p', { className: 'muted', text: 'No events match your filters.' }));
        return;
      }
      for (const event of list) results.appendChild(eventCard(event));
    } catch (err) {
      clear(status);
      const message = err?.body?.error?.message || err?.message || 'Could not load events.';
      status.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: message }));
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });
  sort.addEventListener('change', runSearch);

  clear(app);
  app.append(title, intro, form, status, results);
  await populateCities();
  await runSearch();
}
