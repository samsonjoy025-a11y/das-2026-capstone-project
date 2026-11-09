import { fileURLToPath } from 'node:url';

const portValue = process.env.PORT;
export const PORT = portValue === undefined || portValue === '' ? 3000 : Number(portValue);

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new RangeError('PORT must be an integer between 0 and 65535');
}

// Where the server keeps its SQLite file. data/ is in .gitignore.
const DEFAULT_DATABASE_PATH = fileURLToPath(new URL('../data/ticketing.db', import.meta.url));
export const DATABASE_PATH = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;

// Token signing secret (HS256). In production this MUST come from the environment.
// A dev/test fallback is provided so local runs and tests work without setup.
export const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-token-secret-change-me';
if (!process.env.TOKEN_SECRET) process.env.TOKEN_SECRET = TOKEN_SECRET;
export const TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

// Build 8: unpaid hold time and waitlist offer time (milliseconds).
export const BOOKING_HOLD_MS = 15 * 60 * 1000;
export const OFFER_HOLD_MS = 10 * 60 * 1000;

// Build 9: separate secret for ticket QR tokens (HMAC). No default in production.
const ticketSecretFromEnv = process.env.TICKET_SECRET;
if (process.env.NODE_ENV === 'production' && !ticketSecretFromEnv) {
  throw new Error('TICKET_SECRET must be set in production');
}
export const TICKET_SECRET = ticketSecretFromEnv || 'dev-ticket-secret-change-me';
