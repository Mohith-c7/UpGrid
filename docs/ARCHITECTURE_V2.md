# UpGrid v2 — one app for the whole placement lifecycle

Owner decisions (founder is away; the lead engineer owns everything). ONE Expo app, three roles: student, officer (placement cell), recruiter. No separate web portals.

## Modules and owners (server = Express+TS+Postgres in server/, app = Expo in app/)
| Module | Server files (own!) | Migration range | App areas |
|---|---|---|---|
| Assessments (MCQ + coding tests, question bank, auto-grading, results, proctoring-lite) | routes/assessments*.ts, src/assessments/* | 010–019 | student Tests tab/screens, officer Tests builder + results |
| Hiring pipeline + Recruiter role (rounds, shortlists, scorecards, offers, company membership) | routes/pipeline*.ts, routes/recruiter*.ts, src/pipeline/* | 020–029 | recruiter mode, officer pipeline/offers |
| AI (Gemini): student copilot, recruiter question generator from resume+JD, resume review, mock interview | routes/ai*.ts, src/ai/* | 030–039 | AI assistant, mock interview, recruiter question generator |
| Placement analytics, policy engine, restrictions, audit log, cohorts/groups, calendar feed | routes/analytics*.ts, routes/policy*.ts, src/policy/* | 040–049 | officer analytics, policy, restrictions, audit, calendar |
| Auth/Email/Google/R2/Turnstile (running now) | auth.ts, files, mail | 003–009 | auth screens |

## Rules for parallel agents (strict)
- Work ONLY in your own scratch copy (`/tmp/work/<module>-server`, `/tmp/work/<module>-app`), never run npm in /mnt/user-data/outputs (no symlinks there). Copy back ONLY files you created/changed, using `diff -rq` against the current outputs tree first; never overwrite another module's files; before editing a shared file (app.ts, validation.ts, context.ts, seed.ts, test/helpers.ts, hooks.ts, types.ts, layouts) re-read the CURRENT outputs version and patch with minimal Edit replacements.
- Mount your router by appending ONE import + ONE line at the `MODULES-BEGIN` marker in server/src/app.ts. Register feature flags via `registerFeatureFlags()` from `server/src/features.ts`.
- Migration files only in your range (e.g. `010_assessments.sql`), idempotent (`IF NOT EXISTS`), tenant-scoped tables (`tenant_id`), indexes + constraints. Add your tables to nothing global; new tables referencing users/drives cascade.
- Postgres: start your own throwaway cluster on YOUR port (assessments 5441, pipeline 5442, ai 5443, analytics 5444) and DB names unique to you.
- Own tests in `test/<module>.test.ts`; all must pass with `npx tsc --noEmit`. Do not touch other modules' tests.
- Write the module's HTTP API doc FIRST (within ~10 minutes) to `server/docs/<module>-api.md` with exact paths, bodies, responses, error codes — the app agents code against it.
- Roles: `student`, `officer`, `recruiter` (the pipeline agent extends AuthUser/requireRole/JWT/registration; others use `requireRole('officer'|'student')` and for recruiter-shared endpoints `requireRole` variants once available — if not yet present use a local guard `req.user.role === 'recruiter'` reading from `me(req)`).
- Errors: `{error:{code,message,fields?}}`; lists `{items,nextCursor}`; limit max 50; everything validated with zod + the shared validators; idempotency where retried; audit events for sensitive changes; tenant scoping on EVERY query; never trust the client for scores/time.
- AI must never decide eligibility/selection; human review required before any AI output is sent to others; minimise personal data sent to the model; per-user quotas; env-driven: GEMINI_API_KEY (or Vertex: GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GOOGLE_APPLICATION_CREDENTIALS_JSON), AI_MODEL (default `gemini-flash-lite-latest`), AI_DAILY_LIMIT (default 30). Provider injectable for tests; when unset, `features.ai=false` and endpoints return 503 `AI_NOT_CONFIGURED`.
- Code execution via Judge0 (never run untrusted code on our server): env JUDGE0_URL, JUDGE0_API_KEY (optional, RapidAPI-style header configurable by JUDGE0_API_HOST), JUDGE0_AUTH_TOKEN (optional). Injectable for tests; when unset `features.codeExecution=false` and coding questions cannot be published.
- UX rules (founder): flat, simple, professional; NO bounce/slide/pop animations; do not block screenshots anywhere (including tests); every screen has loading/empty/error/offline states; double-submit locks; 10-digit mobile/Gmail rules everywhere.
