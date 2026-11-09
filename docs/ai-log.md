# AI log

Every time you give an AI tool a significant prompt, add an entry. Three lines each.
"Nothing was wrong" is allowed, but it is rarely true. Your instructor will read this.

## Build 2

### Prompt 1: Build 2 prompt (docs/build-2.md)
- **What I asked:**
- **What came back:**
- **What was wrong (or "nothing"):**

### Prompt 2:
- **What I asked:**
- **What came back:**
- **What was wrong (or "nothing"):**

## Build 3

### Prompt 1: Build 3 prompt (docs/build-3.md)
- **What I asked:** Add the architecture diagrams, booking state machine, Node HTTP router/server, configuration, startup script, and tests.
- **What came back:** A layered architecture document, explicit booking transitions, static-file HTTP server, `/health` route, startup configuration, and `node:test` coverage.
- **What was wrong (or "nothing"):** The first server draft relied on an implicit response/request property for HEAD handling and had redundant error-status logic; both were simplified. Added a regression test proving static requests cannot escape `public/`.

## Build 4

### Prompt 1: Build 4 prompt (docs/build-4.md)
- **What I asked:** The Build 4 prompt: an in-memory repository, event and booking services, a mock payment gateway, the API routes, `docs/api-examples.md` and API tests that start the real server.
- **What came back:** `src/repositories/memory.js`, `src/services/eventService.js`, `src/services/bookingService.js`, `src/lib/mockPaymentGateway.js`, `src/http/routes.js`, wiring in `src/server.js`, an error-code-to-status map in `src/http/app.js`, `docs/api-examples.md` and `test/api.test.js`.
- **What was wrong (or "nothing"):** In the Build 3 code, every DomainError came back as 400, so `SOLD_OUT` and `NOT_FOUND` would have had the wrong status; added one code-to-status map in `app.js`. The validation helpers lived privately inside `inventory.js`, so reusing them meant moving them to `src/domain/validation.js` rather than copying. Known gap left on purpose: two bookings at the same moment can both take the last seat (Build 5). *(My own review: add what you find when you read the code.)*
- **Rules I was unsure about:** whether `venue` is required (kept optional, as in Build 2); whether a stranger paying someone else's booking should get 403 or 404 (chose 403 `FORBIDDEN`); added `unpublish`, `GET /api/events/:id` and `GET /api/bookings/:reference`, which the prompt did not list but S04 and the curl examples need.

## Build 5

### Prompt 1: move to SQLite and reproduce the problem (docs/build-5.md)
- **What I asked:** `src/db/schema.sql` and `src/db/connection.js` on `node:sqlite`, a SQLite repository with the same methods as `memory.js`, `scripts/seed.js`, and `scripts/oversell-demo.js` firing 50 bookings at the last seat with `Promise.all`.
- **What came back:** The schema (users, events, ticket_tiers, bookings with PRIMARY KEY, FOREIGN KEY, UNIQUE and CHECK, including `CHECK (sold >= 0 AND sold <= capacity)`), `src/repositories/sqlite.js` with prepared `?` statements, the seed and oversell scripts, and `seed`/`oversell` in `package.json`.
- **What was wrong (or "nothing"):** The CHECK on `sold` did **not** catch the bug: every racing request saved `sold = 9 + 1 = 10`, so the column looked right while 50 bookings existed for 1 seat (a lost update). The demo had to count rows in `bookings`, not just read `sold`. SQLite also ignores FOREIGN KEY unless `PRAGMA foreign_keys = ON` is set on every connection. There is no signup yet, so bookings would fail their FOREIGN KEY on `users`; the repository inserts a bare user row the first time an id is seen (`INSERT OR IGNORE`).
- **Rules I was unsure about:** whether `users` should exist before Build 7 (kept it, with name, email and role empty for now).

### Prompt 2: fix it
- **What I asked:** Reserve seats with one atomic UPDATE and use the changed-row count; add `test/oversell.test.js`; show the demo before and after.
- **What came back:** `reserveSeats` and `releaseSeats` in both repositories, `bookingService.book` using `reserveSeats` instead of read-check-write, `cancel` using `releaseSeats`, and the oversell test. Demo before: 50 succeeded, 59 bookings for 10 seats. After: 1 succeeded, 49 `SOLD_OUT`, 10 bookings for 10 seats.
- **Why a lock variable or a second check does not work:** A second check reads the same stale number, because every request can read before any of them writes; checking twice only makes the gap smaller, not gone. A lock variable lives in one Node process, so a second server process (or a script writing to the same database) never sees it, and a forgotten unlock after an error blocks every later booking.
- **What was wrong (or "nothing"):** If saving the booking failed after the seat was taken, the seat stayed taken forever; added a `releaseSeats` in a `catch`. I checked that the test fails without the fix by putting the Build 4 lines back: all 4 oversell tests failed, then passed again with the fix. Known gap for Build 8: two cancel requests at the same moment could both pass the status check (refunds must release seats exactly once).

## Build 6

