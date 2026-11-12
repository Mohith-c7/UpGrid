# Waitlist API (marketing website)

`POST /api/v1/waitlist` public, no auth, JSON, rate limit 5 requests per hour per IP (429 `RATE_LIMITED`).
Body: `{ name, role: 'student'|'placement_officer'|'recruiter'|'other', college?, email, phone?, consent: true, website?: '', elapsedMs: number }`.
- Validators are the shared ones in `src/validation.ts` (name, email incl. "Did you mean gmail.com?", 10-digit Indian mobile). Unknown fields are rejected (400 with `fields`).
- Honeypot: non-empty `website`, or `elapsedMs` missing or under 2000, returns the normal 200 body and stores nothing.
- Success and duplicate email (gmail dots/+tag normalised) both return `200 {ok:true,message}`: idempotent, no account enumeration.
- Stored in `waitlist_signups` (migration `050_waitlist.sql`); the IP is stored only as a salted hash.

`GET /api/v1/waitlist/export` officer-only (Bearer token) CSV: `name,role,college,email,phone,signedUpAt` (IST), UTF-8 BOM, cells starting `= + - @` are prefixed with `'`. Scoped to the officer's tenant.

Mounted in `src/app.ts` BEFORE `meRouter` so the POST stays outside the authenticated area. CORS follows `CORS_ORIGINS` (set it to the website origin in production).
