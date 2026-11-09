import { requireUser } from '../http/guards.js';
import { clientIp } from '../lib/rateLimit.js';

export function registerAuthRoutes(router, { authService, loginLimiter } = {}) {
  router.post('/api/auth/signup', async ({ body }) => ({
    status: 201,
    body: await authService.signup(body),
  }));

  router.post('/api/auth/login', async ({ request, body }) => {
    if (loginLimiter) loginLimiter.check(`login:${clientIp(request)}`);
    return {
      status: 200,
      body: await authService.login(body),
    };
  });

  router.get('/api/auth/me', async ({ request }) => ({
    status: 200,
    body: await authService.me(requireUser(request)),
  }));

  return router;
}
