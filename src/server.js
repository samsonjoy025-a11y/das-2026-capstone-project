import { pathToFileURL } from 'node:url';
import './config.js';
import { createAppServer } from './http/app.js';
import { Router } from './http/router.js';
import { registerApiRoutes } from './http/routes.js';
import { registerAuthRoutes } from './routes/auth.js';
import { runMaintenance } from './jobs/maintenance.js';
import { createMockPaymentGateway } from './lib/mockPaymentGateway.js';
import { systemClock } from './lib/clock.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { createSqliteRepository } from './repositories/sqlite.js';
import { createAuthService } from './services/authService.js';
import { createBookingService } from './services/bookingService.js';
import { createCheckinService } from './services/checkinService.js';
import { createEventService } from './services/eventService.js';
import { createSeatService } from './services/seatService.js';
import { createWaitlistService } from './services/waitlistService.js';
import { DATABASE_PATH, PORT } from './config.js';

export function createTicketingServer({
  repository = createSqliteRepository(),
  paymentGateway = createMockPaymentGateway(),
  clock = systemClock,
  loginLimiter = createRateLimiter({ windowMs: 60_000, max: 20 }),
  checkinLimiter = createRateLimiter({ windowMs: 60_000, max: 60 }),
} = {}) {
  const eventService = createEventService({ repository });
  const seatService = createSeatService({ repository, clock });
  const bookingService = createBookingService({ repository, paymentGateway, clock, seatService });
  const waitlistService = createWaitlistService({ repository, clock, seatService });
  const authService = createAuthService({ repository });
  const checkinService = createCheckinService({ repository, clock });
  const router = new Router();
  registerAuthRoutes(router, { authService, loginLimiter });
  registerApiRoutes(router, { eventService, bookingService, waitlistService, checkinService, checkinLimiter, seatService, clock, repository });
  const server = createAppServer({ router });
  server._services = { repository, bookingService, seatService, clock, paymentGateway, checkinService };
  return server;
}

export function startServer(port = PORT, databasePath = DATABASE_PATH) {
  const repository = createSqliteRepository({ path: databasePath });
  const server = createTicketingServer({ repository });
  server.on('close', () => repository.close());
  const { bookingService, seatService, clock } = server._services;
  const interval = setInterval(() => {
    runMaintenance({ repository, bookingService, seatService, clock }).catch(() => {});
  }, 60_000);
  server.on('close', () => clearInterval(interval));
  server.listen(port, () => {
    console.log(`Event ticketing server listening on port ${port}`);
    console.log(`Data is stored in ${databasePath}`);
  });

  const shutDown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
