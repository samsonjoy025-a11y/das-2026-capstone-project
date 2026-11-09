import { createBooking, getEvent, pay, joinWaitlist } from '../api.js';
import { clear, el, formatDate, formatPrice } from '../ui.js';
import { isLoggedIn } from '../session.js';

const HOLD_SECONDS = 10 * 60;

function quantitySelect(max, id) {
  const limit = Math.max(0, Math.min(10, max));
  const select = el('select', { id, name: id, disabled: limit === 0 });
  if (limit === 0) { select.appendChild(el('option', { value: '0', text: '0' })); return select; }
  for (let i = 1; i <= limit; i += 1) select.appendChild(el('option', { value: String(i), text: String(i) }));
  return select;
}

function tierRow(tier, onSelect, onWaitlist) {
  const soldOut = tier.seatsLeft <= 0;
  const info = el('div', {}, [
    el('h3', { text: tier.name }),
    el('p', { className: 'price', text: formatPrice(tier.priceCents) }),
    el('p', { className: 'meta', text: `${tier.seatsLeft} of ${tier.capacity} seat(s) left` }),
    soldOut ? el('span', { className: 'badge badge-soldout', text: 'Sold out' }) : el('span', { className: 'badge badge-ok', text: 'Available' }),
  ]);

  const qtyId = `qty-${tier.id}`;
  const qty = quantitySelect(soldOut ? Math.min(10, tier.capacity) : tier.seatsLeft, qtyId);
  const controls = el('div', { className: 'checkout-form' }, [
    el('div', { className: 'field' }, [el('label', { htmlFor: qtyId, text: 'Quantity' }), qty]),
  ]);
  if (soldOut) {
    const wlBtn = el('button', { type: 'button', className: 'btn-secondary', text: 'Join waitlist' });
    const msg = el('div', { className: 'status', 'aria-live': 'polite' });
    wlBtn.addEventListener('click', async () => onWaitlist(tier, Number(qty.value) || 1, msg, wlBtn));
    controls.append(el('div', { className: 'actions' }, [wlBtn]), msg);
  } else {
    const button = el('button', { type: 'button', className: 'btn-primary', text: 'Select tickets', onClick: () => onSelect(tier, Number(qty.value)) });
    controls.appendChild(el('div', { className: 'actions' }, [button]));
  }
  return el('section', { className: `tier${soldOut ? ' sold-out' : ''}` }, [info, controls]);
}

function startCountdown(container, seconds) {
  let remaining = seconds;
  const box = el('div', { className: 'countdown', 'aria-live': 'polite' });
  container.appendChild(box);
  function render() {
    const m = Math.floor(Math.max(0, remaining) / 60);
    const s = Math.max(0, remaining) % 60;
    box.textContent = remaining > 0 ? `Seats held for ${m}:${String(s).padStart(2, '0')}. Complete payment before the timer ends.` : 'The hold has expired. You can select tickets again to create a new booking.';
    if (remaining <= 0) box.classList.add('expired');
  }
  render();
  const timer = setInterval(() => { remaining -= 1; render(); if (remaining <= 0) clearInterval(timer); }, 1000);
  return { box, stop: () => clearInterval(timer), isExpired: () => remaining <= 0 };
}