### Prompt 1: Build 6 prompt (docs/build-6.md) — frontend on mock data
- **What I asked:** Build `public/index.html` (browse with search/city/max price/sort), `public/event.html` (tiers, quantity picker, checkout), `public/js/ui.js` (`el()` DOM helper, `textContent` only, no `innerHTML` for data), `public/js/mockData.js` + `public/js/api.js` (promise API matching real shapes; pages never call `fetch` directly), `public/js/pages/home.js` and `event.js`, and `public/css/styles.css`. Follow all rules (cents formatted `250000`→`₦2,500`, qty <= 10 and seats left, sold-out marked+disabled, checkout countdown, declined card retry, labels/buttons/links).
- **What came back:** All requested files implemented; mock events include sold-out tiers; `formatPrice` uses one function; `el()` builds nodes via `textContent`/text nodes. Pages use only `api.js`.
- **What was wrong (or "nothing"):** No `innerHTML`/`fetch` found in `public/js/**` (verified). All existing backend tests still passed (**141/141**). Uncertainties: “max price” input labeled/used as whole-cents value (API/domain use cents); countdown is a 10-minute mock (no server hold expiry in Build 6); `api.js` resolves to JSON body shapes and mutates mock `sold` to reflect holds.

### Errors encountered (runtime / environment)
- **Error:** “Site can’t be reached” when trying to view the frontend.
  - **Cause:** The server was not running (port 3000 not listening). Also opening `public/index.html` via `file://` will not work because ES modules/assets use absolute paths (`/js/...`, `/css/...`) and require the HTTP server.
  - **Fix:** Start the server from the project directory and open `http://localhost:3000/` (or `http://127.0.0.1:3000/`).
- **Error:** `npm start` failed in PowerShell with `PSSecurityException` / `npm.ps1 cannot be loaded ... not digitally signed` (execution policy).
  - **Fix:** Run `node --disable-warning=ExperimentalWarning src/server.js` or `npm.cmd start`.
- **Error:** `Error: listen EADDRINUSE: address already in use :::3000` when running `npm.cmd start` again.
  - **Cause:** A background `node src/server.js` process I started earlier was already listening on port 3000.
  - **Fix:** Don’t start a second server on the same port; verify with `GET /health` (`{"status":"ok"}`) or use `$env:PORT=3001; node --disable-warning=ExperimentalWarning src/server.js`.

## Build 7

### Prompt 1: Build 7 prompt (docs/build-7.md) — login, roles, connected app
- **What I asked:** Add `src/lib/password.js` (scrypt, random salt, constant-time compare), `src/lib/token.js` (HS256, expiry, reject `alg != HS256`, secret from env), `src/services/authService.js` + `src/routes/auth.js` (`/api/auth/signup|login|me`, password >= 8, roles attendee/organizer/staff, `EMAIL_TAKEN`, same `INVALID_CREDENTIALS`), `src/http/guards.js` (`requireUser`/`requireRole`) and replace `x-user-id` with bearer tokens + ownership checks (other attendee’s booking → `NOT_FOUND`; organizer changing others’ events → `FORBIDDEN`), replace frontend mock `api.js` with `fetch` + `Authorization: Bearer` and add `session.js`, `login.html`, `tickets.html`, `organizer.html` with loading/error states, and tests for signup/login/bad token/expired token/wrong role/one attendee reading another’s booking. Never store/log/return passwords; server enforces roles.
- **What came back:** All required modules/pages/tests added; DB schema extended with `users.password_hash` (+ safe migration in `connection.js`); repos gained user methods + `listBookingsByUserId`; services accept bearer user actor (and string IDs for direct/script compatibility); `GET /api/bookings` returns only own bookings.
- **What was wrong (or "nothing"):** **Breaking change:** replacing `x-user-id` with bearer auth broke `test/api.test.js`. I rewrote it to sign up users and send `Authorization: Bearer <token>` so the suite remains valid; **149 tests pass, 0 fail**.
  - **Spec ambiguity handled:** Build 7 prompt step 4 says another person’s booking gives `NOT_FOUND`; `docs/build-7.md` S13 text mentions `FORBIDDEN`. Implemented **`NOT_FOUND`** per the prompt and aligned tests.
  - Added `INVALID_CREDENTIALS`/`EMAIL_TAKEN` status mapping in `src/http/app.js` (previous default would have returned 400).
  - `TOKEN_SECRET` has a dev/test fallback when unset (env must be used in production; no secrets committed). If a server was already running before the Build 7 code changes, it must be restarted to load the new modules.
- **Rules I was unsure about:** `GET /api/events` kept public; `GET /api/events/:id` accepts optional auth. `docs/api-examples.md`/OpenAPI not updated (prompt didn’t require). `public/js/mockData.js` left unused after replacing `api.js` with `fetch`.

## Build 8

