import { checkInTicket } from '../api.js';
import { clear, el } from '../ui.js';
import { getUser, isLoggedIn } from '../session.js';

function notice(kind, text) {
  return el('div', { className: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
}

export function initCheckin() {
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);

  if (!isLoggedIn()) {
    app.append(
      el('h1', { text: 'Staff check-in' }),
      notice('error', 'You must be logged in as staff to check in tickets.'),
      el('p', {}, [el('a', { href: '/login.html', text: 'Log in' })]),
    );
    return;
  }

  const user = getUser();
  if (user?.role !== 'staff') {
    app.append(
      el('h1', { text: 'Staff check-in' }),
      notice('error', 'Only staff can check in tickets.'),
    );
    return;
  }

  const status = el('div', { className: 'status', 'aria-live': 'polite' });
  const tokenInput = el('textarea', {
    id: 'ticket-code', rows: 4, className: 'ticket-code-input',
    placeholder: 'Paste or scan the ticket code here',
    'aria-label': 'Ticket code',
  });
  const submit = el('button', { type: 'submit', className: 'btn-primary', text: 'Check in' });
  const form = el('form', { className: 'form-card' }, [
    el('h1', { text: 'Staff check-in' }),
    el('p', { className: 'muted', text: 'Paste the ticket QR code value to admit a guest.' }),
    el('label', { for: 'ticket-code', text: 'Ticket code' }),
    tokenInput,
    el('div', { className: 'actions' }, [submit]),
    status,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(status);
    const token = tokenInput.value.trim();
    if (!token) { status.appendChild(notice('error', 'Paste a ticket code first.')); return; }
    submit.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Checking ticket…' }));
    try {
      const result = await checkInTicket({ token });
      clear(status);
      status.appendChild(notice('success', `Admitted. Reference ${result.reference} checked in at ${result.checkedInAt}.`));
      tokenInput.value = '';
      tokenInput.focus();
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err.message || 'Check-in failed.'));
    } finally {
      submit.disabled = false;
    }
  });

  app.appendChild(form);
}