export async function initEvent() {
  const app = document.getElementById('app');
  if (!app) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  clear(app);
  app.appendChild(el('p', {}, [el('a', { href: 'index.html', text: '← Back to events' })]));
  const mount = el('div');
  app.appendChild(mount);
  if (!id) { mount.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: 'No event was selected.' })); return; }
  mount.appendChild(el('p', { className: 'muted', text: 'Loading event…' }));
  let event;
  try { event = await getEvent(id); } catch (err) {
    clear(mount);
    mount.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: err?.body?.error?.message || err?.message || 'Could not load the event.' }));
    return;
  }

  const checkoutPanel = el('section', { className: 'panel', id: 'checkout', hidden: true });
  let countdown = null;

  async function onWaitlist(tier, quantity, msg, btn) {
    clear(msg);
    if (!isLoggedIn()) { msg.appendChild(el('div', { className: 'notice notice-error', role: 'alert' }, [el('a', { href: 'login.html', text: 'Log in to join the waitlist' })])); return; }
    btn.disabled = true; msg.appendChild(el('p', { className: 'muted', text: 'Joining waitlist…' }));
    try {
      await joinWaitlist({ tierId: tier.id, quantity: Math.max(1, Math.min(10, quantity || 1)) });
      clear(msg);
      msg.appendChild(el('div', { className: 'notice notice-success', role: 'status', text: 'You are on the waitlist. Check My tickets for offers.' }));
    } catch (err) {
      clear(msg); btn.disabled = false;
      msg.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: err?.body?.error?.message || err.message || 'Could not join waitlist.' }));
    }
  }

  function openCheckout(tier, quantity) {
    if (countdown) countdown.stop();
    clear(checkoutPanel); checkoutPanel.hidden = false;
    if (!Number.isInteger(quantity) || quantity < 1) { checkoutPanel.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: 'Choose a quantity first.' })); return; }
    if (quantity > 10 || quantity > tier.seatsLeft) { checkoutPanel.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: 'That quantity is not available.' })); return; }
    if (!isLoggedIn()) {
      checkoutPanel.append(el('h2', { text: 'Checkout' }), el('p', { text: 'You need an account to book tickets.' }), el('p', {}, [el('a', { href: `login.html?next=${encodeURIComponent(window.location.href)}`, text: 'Log in or sign up' })]));
      checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    const status = el('div', { className: 'status', 'aria-live': 'polite' });
    const total = tier.priceCents * quantity;
    checkoutPanel.append(el('h2', { text: 'Checkout' }), el('p', { text: `${tier.name} × ${quantity} — ${formatPrice(total)}` }));
    const timerMount = el('div'); checkoutPanel.appendChild(timerMount);
    const tokenId = 'paymentToken';
    const token = el('select', { id: tokenId, name: 'paymentToken' }, [el('option', { value: 'tok_success', text: 'Mock card: success' }), el('option', { value: 'tok_declined', text: 'Mock card: declined' })]);
    const payBtn = el('button', { type: 'submit', className: 'btn-primary', text: 'Pay now' });
    const form = el('form', { className: 'checkout-form' }, [el('div', { className: 'field' }, [el('label', { htmlFor: tokenId, text: 'Payment method (mock)' }), token]), el('div', { className: 'actions' }, [payBtn]), status]);
    checkoutPanel.appendChild(form);
    let booking = null;
    async function ensureBooking() { if (booking) return booking; booking = await createBooking({ tierId: tier.id, quantity }); return booking; }
    ensureBooking().then(() => { countdown = startCountdown(timerMount, HOLD_SECONDS); }).catch((err) => {
      const message = err?.body?.error?.message || err?.message || 'Could not create the booking.';
      status.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: message })); payBtn.disabled = true;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); clear(status);
      if (countdown && countdown.isExpired()) { status.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: 'The hold expired. Select tickets again.' })); return; }
      payBtn.disabled = true;
      try {
        const b = await ensureBooking();
        const paid = await pay(b.reference, { paymentToken: token.value });
        if (countdown) countdown.stop(); clear(status);
        status.appendChild(el('div', { className: 'notice notice-success', role: 'status', text: `Payment confirmed. Booking ${paid.reference} is ${paid.status}.` }));
        form.querySelectorAll('select, button').forEach((n) => { n.disabled = true; });
      } catch (err) {
        const message = err?.body?.error?.message || err?.message || 'Payment failed.';
        status.appendChild(el('div', { className: 'notice notice-error', role: 'alert', text: message })); payBtn.disabled = false;
      }
    });
    checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  clear(mount);
  mount.append(el('h1', { text: event.title }), el('p', { className: 'meta', text: `${event.city} · ${event.venue}` }), el('p', { className: 'meta', text: formatDate(event.startsAt) }), el('h2', { text: 'Tickets' }));
  const tiers = el('div', { className: 'tiers' });
  for (const tier of event.tiers || []) tiers.appendChild(tierRow(tier, openCheckout, onWaitlist));
  mount.append(tiers, checkoutPanel);
}
