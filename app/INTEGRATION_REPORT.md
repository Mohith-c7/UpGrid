# Integration report

Integrated tree QA, run in a clean copy (`/tmp/work/app-final`, `npm install` there, never in outputs). Date of run: 2026-11-07.

## Status

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors (before and after the fixes) |
| `npx expo export --platform android` | OK, Hermes bundle 8.5 MB, no warnings |
| `EXPO_OFFLINE=1 npx expo install --check` | up to date (offline mode: validates against `bundledNativeModules.json` for SDK 58) |
| `npx expo config --type introspect` | plugins resolve; Android permissions as listed below |
| Routing audit script | 0 file+folder pairs, 0 unresolved route strings (see Routing) |
| Not run | device/emulator, live server, `expo-doctor` (needs network), EAS build |

## Route map by role

Root Gate (`app/_layout.tsx`) decides the group from the session. Signed out: only `(auth)`. Signed in: only the group of the user's role, plus `verify-email` (any signed-in user) and `complete-profile` (only while owed).

### (root) (4 screens)

```
/+not-found
/complete-profile
/
/verify-email
```

### (auth) (8 screens)

```
(auth)/forgot-password
(auth)/login
(auth)/privacy
(auth)/recruiter-invite
(auth)/register
(auth)/reset-password
(auth)/terms
(auth)/welcome
```

### (student) (42 screens)

```
(student)/(tabs)/applications
(student)/(tabs)
(student)/(tabs)/opportunities
(student)/(tabs)/prepare
(student)/(tabs)/profile
(student)/ai/chat
(student)/ai/consent
(student)/ai/history
(student)/ai
(student)/ai/mock-interview/[id]
(student)/ai/mock-interview
(student)/ai/resume-review
(student)/application/[id]
(student)/application/[id]/slots
(student)/apply/[id]
(student)/attendance
(student)/calendar
(student)/drive/[id]
(student)/eligibility
(student)/notifications
(student)/prep
(student)/profile/edit-academics
(student)/profile/edit-identity
(student)/profile/links
(student)/profile/resumes
(student)/restrictions
(student)/resume-builder
(student)/settings/account
(student)/settings/privacy
(student)/settings/reminders
(student)/settings/terms
(student)/stats
(student)/support/[id]
(student)/support
(student)/support/new
(student)/tests/[id]
(student)/tests/attempt/[attemptId]
(student)/tests
(student)/tests/practice
(student)/tests/practice/problem/[id]
(student)/tests/result/[attemptId]
(student)/verification
```

### (officer) (56 screens)

```
(officer)/(tabs)/approvals
(officer)/(tabs)/drives
(officer)/(tabs)
(officer)/(tabs)/more
(officer)/(tabs)/students
(officer)/announce
(officer)/assessments/[id]/analytics
(officer)/assessments/[id]/attempt/[attemptId]
(officer)/assessments/[id]
(officer)/assessments/[id]/plagiarism
(officer)/assessments/[id]/preview
(officer)/assessments/[id]/results
(officer)/assessments/[id]/shortlist
(officer)/assessments/builder/[id]
(officer)/assessments
(officer)/assessments/questions/[id]
(officer)/assessments/questions
(officer)/drive/[id]
(officer)/drive/[id]/offers
(officer)/drive/[id]/outcomes
(officer)/drive/[id]/pipeline
(officer)/drive/[id]/recruiters
(officer)/drive/[id]/round/[roundId]
(officer)/drive/[id]/rounds
(officer)/drive/[id]/rubric
(officer)/drive/[id]/slots
(officer)/drive/new
(officer)/import-students
(officer)/legal/privacy
(officer)/legal/terms
(officer)/ops/analytics
(officer)/ops/announcements/[id]
(officer)/ops/announcements/compose
(officer)/ops/announcements
(officer)/ops/announcements/templates
(officer)/ops/audit
(officer)/ops/calendar
(officer)/ops/cohorts/[id]
(officer)/ops/cohorts
(officer)/ops/cohorts/new
(officer)/ops/companies/[id]
(officer)/ops/companies
(officer)/ops/companies/new
(officer)/ops/documents
(officer)/ops
(officer)/ops/policy/[id]
(officer)/ops/policy/conditions
(officer)/ops/policy
(officer)/ops/policy/version/[vid]
(officer)/ops/restrictions/[id]
(officer)/ops/restrictions
(officer)/ops/restrictions/new
(officer)/ops/settings
(officer)/student/[id]
(officer)/support/[id]
(officer)/support
```

### (recruiter) (13 screens)

