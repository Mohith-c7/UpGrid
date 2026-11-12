# Placement OS API

Express + TypeScript + PostgreSQL API for a campus placement app (student, officer and recruiter roles, single-university MVP, every table tenant-scoped).

## Modules

| Module | Code | Migrations | Contract |
|---|---|---|---|
| Core (auth, profile, drives, applications, schedules, tickets, notifications) | `src/routes/{auth,profile,drives,applications,schedule,tickets,notifications,officer}.ts` | `001`, `002` | this README |
| Auth extras / integrations (email codes, Google, Turnstile, R2 files) | `src/routes/{authExtra,files}.ts`, `src/integrations`, `src/mail`, `src/storage.ts` | `003`, `004` | `docs/integrations-api.md`, `INTEGRATIONS.md` |
| Assessments (question bank, tests, attempts, code judging, practice) | `src/assessments`, `src/routes/assessments*.ts` | `010`-`013` | `docs/assessments-api.md` |
| Pipeline and recruiter (rounds, scorecards, slots, outcomes, offers, recruiter invites) | `src/pipeline`, `src/routes/{pipeline*,recruiter*}.ts` | `020`-`024` | `docs/pipeline-api.md` |
| AI (resume/JD tools, chat, mock interviews, recruiter assist, MCQ drafts) | `src/ai`, `src/routes/ai*.ts` | `030`-`033` | `docs/ai-api.md` |
| Operations (analytics, policy, restrictions, cohorts, announcements v2, calendar, CRM, audit, documents) | `src/policy`, `src/analytics`, `src/ops`, `src/routes/{ops*,policy*,analytics}.ts` | `040`-`044` | `docs/ops-api.md` |
| Waitlist (marketing site) | `src/routes/waitlist.ts` | `050` | `docs/waitlist-api.md` |

Cross-module wiring lives in ONE file, `src/hooks.ts` (called by `createApp`): AI file store (R2 resumes), assessments cohort resolver (ops cohorts), AI MCQ import adapter (assessments bank), recruiter file-access rule and resume signer (files), pipeline invite mailer (mail). Question sets are attached to scorecards by `questionSetId` on `PUT /pipeline/drives/:id/candidates/:applicationId/scorecards/:roundId`. Offers read the active ops policy from `tenant_settings.policy` (`src/pipeline/policy.ts` translates it). `src/app.ts` mount order matters: public routers first, per-route-guarded module routers before `officerRouter`, prefix-guarded modules after; `test/integration-hooks.test.ts` checks every role against every module.

## Run locally

```bash
cp .env.example .env            # set DATABASE_URL, JWT_SECRET, OFFICER_INVITE_CODE
npm install
npm run migrate                 # plain SQL files in migrations/, idempotent (also runs on server start)
npm run seed                    # WIPES data, loads demo tenant data (refuses in production unless SEED_FORCE=1)
npm run dev                     # http://localhost:4000/api/v1 (tsx watch; runs migrations and every in-process worker)
npm test                        # vitest, whole suite; needs a Postgres reachable via TEST_DATABASE_URL
npx tsc --noEmit                # type check (npm run typecheck)
npm run build && npm start      # production build in dist/ (then: npm run migrate:prod / npm run seed:prod)
```

Nothing but `DATABASE_URL`, `JWT_SECRET` and `OFFICER_INVITE_CODE` is needed to boot. Email, Google sign-in, Turnstile, R2 uploads, Judge0 (coding tests) and Gemini (AI) each switch on with their own variables (`.env.example`, `INTEGRATIONS.md`); without them `GET /api/v1/config` reports the matching `features.*` flag as `false` and those endpoints answer a clean 503.

Quick check after start: `curl localhost:4000/health`, `curl localhost:4000/api/v1/config`, then log in with a seed account below.

Scripts: `build` (tsc to `dist/`), `start` (`node dist/index.js`), `dev`, `migrate` / `migrate:prod`, `seed` / `seed:prod`, `typecheck`, `test`.

Tests use `TEST_DATABASE_URL` (default `postgres://app@localhost:5433/placement_test`) and TRUNCATE tables: point it at a throwaway database only.

Seed logins (all fictional): `officer@placement.demo` / `Officer@123`; recruiter `recruiter@placement.demo` / `Recruiter@123` (assigned to the Kestrel Systems drive); students `aarav.sharma@students.demo` (complete profile, eligible for most drives, already applied to Kestrel), `diya.patel@students.demo` (partial profile, eligibility pending), `rohan.mehta@students.demo` (ineligible) all with `Student@123`. 8 fictional companies: open, closing in about 40 minutes, closed and draft drives.

## Deploy (Render, Singapore)

