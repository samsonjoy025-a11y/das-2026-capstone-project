# Security checklist (Build 9)

Short checklist of what we protect and how. No real secret values appear in Git.

## Secrets and configuration
- [x] **Login tokens (JWT)** signed with `TOKEN_SECRET` from the environment (HS256; `alg` enforced). Dev fallback exists only outside production.
- [x] **Ticket/QR tokens** signed with a **different** secret, `TICKET_SECRET` (HMAC-SHA256). No default value in production code; required via env in production.
- [x] `.env.example` documents required secrets; real `.env` files are gitignored. No secrets committed.

## Authentication and authorization
- [x] Passwords hashed (scrypt, random salt, constant-time compare); never stored, logged, or returned.
- [x] Bearer auth required on protected routes; invalid/expired tokens rejected.
- [x] Role checks on the server (e.g., organizer actions, staff-only `POST /api/checkin`; wrong role → `FORBIDDEN`).
- [x] Attendees can only access their own bookings (another attendee’s booking → `NOT_FOUND`).

## Check-in and tickets (S14/S15)
- [x] QR payload is a **signed ticket token** containing only the **booking reference** and **issued-at time** — no name, no email, no other personal data.
- [x] Forged/edited/made-up codes rejected as invalid (signature verified in constant time).
- [x] Cancelled/refunded bookings rejected at check-in.
- [x] Duplicate scans rejected and report when the ticket was first used.
- [x] Admission is a **single atomic database UPDATE** (`WHERE reference=? AND status='paid'`), not read-then-write, so two simultaneous scans admit exactly one.

## HTTP and browser protections
- [x] Security headers on responses: `Content-Security-Policy` (**no inline scripts**; scripts from `'self'` + required CDN for docs), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- [x] Rate limiting applied to **login** and **check-in** attempts (per IP).

## Input and data safety
- [x] JSON body parsing and validation; stable error codes (no internal leaks).
- [x] SQL uses parameterized placeholders (`?`), never string-built queries.
- [x] Money handled as whole cents (integers).

## CI
- [x] GitHub Actions runs `npm test` on Node 22 for every push and pull request (`.github/workflows/ci.yml`).
