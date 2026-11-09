import { DomainError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/token.js';
import { TOKEN_EXPIRES_IN_SECONDS } from '../config.js';

const ROLES = new Set(['attendee', 'organizer', 'staff']);

function requireObject(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('VALIDATION', 'Request body must be a JSON object');
  }
  return input;
}

function normalizeEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    throw new DomainError('VALIDATION', 'email is required');
  }
  return email.trim().toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new DomainError('VALIDATION', 'Password must be at least 8 characters');
  }
  return password;
}

function validateRole(role) {
  if (typeof role !== 'string' || !ROLES.has(role)) {
    throw new DomainError('VALIDATION', 'role must be attendee, organizer, or staff');
  }
  return role;
}

function publicUser(user) {
  const { passwordHash, ...safe } = user || {};
  return safe;
}

function tokenFor(user) {
  return signToken(
    { sub: user.id, role: user.role, email: user.email },
    { expiresInSeconds: TOKEN_EXPIRES_IN_SECONDS },
  );
}

export function createAuthService({ repository }) {
  return {
    async signup(input) {
      const { email, password, role, name } = requireObject(input);
      const normalizedEmail = normalizeEmail(email);
      validatePassword(password);
      const validatedRole = validateRole(role);

      const existing = await repository.findUserByEmail(normalizedEmail);
      if (existing) throw new DomainError('EMAIL_TAKEN', 'That email is already registered');

      const user = {
        id: newId(),
        name: typeof name === 'string' && name.trim() ? name.trim() : null,
        email: normalizedEmail,
        role: validatedRole,
        passwordHash: hashPassword(password),
      };
      const saved = await repository.insertUser(user);
      return { user: publicUser(saved), token: tokenFor(saved) };
    },

    async login(input) {
      const { email, password } = requireObject(input);
      const normalizedEmail = normalizeEmail(email);
      // The wrong password and an unknown email give the same INVALID_CREDENTIALS error.
      const invalid = () => {
        throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
      };
      const user = await repository.findUserByEmail(normalizedEmail);
      if (!user || !user.passwordHash) invalid();
      if (!verifyPassword(typeof password === 'string' ? password : '', user.passwordHash)) invalid();
      return { user: publicUser(user), token: tokenFor(user) };
    },

    async me(authUser) {
      const id = authUser?.sub || authUser?.id;
      if (!id) throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
      const user = await repository.findUserById(id);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
      return { user: publicUser(user) };
    },
  };
}
