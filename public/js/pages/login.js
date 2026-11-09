import { login, signup } from '../api.js';
import { clear, el } from '../ui.js';
import { clearSession, getUser, setSession } from '../session.js';

function notice(kind, text) {
  return el('div', { className: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
}

function field(id, labelText, input) {
  return el('div', { className: 'field' }, [el('label', { htmlFor: id, text: labelText }), input]);
}

export async function initLogin() {
  const app = document.getElementById('app');
  if (!app) return;
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || 'index.html';
  const current = getUser();

  const status = el('div', { className: 'status', 'aria-live': 'polite' });

  const loginEmail = el('input', { id: 'login-email', name: 'email', type: 'email', autocomplete: 'email', required: true });
  const loginPassword = el('input', { id: 'login-password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '8' });
  const loginBtn = el('button', { type: 'submit', className: 'btn-primary', text: 'Log in' });
  const loginForm = el('form', { className: 'checkout-form panel' }, [
    el('h2', { text: 'Log in' }),
    field('login-email', 'Email', loginEmail),
    field('login-password', 'Password', loginPassword),
    el('div', { className: 'actions' }, [loginBtn]),
  ]);

  const suEmail = el('input', { id: 'su-email', name: 'email', type: 'email', autocomplete: 'email', required: true });
  const suPassword = el('input', { id: 'su-password', name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const suRole = el('select', { id: 'su-role', name: 'role' }, [
    el('option', { value: 'attendee', text: 'Attendee' }),
    el('option', { value: 'organizer', text: 'Organizer' }),
    el('option', { value: 'staff', text: 'Staff' }),
  ]);
  const suName = el('input', { id: 'su-name', name: 'name', type: 'text', autocomplete: 'name' });
  const suBtn = el('button', { type: 'submit', className: 'btn-primary', text: 'Sign up' });
  const signupForm = el('form', { className: 'checkout-form panel' }, [
    el('h2', { text: 'Sign up' }),
    field('su-name', 'Name (optional)', suName),
    field('su-email', 'Email', suEmail),
    field('su-password', 'Password (at least 8 characters)', suPassword),
    field('su-role', 'Role', suRole),
    el('div', { className: 'actions' }, [suBtn]),
  ]);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(status);
    loginBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Logging in…' }));
    try {
      const data = await login({ email: loginEmail.value, password: loginPassword.value });
      setSession(data);
      window.location.href = next;
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err?.body?.error?.message || err.message || 'Login failed.'));
      loginBtn.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(status);
    suBtn.disabled = true;
    status.appendChild(el('p', { className: 'muted', text: 'Creating account…' }));
    try {
      const data = await signup({ email: suEmail.value, password: suPassword.value, role: suRole.value, name: suName.value });
      setSession(data);
      window.location.href = next;
    } catch (err) {
      clear(status);
      status.appendChild(notice('error', err?.body?.error?.message || err.message || 'Signup failed.'));
      suBtn.disabled = false;
    }
  });

  clear(app);
  app.appendChild(el('h1', { text: 'Account' }));
  if (current) {
    const logoutBtn = el('button', { type: 'button', className: 'btn-secondary', text: 'Log out' });
    logoutBtn.addEventListener('click', () => { clearSession(); window.location.reload(); });
    app.appendChild(el('div', { className: 'panel' }, [
      el('p', { text: `Signed in as ${current.email} (${current.role}).` }),
      el('div', { className: 'actions' }, [logoutBtn, el('a', { href: 'index.html', text: 'Browse events' })]),
    ]));
  }
  app.append(status, loginForm, signupForm);
}