```
(recruiter)/(tabs)/candidates
(recruiter)/(tabs)
(recruiter)/(tabs)/messages
(recruiter)/(tabs)/profile
(recruiter)/drive/[id]/candidate/[appId]
(recruiter)/drive/[id]
(recruiter)/drive/[id]/offer-new
(recruiter)/drive/[id]/offers
(recruiter)/drive/[id]/round/[roundId]
(recruiter)/drive/[id]/rounds
(recruiter)/drive/[id]/slots
(recruiter)/legal/privacy
(recruiter)/legal/terms
```

Notes
- Route URLs repeat across role groups (`/`, `/drive/[id]`, `/profile`, `/support`, `/legal/*`, `/drive/[id]/rounds|slots|offers|round/[roundId]`). That is safe only because every navigation in the code uses group-qualified paths (`/(student)/...`, `/(officer)/...`, `/(recruiter)/...`); the audit found no unqualified link except `/` and `/verify-email` (both unique). Keep it that way. External deep links to an unqualified shared URL (for example `upgrid://drive/123`) are ambiguous and are not used anywhere; push notifications open qualified paths.
- Sub-folders without `_layout.tsx` (for example `drive/[id]/`, `ai/`) are flattened into the parent stack by expo-router; that is intended.
- Own stacks: `(student)/tests/_layout`, `(officer)/assessments/_layout` (flag gate), `(officer)/ops/_layout`, `(recruiter)/_layout` (role + flag gate).

## Role guard (root Gate + group layouts)

Inputs: session status (`loading|signedOut|signedIn`), role, `useAuthStep()` (complete-profile: Google student without phone; verify-email: only right after email sign-up, flag `emailVerification`, email unverified), current top-level segment.

| State | Result |
|---|---|
| session loading | no redirect, splash stays, `index` renders null |
| signed out, group not `(auth)` | `replace /(auth)/welcome` (includes `verify-email`, `complete-profile`, role groups) |
| signed out, `(auth)` | stay |
| signed in, step owed, group != step | `replace` to the step screen |
| signed in, group `verify-email` | stay (any signed-in user may open it from a banner) |
| signed in, group `complete-profile`, step is complete-profile | stay |
| student | any group other than `(student)` -> `/(student)/(tabs)` |
| officer | any group other than `(officer)` -> `/(officer)/(tabs)` |
| recruiter | any group other than `(recruiter)` -> `/(recruiter)/(tabs)`; area also needs flag `recruiter` |
| unknown role | `session.clear()` (back to welcome) instead of a dead screen |
| `/config` loading or failed | flags are all false; no role/auth redirect depends on a flag except the optional verify-email prompt (off when flags unknown) |

Loop analysis: the only redirects are to a group the user is allowed in, or to a screen that exits itself. `complete-profile` and `verify-email` finish with `session.setUser` (which clears the step) then `replace('/')`; `index` redirects by role. Skip on verify-email calls `dismissVerify()` first. The prompt flag is also reset on sign-out so it cannot leak to the next account. Each of `(student)`, `(officer)` and `(recruiter)` layouts additionally renders nothing for any other role or a signed-out user, so a wrong-role screen never mounts (no stray queries) during the frame before the Gate redirects.

## Feature flags map (`@/config/features`: `useFeatures()` / `useFeature(name)`)

All entry points now read from the single `FeatureFlagsProvider` (one `/config` fetch, retries 3s/10s/30s, refresh on reconnect and foreground). `src/api/useFeatureFlags.ts` was removed; `useTestsFeatures`/`useTestsEnabled` in `src/api/tests.ts` keep their API and read the provider (`loading` = first read in flight, `failed` = fallback to defaults).

Defaults (config loading or failed): every flag false, upload limits 5/2/1/5 MB. Flags only hide optional UI; nothing in core drives list, drive detail, apply, applications, notifications, profile or officer drives/students depends on a flag. Server stays authoritative.

| Flag | Gates |
|---|---|
| `ai` | student AI hub/chat/history/resume review/mock interview (AiGate), Home AI card, Profile row, Prep rows; officer announcement draft, MCQ generate, policy draft; recruiter candidate summary and question set |
| `assessments` | student Tests (TestsGate), Home/Prepare cards, Profile row, Prep; officer `/assessments/**` layout, More/Home/Drive rows |
| `codeExecution` | coding practice (TestsGate needCode), Run/Submit-code buttons (only disabled once config actually loaded). The test runner itself is never gated |
| `recruiter` | whole `(recruiter)` area (loading skeleton, retry when config failed, "not enabled" message) |
| `emailVerification` | verify-email prompt and screen, forgot-password |
| `requireVerifiedEmail` | VerifyEmailBanner wording and verify-email screen |
| `fileUploads` | ResumeUploader, LogoUploader, resume-builder "save to my resumes" |
| `googleLogin` | Google button (also needs a client id) |
| `turnstile` | Turnstile widget on login/register |
| `opsRestrictions` | student restrictions banner and Profile row |
| `opsAnalytics` | student stats shortcut and screen |
| `opsCalendar` | student calendar shortcut and screen |
| `opsDocuments` | student verification documents |

