import { acceptOffer, cancelBooking, getRefundQuote, getTicketToken, listMyBookings, listMyOffers } from '../api.js';
import { clear, el, formatPrice } from '../ui.js';
import { isLoggedIn } from '../session.js';
import { renderQR } from '../qr.js';

function notice(kind, text) {
  return el('div', { className: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
}

function offerCard(offer, onRefresh) {
  const box = el('article', { className: 'card' }, [
    el('h3', { text: `Seat offer` }),
    el('p', { className: 'meta', text: `Tier ${offer.tierId} · Qty ${offer.quantity}` }),
  ]);
  const status = el('div', { className: 'status', 'aria-live': 'polite' });
  const countdown = el('div', { className: 'countdown', 'aria-live': 'polite' });
  const acceptBtn = el('button', { type: 'button', className: 'btn-primary', text: 'Accept' });
  box.append(countdown, el('div', { className: 'actions' }, [acceptBtn]), status);

  function renderCountdown() {
    const remaining = new Date(offer.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      countdown.textContent = 'This offer has expired.';
      countdown.classList.add('expired');
      acceptBtn.disabled = true;
      return false;
    }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    countdown.textContent = `Offer expires in ${m}:${String(s).padStart(2, '0')}.`;
    return true;
  }
  renderCountdown();
  const timer = setInterval(() => { if (!renderCountdown()) clearInterval(timer); }, 1000);

  acceptBtn.addEventListener('click', async () => {
    clear(status); acceptBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Accepting offer…' }));
    try {
      const booking = await acceptOffer(offer.id);
      clearInterval(timer);
      clear(status);
      status.appendChild(notice('success', `Booking ${booking.reference} is pending. Pay from My tickets below.`));
      onRefresh();
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err.message || 'Could not accept offer'));
      acceptBtn.disabled = false;
    }
  });
  return box;
}

async function renderTicketQr(container, reference) {
  try {
    const { token } = await getTicketToken(reference);
    const wrap = el('div', { className: 'ticket-qr' });
    const qrBox = el('div', { className: 'qr-code', 'aria-label': `QR code for ticket ${reference}` });
    renderQR(qrBox, token, { size: 180, margin: 2 });
    wrap.append(
      el('p', { className: 'muted', text: 'Show this QR code at the door (staff check-in).' }),
      qrBox,
      el('details', {}, [
        el('summary', { text: 'Ticket code (paste for check-in)' }),
        el('pre', { className: 'ticket-code-text', text: token }),
      ]),
    );
    clear(container);
    container.appendChild(wrap);
  } catch (err) {
    clear(container);
    container.appendChild(el('p', { className: 'muted', text: `QR unavailable: ${err.message || 'error'}` }));
  }
}

function bookingCard(booking, onRefresh) {
  const statusLabel = { paid: 'Paid', pending: 'Pending', cancelled: 'Cancelled', refunded: 'Refunded', checked_in: 'Checked in' }[booking.status] || booking.status;
  const box = el('article', { className: 'card' }, [
    el('h3', { text: `Booking ${booking.reference}` }),
    el('p', { className: 'meta', text: `Tier ${booking.tierId} · Qty ${booking.quantity} · ${formatPrice(booking.amountCents)}` }),
    el('p', { className: 'meta', text: `Status: ${statusLabel}` }),
  ]);
  const status = el('div', { className: 'status', 'aria-live': 'polite' });

  if (booking.status === 'paid' || booking.status === 'checked_in') {
    const qrContainer = el('div', { className: 'qr-container' }, [el('p', { className: 'muted', text: 'Loading QR code…' })]);
    box.appendChild(qrContainer);
    renderTicketQr(qrContainer, booking.reference);
  }

  if (booking.status === 'pending' || booking.status === 'paid') {
    const btn = el('button', { type: 'button', className: 'btn-secondary', text: 'Cancel booking' });
    btn.addEventListener('click', async () => {
      clear(status);
      btn.disabled = true;
      try {
        if (booking.status === 'paid') {
          status.appendChild(el('p', { className: 'muted', text: 'Calculating refund…' }));
          const quote = await getRefundQuote(booking.reference);
          clear(status);
          const ok = window.confirm(`Cancel this booking? Refund: ${formatPrice(quote.refundAmountCents)} of ${formatPrice(quote.amountCents ?? booking.amountCents)}.`);
          if (!ok) { btn.disabled = false; return; }
        }
        status.appendChild(el('p', { className: 'muted', text: 'Cancelling…' }));
        await cancelBooking(booking.reference);
        clear(status);
        status.appendChild(notice('success', 'Booking cancelled.'));
        onRefresh();
      } catch (err) {
        clear(status);
        status.appendChild(notice('error', err.message || 'Could not cancel booking'));
        btn.disabled = false;
      }
    });
    box.append(el('div', { className: 'actions' }, [btn]), status);
  }
  return box;
}

export async function initTickets() {
  const app = document.getElementById('app');
  if (!app) return;
  if (!isLoggedIn()) {
    clear(app);
    app.append(
      el('h1', { text: 'My tickets' }),
      notice('error', 'You must be logged in to see your tickets.'),
      el('p', {}, [el('a', { href: '/login.html', text: 'Log in' })]),
    );
    return;
  }

  async function load() {
    clear(app);
    app.appendChild(el('h1', { text: 'My tickets' }));
    const loading = el('p', { className: 'muted', text: 'Loading…', 'aria-live': 'polite' });
    app.appendChild(loading);
    try {
      const [bookingData, offerData] = await Promise.all([listMyBookings(), listMyOffers()]);
      loading.remove();
      const offers = offerData.offers || [];
      const bookings = bookingData.bookings || [];
      if (offers.length) {
        app.appendChild(el('h2', { text: 'Waitlist offers' }));
        for (const o of offers) app.appendChild(offerCard(o, load));
      }
      app.appendChild(el('h2', { text: 'Bookings' }));
      if (!bookings.length) app.appendChild(el('p', { className: 'muted', text: 'No bookings yet.' }));
      for (const b of bookings) app.appendChild(bookingCard(b, load));
    } catch (err) {
      loading.remove();
      app.appendChild(notice('error', err.message || 'Could not load tickets'));
    }
  }

  load();
}
