import { DomainError } from '../domain/errors.js';
import { verifyToken } from '../lib/token.js';

function parseBearer(request) {
  const header = request.headers['authorization'] || request.headers['Authorization'];
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requireUser(request) {
  const token = parseBearer(request);
  if (!token) throw new DomainError('UNAUTHENTICATED', 'Missing or invalid token');
  return verifyToken(token);
}

export function optionalUser(request) {
  const token = parseBearer(request);
  if (!token) return undefined;
  return verifyToken(token);
}

export function requireRole(request, ...roles) {
  const user = requireUser(request);
  if (!roles.includes(user.role)) {
    throw new DomainError('FORBIDDEN', 'You do not have permission to do that');
  }
  return user;
}