## Shared infrastructure

- One `QueryClient` (`src/api/queryClient.ts`) mounted once in the root; cache cleared on sign-out/sign-in.
- Query key roots: `me, profile, resumes, drives, applications, notifications, reminder-settings, announcements, time, tickets, officer, ai, tests, assess, ops, pipeline, recruiter, student-extras`. Collision fixed: `hooks.ts` (`qk.dashboard/applicants/students/student`) used the same keys as `features/officer/data.ts` with different data shapes; the `hooks.ts` ones now end in `raw`/`-raw`. Broad `['officer']` invalidation still covers both.
- API client: single-flight refresh; 401 on an authenticated call refreshes then retries once; refresh 400/401/403 clears the session; no refresh token plus 401 now clears a stale session; network failures keep the session. `apiGetText` and the AI SSE stream share the same refresh behaviour.
- `ApiError` now has `body` (whole parsed JSON) next to `code/status/fields/retryAfterSeconds/isNetwork`. `pendingSubmissionOf(e)` in `src/api/tests.ts` reads `body.submission.id` from the 503 `CODE_EXECUTION_UNAVAILABLE`; the coding panel shows the last 8 characters as a reference on the "Queued" banner.
- Offline banner: root-level (`RootBanner`) only while offline, plus form-level banners.
- Global `ErrorBoundary` (`src/ui/ErrorBoundary.tsx`) wraps the providers in the root layout; it depends only on react-native and theme tokens. There is no crash reporter; wire `onError` when one is chosen.
- Clipboard: `src/lib/copy.ts` (`copyText`, `useCopy`) with share-sheet fallback. Direct "Copy" now in AI chat and resume review (next to Share), officer calendar feed link, student calendar feed link, recruiter invite code.

## Dependencies

- `package.json` has no duplicate keys, no dependency/devDependency overlap, one `react`/`react-native` in the tree. Every pin matches `expo/bundledNativeModules.json` (SDK 58) after pinning `react-native-svg` to `15.16.0` and `react-native-webview` to `14.0.1` (were carets) and adding `expo-clipboard ~58.0.4`.
- Every import specifier from `node_modules` resolves to a package in `package.json` (script run over `app/` and `src/`). Peer-only entries kept on purpose: `expo-crypto` (auth-session), `expo-font`, `expo-linking`, `react-dom`, `react-native-screens`, `react-native-svg`.
- `app.json` plugins: `expo-router, expo-splash-screen, expo-secure-store, expo-notifications, @react-native-community/datetimepicker, expo-sharing, expo-camera, expo-calendar`. Fixed: the legacy root `splash` key is ignored in SDK 58 (the `expo-splash-screen` plugin only acts when it is listed with props), so it moved into the plugin entry with the same image/colour.
- Android permissions after prebuild config: `POST_NOTIFICATIONS, CAMERA, READ_CALENDAR, WRITE_CALENDAR, INTERNET`. `blockedPermissions` strips `RECORD_AUDIO, SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE`. iOS: `ITSAppUsesNonExemptEncryption=false`, camera and calendar usage strings.
- No `expo-screen-capture`, `FLAG_SECURE` or `preventScreenCapture` anywhere.

Needs a native rebuild (dev client / EAS), not Expo Go: `expo-camera`, `expo-calendar`, `expo-notifications` (and an EAS `projectId` for push), `expo-print`, `expo-clipboard` (new), `expo-document-picker`, `expo-sharing`, `expo-file-system`, `@react-native-community/datetimepicker`, `react-native-svg`, `react-native-webview`, `expo-auth-session`/`expo-crypto`/`expo-web-browser` (Google sign-in, plus Google client ids in env, see `INTEGRATIONS.md`), `expo-secure-store`, `expo-splash-screen` (plugin config changed), `expo-device`, `@react-native-community/netinfo`, `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context`. In practice: one fresh native build covers all of it.

## Fixes made in this pass

1. File+folder route pairs `(officer)/drive/[id].tsx` + `drive/[id]/` and `(student)/application/[id].tsx` + `application/[id]/` moved to `[id]/index.tsx`.
2. Legal screens opened from the recruiter area linked to the student group (and were bounced by the guard); `LegalScreen` now knows `(recruiter)`.
3. `/(student)/(tabs)/index` fallback in stats corrected to `/(student)/(tabs)`.
4. Query key collisions between `hooks.ts` and `features/officer/data.ts` (see above).
5. Feature flag sources unified (two older sources removed or wrapped); coding 503 body access; stale-session clear on 401 without refresh token.
6. Root: global ErrorBoundary; stable guard effect dependencies (no repeated `replace` while an auth step is pending); verify prompt reset on sign-out; unknown role no longer strands the user; `complete-profile` only reachable while owed; role layouts refuse other roles.
7. Dependencies and app.json as above; `expo-clipboard` and direct copy.