`render.yaml` is a Blueprint (no Docker): a web service plus a Postgres database. Set `OFFICER_INVITE_CODE` in the dashboard; `JWT_SECRET` is generated. Optional integrations (email, Google sign-in, Turnstile, Cloudflare R2, Judge0, Gemini) are all declared in `render.yaml` as `sync: false` variables: paste the keys when you have them (step-by-step in [INTEGRATIONS.md](INTEGRATIONS.md)); without them each feature switches itself off. Build: `npm ci --include=dev && npm run build`; pre-deploy: `npm run migrate:prod`; start: `npm start` (the server also runs pending migrations at boot, under an advisory lock). Health check: `GET /health`. Never run the seed in production.

All background work runs inside the web process (no separate worker or cron service is needed): reminders and announcements (`SCHEDULER_INTERVAL_MS`, default 30 s), pipeline slot / offer-expiry jobs, and the assessments workers (auto-submit, reminders, code-judge queue). The workers claim rows with `FOR UPDATE SKIP LOCKED` or are idempotent, so several web instances are safe and one is enough. To move them out of the web process later, set `DISABLE_SCHEDULER=1` on the web service and add a Render background worker that starts the workers (there is no separate worker entry point yet).

## Conventions

- Base path `/api/v1`, JSON, `Authorization: Bearer <access JWT>` (15 min). Refresh tokens are random, stored SHA-256 hashed, rotated on every use; reusing a rotated token revokes all of that user's sessions.
- Errors: `{ "error": { "code", "message", "fields"? } }` with 400 / 401 / 403 / 404 / 409 / 422 / 429. Stack traces and SQL errors are never returned.
- Dates are ISO-8601 UTC. Pagination: `?cursor=&limit=` (1-50, default 20) returning `{ items, nextCursor }`; the cursor is an opaque offset token.
- Rate limits: 300 req/min/IP globally, 10 req/min/IP on `/auth/*`; email codes are additionally limited to 5/hour per email and 20/hour per IP.
- Validation lives in `src/validation.ts` (exported pure functions and zod schemas), mirrored in the app.

## Endpoints

Public: `GET /health`, `GET /api/v1/health`, `GET /api/v1/time`, `GET /api/v1/config` (feature flags, public client ids, upload limits)

Integrations (migrations `003_auth_email_google.sql`, `004_files.sql`; full shapes in [docs/integrations-api.md](docs/integrations-api.md), setup in [INTEGRATIONS.md](INTEGRATIONS.md)):
- Email verification: `POST /auth/email/send-verification`, `POST /auth/email/verify` (auth); password reset: `POST /auth/forgot-password`, `POST /auth/reset-password` (public)
- Google sign-in: `POST /auth/google`
- Cloudflare Turnstile: `turnstileToken` (body or `X-Turnstile-Token`) on register, login, forgot-password, google
- File uploads (Cloudflare R2, presigned URLs): `POST /files/presign`, `POST /files/:id/confirm`, `GET /files/:id/url`, `DELETE /files/:id`, `GET /applications/:id/resume-url` (officer); `POST /profile/resumes` takes `{label, fileId}` or `{label, url}`; `PUT /drives/:id` takes `company.logoFileId`
- Email notifications (schedules, offer responses, ticket replies) with a per-user switch: `email` in `GET|PUT /reminder-settings`

Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `POST /me/change-password` (returns fresh tokens), `DELETE /me` (soft delete)

Student profile: `GET /profile`, `PUT /profile`, `GET|POST /profile/resumes`, `DELETE /profile/resumes/:id`, `POST /profile/resumes/:id/default`

Drives (any role, tenant-scoped): `GET /drives`, `GET /drives/:id`, `PUT|DELETE /drives/:id/save` (student)
Drives (officer): `POST /drives`, `PUT /drives/:id`, `POST /drives/:id/publish`, `POST /drives/:id/close`, `POST /drives/:id/duplicate`, `GET /drives/:id/eligible-count`, `GET /drives/:id/applicants?status=`

Applying (student): `POST /drives/:id/application/preview`, `POST /drives/:id/apply`, `GET /applications`, `GET /applications/:id` (officers can read too), `POST /applications/:id/withdraw`
Applications (officer): `POST /applications/:id/status`

Officer: `GET /students`, `GET /students/:id`, `POST /students/:id/verify`, `GET /officer/dashboard`, `POST /announcements`
Announcements: `GET /announcements` (officer: all; student: those delivered to them)

Notifications: `GET /notifications`, `POST /notifications/read`, `GET /notifications/unread-count`, `GET|PUT /reminder-settings`, `POST /reminder-settings/reset`, `POST|DELETE /devices`