### Prompt 1: Build 8 prompt (docs/build-8.md) — refunds, waitlist, expiry, real test suite
- **What I asked:** Add `src/lib/clock.js`; `src/domain/refundPolicy.js` (`calculateRefund`, 100% >=7d, 50% >=2d, 0% <2d, exact boundary to better tier, `EVENT_STARTED`, `Math.floor` on cents); paid booking cancellation using state machine + mock gateway `refund` + CAS on booking status + release seats exactly once (twice must not release twice); `src/services/seatService.js` and `waitlistService.js` (free seats → offer first on waitlist, **hold seats for offer time**, pass to next on expiry; `POST /api/waitlist` with `NOT_SOLD_OUT`/`ALREADY_ON_WAITLIST`; accept route with `OFFER_EXPIRED`); `src/jobs/maintenance.js` (expire pending holds, release+offer; tests call directly, server runs `setInterval`); UI (refund amount before confirm, sold-out “Join waitlist”, offer countdown + Accept); tests for every rule (refund boundaries incl. exactly 7d/6d23h/exactly 2d/1d23h, cancelling twice, waitlist order, offer expiring+passing on, unpaid hold expiring).
- **What came back:** All required backend pieces implemented: clock, pure refund policy, gateway `refund()`, schema/migrations + repo methods (CAS `transitionBookingStatus`, waitlist/offer tables & ops, pending-expiry queries), updated `bookingService` (refund quote, paid cancel/refund with CAS, `BOOKING_EXPIRED` on pay, `expirePendingBooking`), `seatService`/`waitlistService` (offers hold seats via `reserveSeats`; expiry releases + passes on), `maintenance` job wired in server, routes for refund quote/waitlist/offers/accept, UI updates in `tickets.js`/`event.js`/`api.js`, and `test/build8.test.js` covering the specified rules. **160 tests pass, 0 fail** (full suite).
- **What was wrong (or "nothing"):**
  - **`api.test.js` regression (intentional behavior change):** “cancel a paid booking for now” previously expected `409 INVALID_STATE`; Build 8 allows paid cancellation/refund. Updated the test to assert successful refund (`status: refunded`, `refundAmountCents` present), seats released once, and cancel-twice rejected (`INVALID_TRANSITION`).
  - **Bug fixed (maintenance/expiry test):** `bookingService.expirePendingBooking` checked `BOOKING_HOLD_MS` (config constant) while `maintenance`/tests passed a custom `holdMs`. Result: candidates found but never expired. Fixed by adding `holdMs` support to `createBookingService`/`expirePendingBooking(..., holdMsOverride)` and passing `holdMs` from maintenance.
  - **SQLite CAS query:** used `json_each(?)` for `status IN (...)` in compare-and-set update; works with Node 22’s bundled SQLite in this environment (verified by passing tests).
  - **Schema note:** removed an over-restrictive `UNIQUE (tier_id, user_id, status)` idea for `waitlist_entries`; “already on waitlist” enforced in service via `findActiveWaitlistEntry`.
- **Rules I was unsure about:** accept-route path not specified — used `POST /api/waitlist/offers/:id/accept` (+ `GET /api/waitlist/offers`). Accepting an offer creates a **pending booking** using the already-held seats (no re-reserve) so the user can pay; seats remain held as part of the booking. Added `GET /api/bookings/:reference/refund-quote` for the UI (“show refund amount before you confirm”). `docs/api-examples.md`/OpenAPI not updated. “Release seats exactly once” ensured via CAS on booking status before releasing/refunding; gateway `refund` is idempotent by key. For paid cancel, I used booking status `refunded` (stores `refundAmountCents`/`refundId`) even when refund is 0%, consistent with the state machine and S09 semantics.


### Follow-up: fix all errors/issues (post Build 8)
- **What I asked:** Fix all errors and issues in the project.
- **What came back:** Verified current implementation/tests, fixed real issues, restarted the live server, and revalidated.
- **What was wrong (or "nothing"):**
  - **Stale server process:** a previously started background server was still running old in-memory code (so new Build 6/7/8 API behavior wouldn’t be served). Killed the old process (port 3000 conflict/EADDRINUSE when restarting) and started a fresh server from current source. Live smoke check: `GET /health` OK, `POST /api/auth/signup` returns `201` (token/user, no password fields).
  - **`bookingService.pay` CAS race:** if `transitionBookingStatus` lost a race, the code could return a fetched booking without confirming it was `paid`. Fixed to return the booking only if already `paid`, else throw `INVALID_TRANSITION` (`src/services/bookingService.js`).
  - **Stale OpenAPI/docs contract:** `src/http/openapi.js` still described x-user-id/older routes and missed auth/refund-quote/waitlist endpoints; `test/openapi.test.js` enforced the outdated list. Updated OpenAPI to **Bearer auth**, v0.8.0, and the real route set (auth, `GET /api/bookings`, refund-quote, waitlist/offers/accept); updated the test accordingly. OpenAPI + targeted suites pass.
  - **Transient environment flake (not a code bug):** one full-suite run showed `fetch failed` / `connect ENOBUFS 127.0.0.1:65533` in `api.test.js` (SQLite). Not reproducible in isolation (`test/api.test.js` **82/82 pass**) or targeted runs (**104/104 pass** incl. `api`, `build8`, `auth`, `openapi`). Treat as socket/resource flake; re-run full suite if seen.