## Verified vs not verified

Verified (static or build time): TypeScript, Android bundle, route files and every route string in code, dynamic param names read in their screens, import/package consistency, Expo SDK 58 version pins (offline data), config plugin resolution and resulting permissions, guard logic by reading (table above).

Not verified: anything at runtime. No device or emulator, no live server (so no `/config`, no auth, no SSE, no uploads), no push, no Google sign-in, no Turnstile WebView, no camera/QR, no calendar writes, no print/PDF, no clipboard on device. `expo-doctor` and the Expo API check need network. Layout at 360dp / 1.3x font is by construction only. Web is not a target (`react-native-web` not installed).

Known gaps / decisions for you
- Recruiters get a blocking "could not check settings" screen when `/config` fails (flag `recruiter` defaults false). Core student and officer screens are unaffected.
- `appStatusMeta` label ("Not selected") and `StatusBadge` label ("Not taken forward") still differ (noted by the student UI pass).
- Two data layers (`src/api/hooks.ts` and `features/*/data.ts`) remain; keys are now distinct.
- No crash reporter, no EAS `projectId` (push returns null without it), `API_URL` defaults to `http://10.0.2.2:4000/api/v1` (set `EXPO_PUBLIC_API_URL`).
- `npm audit`: 5 moderate transitive advisories (from the earlier report), not re-checked.

## Manual QA checklist for the first device run

Install a dev/EAS build on a real Android device with the API reachable (`EXPO_PUBLIC_API_URL`).

Startup and shell
1. Cold start: splash (teal, logo) then welcome; no white flash; fonts load.
2. Airplane mode on welcome: offline banner at top; turn it off, banner disappears.
3. Kill the server, open the app: welcome still works, no crash, recruiter-less screens fine.
4. Throw a render error (dev menu) and confirm the "Something went wrong / Try again" screen appears.

Auth and guards
5. Register student (terms checkbox, Turnstile if on), land in student tabs. If `emailVerification` is on, verify-email appears once; Skip returns to Home with no loop.
6. Log out, log in as officer: lands in officer tabs. In dev, try pushing a student route via deep link: redirected back.
7. Log in as recruiter (flag on and off): tabs vs "not enabled" screen; Sign out works.
8. Google sign-in (if configured) for a new account: terms panel, then complete-profile; saving the number leaves the screen.
9. Forgot/reset password flow end to end with real email.
10. Kill and reopen: session restored; expire the access token on the server: next call refreshes silently; revoke the refresh token: lands on welcome.

Student
11. Opportunities list, filters, drive detail (open `drive/[id]`), save/unsave, Apply flow incl. resume (link and uploaded file), receipt.
12. Applications list and detail, timeline, hiring rounds tracker, book/cancel a slot, offer accept/decline.
13. Notifications and push tap opens the right screen; badge updates.
14. Tests: list, start, answer, kill the app mid-test and resume, go offline mid-test and back, auto-submit at deadline, result page. Coding question: run, submit, and with the judge down confirm the "Queued" banner with reference.
15. Attendance: camera permission prompt, scan a QR, deny permission path, manual code.
16. AI: chat streams, Copy puts text in the clipboard (paste elsewhere), Share opens the sheet, quota meter, consent on/off.
17. Calendar: add to calendar permission, feed link Copy/Share/Revoke. Resume builder: preview and PDF share. Restrictions and appeal. Stats.
18. Flags: switch `ai`, `assessments` off on the server and restart: entry points disappear, core screens remain.

Officer
19. Dashboard, create drive (stepper, pickers, logo upload), publish, edit, close, duplicate.
20. Applicants: status moves, schedule (pickers, IST), CSV export share, import students CSV.
21. Pipeline: rounds, invite recruiter (Copy invite code), slots, offers, attendance QR sheet.
22. Assessments: question bank, builder, publish, results, export. Ops hub: policy, restrictions, cohorts, announcements, calendar link Copy, audit.

Recruiter
23. Accept an invite (`upgrid://recruiter-invite?token=...`), register, drives, candidates, scorecard, propose slot, offer with policy check, messages.

Hardware and layout
24. Screenshot and screen recording work everywhere (must not be blocked).
25. Back button on every stack, 360dp wide phone, font scale 1.3, TalkBack on login and apply.