Placement-cell features (migration `002_features.sql`):
Scheduling (officer): `POST /applications/:id/schedule`, `POST /drives/:id/schedule-bulk`; `GET /applications/:id` now carries `schedule`
Export / import (officer): `GET /drives/:id/applicants/export` (CSV), `POST /students/import`
Support tickets: `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `POST /tickets/:id/messages`, `POST /tickets/:id/status`
Legal: `GET /legal/versions` (public); `POST /auth/register` requires `acceptTerms: true`

### Behaviour worth knowing

- **Scheduling** (`POST /applications/:id/schedule`, officer): body `{type:'assessment'|'interview', scheduledAt, mode:'online'|'in_person', venueOrLink, instructions?}`. `scheduledAt` is an ISO-8601 instant with `Z` or an offset, strictly in the future and at most 365 days ahead. Online needs an https link (max 300); in person takes 3-200 plain characters; instructions up to 500. Unknown fields are rejected; errors come back together in `fields`. The status moves to `assessment`/`interview` when the transition is allowed (same status = reschedule, no transition needed); otherwise 422 `INVALID_TRANSITION` and nothing is written (a `submitted` application may be scheduled directly; screening is optional). Response `{application:{id,status}, schedule, rescheduled}`. Each call appends an event, supersedes the previous schedule (only the latest is live), creates an in-app `schedule` notification with the time in IST and sends push after commit (respecting the student's push setting and quiet hours). `POST /drives/:id/schedule-bulk` takes `applicationIds` (1-200, de-duplicated) plus the same fields, one transaction per application, and returns `{scheduled, failed:[{applicationId, reason}]}`. `GET /applications/:id` returns `schedule` (latest or null) inside `application` and mirrored at the top level.
- **Schedule reminders**: a `sched60` row in `scheduled_reminders` fires 60 minutes before `scheduledAt` through the same worker (`schedule_reminder` notification + push). One row per application: rescheduling overwrites it, a time less than 60 minutes away cancels it, and the worker cancels it at send time if the schedule was superseded, the application left assessment/interview, or the start has passed. Drive close and deadline edits only touch `t60/t30/t15` rows.
- **Applicant export** (`GET /drives/:id/applicants/export?status=`): `text/csv; charset=utf-8`, UTF-8 BOM, CRLF, attachment. Columns `reference,name,email,phoneDisplay,registrationNumber,department,batchYear,cgpa,activeBacklogs,status,appliedAt,resumeUrl`; `appliedAt` is `YYYY-MM-DD HH:mm:ss IST`. Values come from the snapshot taken at apply time. Cells starting with `= + - @` (or tab / CR) get a leading `'`, so `phoneDisplay` (`+91 ...`) is exported as `'+91 ...`.
- **Student import** (`POST /students/import`, officer): `{rows:[...]}` 1-500 rows (the route accepts a 1 MB body). Match by `registrationNumber`, falling back to `email`; an email match fills in a missing registration number but is refused if the student already has a different one. Each row is validated with the shared validators (blank = not provided, unknown fields invalid, duplicate registration numbers in one batch invalid), then written in its own transaction; every supplied academic field becomes `verified`. CGPA is also checked against the stored scale. `row` numbers are 1-based within the posted batch. Response `{total, updated, unchanged, unmatched:[{row,registrationNumber,reason}], invalid:[{row,registrationNumber,fields}]}`. An `audit_events` row (`students.import`) is written and reminders are re-synced for updated students.
- **Support tickets**: students create (category `profile|eligibility|application|document|other`, subject 3-120, message 5-2000; newlines allowed in messages) and see their own; officers see the tenant's, each with `student:{id,name}`. Ticket creation is limited to 5 per hour per student (429 `RATE_LIMITED` + `Retry-After`), counted in the database. An identical ticket from the same student within 60 seconds returns the existing ticket (200, `replayed:true`) instead of creating a duplicate. Replies are only allowed while open (422 `TICKET_RESOLVED`); owner or officer can set `status` (idempotent). Other tenants' and other students' tickets are 404. New messages notify the other party (`ticket`, `ticket_message`).
- **Consent**: registration requires `acceptTerms: true` (400 with `fields.acceptTerms`) and stores `user_consents {user_id, policy_version:'v1', accepted_at}` (no IP). `GET /legal/versions` returns `{terms:'v1', privacy:'v1'}`.

- **Eligibility** (`src/eligibility.ts`, pure): rules `minCgpa, min10th, min12th, maxActiveBacklogs, maxGapYears, allowedDepartments[], allowedBatches[]`. Any failed criterion gives `not_eligible`; otherwise any missing profile value gives `pending`; else `eligible`. Reasons carry `{criterion, required, actual, met (true|false|null when missing), source, verification, message}`. CGPA is normalised to a 10 scale using `cgpaScale`.
- **Apply**: runs in one transaction under a per-(drive,user) advisory lock. Same `idempotencyKey` replays the original receipt (200). A different key when already applied returns 409 `ALREADY_APPLIED`. The deadline is checked against the database clock inside the transaction (422 `DEADLINE_PASSED`), then eligibility (422 `NOT_ELIGIBLE`; a `pending` student is also blocked), then answers (400 with `fields["answers.<id>"]`). A partial unique index on `(drive_id, user_id) WHERE status <> 'withdrawn'` backs this up; a withdrawn application can be re-submitted before the deadline.
- **Status transitions** (events are append-only, enforced by a DB trigger): submitted to screening, assessment, interview, rejected or withdrawn (officers may schedule without a screening step); screening to assessment, interview, selected or rejected; assessment to interview, selected or rejected; interview to selected or rejected; selected to offer_issued or rejected; offer_issued to offer_accepted or offer_declined; offer_accepted to joined. Students may withdraw only while `submitted`.
- **Verification**: each profile field has `unverified | verified | student_confirmed`, managed server-side. Editing an academic field to a new value resets it to `unverified`; saving an unchanged value keeps `verified`.
- **Reminders**: `scheduled_reminders` rows (T-60 / T-30 / T-15 minutes) are created at publish for every student who is eligible or pending, and when a student's profile change makes them eligible/pending (cancelled if they become ineligible). Only future fire times are scheduled. A deadline or rules edit on an open drive cancels and recreates them; applying, closing a drive or the deadline passing cancels them; the worker re-checks all of this at send time and never sends at or after the deadline. Quiet hours (evaluated in IST) suppress push but still create the in-app notification. Push is sent after the DB transaction commits, so a crash between commit and send loses that push (at-most-once) rather than duplicating it. Tokens Expo reports as `DeviceNotRegistered` are deleted.
- **Drive status** in API responses: `draft | open | closing (open, under 24h left) | closed (closed by officer or deadline passed)`. `GET /drives?status=open` includes `closing` drives.
- **Stipend drives**: `ctc.kind = "stipend_monthly"` reuses `ctc.fixedLpa` to carry the monthly stipend in rupees.
- Reminder copy: the PRD text was not available when this was built, so the titles and bodies in `src/reminders.ts` (`REMINDER_COPY`) are placeholders to align with PRD 5.5.

## Honest limitations

- **No ERP or SSO integration.** Student academic data is entered by students and verified manually by officers. Nothing is pulled from a university system.
- **Email verification needs SMTP; phone is not verified.** With `SMTP_HOST` set, sign-up sends a 6-digit code (10 min, 5 attempts, 60 s resend) and applying requires a verified email (`REQUIRE_VERIFIED_EMAIL`, default on when SMTP is set). Without SMTP the flow is off and nothing is sent. Mobile numbers are format-validated and unique only (no SMS OTP). Password reset is by emailed code and needs SMTP too.
- **Uploads are checked by size and declared type, not scanned.** With R2 configured, resumes/photos/logos/documents go straight to the bucket through presigned URLs; `confirm` verifies the stored size and content type, but file contents are not virus-scanned or sniffed. Without R2, resumes stay https links. The API never checks that a link resolves.
- **Google sign-in creates students only**, requires a verified Google email, and the user must add a mobile number before applying. Email-sending, Google, Turnstile and R2 calls are covered by mocked tests only; they need real keys to be proven end to end.
- Push relies on the Expo push service and needs a registered device token; delivery is best effort. Without a token only the in-app notification is created.
- The reminder worker is in-process polling (30 s granularity), not a dedicated queue. Lists are filtered in memory after a tenant-scoped query, which is fine for a single campus but would need SQL-side pagination at larger scale.
- Single university per deployment: registration always joins the default tenant (the schema and queries are tenant-scoped, but there is no tenant admin UI or tenant provisioning API).
- Officer accounts are created with a shared invite code; there is no per-officer approval flow.

## Placement operations module (analytics, policy, restrictions, cohorts, announcements v2, calendar, company CRM, audit, documents)

Full HTTP contract: `docs/ops-api.md`. Code: `src/policy/*` (pure logic: conditions, engine, restrictions, store, cohorts), `src/analytics/queries.ts`, `src/ops/*`, `src/routes/{analytics,policy*,ops*}.ts`; migrations `040`-`044`. Tests: `test/ops-*.test.ts`. The announcement worker (`startAnnouncementWorker`) starts next to the reminder worker unless `DISABLE_SCHEDULER=1`.
