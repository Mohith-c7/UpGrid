# Build report

Verified in a clean copy at `/tmp/work/app2` (never `npm` in this folder).

## Package versions (package.json)
expo ~58.0.23, react 19.3.0, react-dom 19.3.0 (added, expo-router peer), react-native 0.88.1, expo-router ~58.0.30,
expo-notifications ~58.1.8, expo-constants ~58.0.15, expo-device ~58.0.5, expo-linking ~58.0.16, expo-secure-store ~58.0.2,
expo-splash-screen ~58.0.13, expo-status-bar ~58.0.4, react-native-gesture-handler ~3.3.0, react-native-safe-area-context ~5.11.1,
react-native-screens ~4.30.1, @react-native-community/netinfo 12.0.1, babel-preset-expo ~58.0.24 (devDependency, added),
typescript ~6.0.3, zod ^4.6.7, @hookform/resolvers ^5.9.2 (zodResolver works with zod 4), react-hook-form ^7.91, @tanstack/react-query ^5.107.
`package-lock.json` is included; it contains no absolute paths.

## Commands and results
- `npm install`: OK.
- `npx expo install --fix`: the network call to api.expo.dev was refused by the sandbox proxy (403). Re-ran with `EXPO_OFFLINE=1`,
  which uses `node_modules/expo/bundledNativeModules.json` (same SDK 58 data). It corrected netinfo, expo-notifications,
  gesture-handler, safe-area-context and screens. `react-dom` and the other expo-* pins were added by hand from the same file because
  npm reported an ERESOLVE (react-dom 19.3.1 vs react 19.3.0). `expo install --check` (offline) reports up to date.
- `npx tsc --noEmit`: before 15 errors (1 tsconfig, 10 tab-icon colour type, 1 FlatList footer, 2 `beforeRemove`, 1 question type, 1 TextInput ref); after 0.
- `npx expo export --platform android`: first failed (`babel-preset-expo` not hoisted, so Metro could not build the transformer). After adding it as a devDependency: succeeds, Hermes bytecode 5.9 MB.
- `npx expo-doctor`: 18/20 pass. The 2 failures are network-only (exp.host config schema, React Native Directory). Not real project issues.

## Fixes (compile and bundle)
tsconfig: removed deprecated `baseUrl` (TS 6), `paths` now `./src/*`. Tab icon render functions take `ColorValue`. FlatList footer `null` -> `undefined`.
`useNavigation<any>()` for `beforeRemove` (DriveStepper, kit). `type: 'short_text' as QuestionType`. `TextField.inputRef` typed with `ComponentRef<typeof TextInput>`.
No zod/resolver typing problems occurred; validators in `src/lib/validation.ts` are not needed.

## Static review fixes
- Unsaved-changes guard (`useUnsavedGuard`): tapping Discard re-triggered `beforeRemove` and showed the alert again forever (dead end). Now bypasses on Discard.
- DriveStepper: double tap on Next could skip a step (two overlapping async saves); now serialised with `useOnce`. Header back falls back to officer home when there is no history.
- Edit identity / academics / links: after save `router.back()` replaced by `useBack` fallback (deep-link safe). Announcement and officer drive/student headers: same fallback; announcement screen got KeyboardAvoidingView.
- Profile tab: `p.completion` guarded (`?.`).
- RootBanner added a second status-bar inset on every screen while online; now renders only when offline.
- All `router.push`/`replace`/`Redirect` targets checked against files under `app/`: all resolve. Timers and listeners are cleaned up. No infinite effect loops found.

## UI pass
- Removed motion: Sheet is now a plain opacity fade (150 ms, no slide); skeletons are static grey blocks (no pulse); toasts fade only (150 ms);
  student stack uses default transition (removed `slide_from_right` and `slide_from_bottom` for apply); tabs and auth fade. No springs, scale or bounce exist.
- Shape: radius card 12, button 10, field 10, chip/badge 8 (was 16/12/999/12); card shadow replaced by 1px border plus elevation 1; decorative circles in Empty/Error states and apply success changed to rounded squares (logos stay).
- Layout: Chip and Badge capped at `maxWidth: 100%` so long labels truncate instead of overflowing; officer tab labels no longer scale with font size (matches student). Text is capped at 1.6x; rows use flex:1 with wrapping/ellipsis.
- Spacing scale 4..32 and 16 screen padding were already consistent; empty/error/loading states share one component set.
- Not checked on a device or emulator (no emulator here). The 360dp / 1.3x review is from reading layout code.

## Remaining risks
- `expo install --fix` and expo-doctor could not reach the Expo API; re-run both on a networked machine.
- Runtime behaviour was not exercised (no device, no backend). `API_URL` defaults to `http://10.0.2.2:4000/api/v1`; set `EXPO_PUBLIC_API_URL` for real builds.
- Push notifications need an EAS `projectId` in app config; without it `registerForPush` quietly returns null.
- Two parallel data layers exist (`src/api/hooks.ts` and the feature `data.ts` files) with distinct query keys; they work but duplicate code.
- 5 moderate `npm audit` advisories in transitive dependencies.

## Feature UI pass 2 (scheduling, export, import, tickets, consent)
Verified in `/tmp/work/app2` after syncing: `npx tsc --noEmit` = 0 errors; `npx expo export --platform android` succeeds (Hermes bundle 6.1 MB).
New native deps (installed with `EXPO_OFFLINE=1 npx expo install`, SDK 58 pins): `@react-native-community/datetimepicker` 9.2.1, `expo-calendar` ~58.0.6,
`expo-file-system` ~58.0.13, `expo-sharing` ~58.0.22, `expo-document-picker` ~58.0.4. `app.json` plugins added: datetimepicker, expo-sharing, expo-calendar (permission text).
These need a new dev/EAS build (not Expo Go). `package.json`, `package-lock.json`, `app.json` copied back from app2.

Screens and files added
- Scheduling: `src/features/officer/ScheduleSheet.tsx` (type, IST date/time pickers, online/in person, venue or https link, instructions, bulk result list), used by officer `drive/[id]`
  (per-applicant "Schedule", "Select to schedule" + "Schedule selected (n)"). Student `application/[id]` shows `ScheduleCard` (IST date/time + relative, mode, tap-to-open link, instructions, "Add to calendar").
  Pickers: the native picker gets a Date whose local fields equal the IST wall clock, so results are correct on any device time zone.
- Calendar: `src/lib/calendar.ts` (permission request, denial message with "Open settings", writable calendar lookup, one-hour event with a 1 h alert).
- Export: officer drive "Export CSV" -> `apiGetText` (new in `api/client.ts`, same auth refresh) -> `expo-file-system` cache -> `expo-sharing` (`src/lib/shareFile.ts`). Handles offline, empty file, errors.
- Import: `app/(officer)/import-students.tsx` + `src/features/officer/csv.ts` (parser: quotes, escaped quotes, newlines in cells, BOM, CRLF/CR, blank rows; header aliases; validation with `src/lib/validation.ts`;
  chunks of 500; max 5000 rows and 2 MB per file). Preview, row-numbered client errors, confirm sheet, batch progress, result summary (unmatched/invalid lists), "Download template".
- Tickets: student `app/(student)/support/{index,new,[id]}.tsx`; officer `app/(officer)/support/{index,[id]}.tsx`; shared code in `src/features/support/`. Shortcuts: "Report a problem with this drive" (student drive detail) and "Dispute eligibility" (Eligibility screen) open `support/new` with prefilled category/subject/message.
- Consent: `Checkbox` added to `src/ui`; register requires it (`acceptTerms` in the zod schema, message "You must agree to the Terms and Privacy Policy to create an account"); `RegisterBody.acceptTerms: true` is sent.
  `app/(auth)/terms.tsx`, `app/(auth)/privacy.tsx` render `src/features/legal/LegalScreen.tsx` with the DRAFT banner. Because the root gate redirects signed-in users out of `(auth)`, the same screens are re-exported at
  `(student)/settings/{terms,privacy}` (linked from Account) and `(officer)/legal/{terms,privacy}` (linked from More).
- Hooks/types added to `src/api/hooks.ts` and `src/api/types.ts`: `useScheduleApplication`, `useScheduleBulk`, `useImportStudents`, `useTickets`, `useTicket`, `useCreateTicket`, `useReplyTicket`, `useSetTicketStatus`; `Application.schedule`.
- Router targets: every `/(student)|(officer)|(auth)/...` string was checked against files under `app/`; all resolve.

Assumptions to confirm against the API
- Ticket field limits are not in the spec; client uses subject 3-120 and message 5-2000 and shows any server field errors.
- Import `unmatched[].row` / `invalid[].row` are treated as 1-based within the posted batch and mapped back to the file's data row (first row under the header = 1).
- Schedule action is offered for statuses submitted, screening, assessment, interview; the server stays the authority and bulk failures are listed.
- Ticket status filter value for the inbox tabs is `open` / `resolved`; the thread allows replies only while open, and offers "Reopen" via `POST /tickets/:id/status {status:'open'}`.
- Not run on a device: pickers, calendar permission, document picker and share sheet are untested at runtime.

## Officer & Auth UI pass

Scope: `app/(officer)/**`, `src/features/officer/**`, `app/(auth)/**`. Route file names and hook names unchanged; no new features; `app/(student)` untouched. Verified in clean copy `/tmp/work/app3`: `npx tsc --noEmit` 0 errors, `npx expo export --platform android` OK.

### Restyled
- Dashboard: `ScreenHero` (IST greeting + first name) with overlapping summary card and the single primary action (Create drive); 2x2 `StatTile`s; warning `Banner` for pending verifications; upcoming deadlines as officer `DriveCard`s; skeletons match tile/card geometry.
- Drives: `SearchBar` + `SegmentedTabs` filters, virtualised `FlatList`, `DriveCard` (logo, package, tinted status badge with icon, deadline with timer icon under 24h, applicant count), infinite scroll with footer spinner/retry.
- Students: `SearchBar`, verification tabs, batch chips, `StudentCard` list (avatar, dept/batch/CGPA, verification badge).
- Approvals: Draft drives / Verifications tabs with counts; publish inside each draft card; per-card publish lock and inline "cannot publish" reasons.
- More: grouped `ListRow` cards (Communicate, Manage, Legal), recent announcements, `MetricRow` report summary, companies sheet with logos, logout confirm.
- drive/[id]: summary card + `KeyValueList`, action list (edit/duplicate/close), eligibility `MetricRow`s, applicant cards with status badges, status filter tabs, multi-select scheduling with sticky footer, publish in sticky footer for drafts.
- student/[id]: profile card + completion bar, academic fields as one list with checkbox selection, sticky verify footer, confirm sheet for "Verify all", applications and profile cards.
- drive/new stepper: `StepIndicator`, step title + hint, fields grouped in a card, sticky Back/Next/Publish footer, save-status line with icon, error `Banner` with Retry, native IST date/time pickers (replaces typed DD/MM/YYYY), removable tag chips, `Select` for question type, checkbox toggles, review as per-section `KeyValueList` cards with Edit.
- ScheduleSheet: shared IST picker rows (new `components/pickers.tsx`), banner results.
- announce (Select audience, sticky send), import-students (steps card, issue lists, sticky import footer), support inbox (`SegmentedTabs`).
- Auth: welcome (+ Terms/Privacy links), login, register now put the form card over the hero, `Banner` for server errors, offline banner inside the card. Logic and validation unchanged.

### Bugs found and fixed
1. Status bar: the teal hero set light icons that stayed active on every other tab (white icons on white headers). New `FocusedStatusBar` renders only on the focused screen; used on all officer screens, legal and auth terms/privacy.
2. Stepper deadline: typed date/time committed only on blur, so tapping Next right after typing lost the deadline ("Set an application deadline"). Replaced by pickers that commit immediately.
3. Stepper hardware back with unsaved edits exited the whole stepper; now goes back one step (autosave keeps edits). Next failure scrolls to top and shows a count banner.
4. Stepper autosave error: message disappeared on next edit and had no retry; now a persistent banner with the specific reason and "Retry save".
5. Keyboard covered stepper inputs on Android (KeyboardAvoidingView was iOS-only); now `Screen keyboard` with footer that collapses to a single Next button while typing.
6. Approvals: one `busy` flag put every Publish button into loading; now per-card. Server field errors shown on the card.
7. Student/pending filters: server cannot tell "pending review" from "unverified", so both filters returned the same list; now split client-side and auto-fetch the next page when the filtered page is short. Approvals list no longer shows students with nothing to review.
8. drive/[id]: all "Move to ..." buttons spun together; now only the tapped one. Duplicate applicant keys de-duplicated; stale picks ignored after a refetch; selection checkbox now has role/state; filter state no longer uses `undefined`.
9. student/[id]: stale selection after refetch could re-verify already verified fields; selection is now intersected with verifiable fields; "Verify all" needs confirmation; company object/string guard on applications; percentages shown with %, CGPA 2dp; phone guarded.
10. announce: a long drive list of chips replaced by `Select`; offline guard; field errors clear on edit; field errors from server mapped.
11. Logout in More: failure of the server call left the user on a dead screen; now always routes to welcome and toasts.
12. `useOnce` captured a stale closure; now reads the latest function.
13. Tag chips used a "✕" glyph and 36dp targets; now labelled "Remove X" with 48dp target. Contact email now uses `EmailField` (gmail typo hint). Lists use FlatList with stable keys, empty/error/footer states; skeleton heights match final cards.

### Known / out of scope
- `ThreadView`, `TicketList`, `LegalScreen` are shared with the student app and were left as they are (only status bar wrapped).
- Student tab screens have the same light/dark status bar issue with their hero; `FocusedStatusBar` (src/features/officer/components) can be reused or `ScreenHero` made focus-aware.
- Not run on a device or emulator; layout checks at 360dp / 1.3x font are by construction (wrapping rows, `minWidth: 0`, no fixed heights on text containers).

## Student UI pass
Scope: every screen under `app/(student)/**`, `src/features/student/**`, `src/features/support/**`, `src/features/legal/**`. No routes, route file names or existing hook names changed; no new features. Verified in `/tmp/work/app2`: `npx tsc --noEmit` 0 errors, `npx expo export --platform android` OK (Hermes bundle 6.2 MB). Not run on a device or emulator: the 360dp / 1.3x font checks below are from layout review (wrapping rows, `minWidth: 0`, no fixed widths), not from screenshots.

Restyled (design system components only, no raw hex, no animation, no decorative shapes)
- Shell: new `Page` in `src/features/student/me/kit.tsx` (bar `Header`, scroll body with pull-to-refresh, `OfflineBanner`, keyboard avoidance, sticky footer, `scroll={false}` for FlatList screens) and `RowGroup` (card of divider-separated `ListRow`s). Student stack uses fade transitions.
- Home: `ScreenHero` (greeting, bell with unread badge, flat profile-completion card with ONE next step), two `StatTile`s, offer `Banner` when an offer awaits, compact `DriveCard`s, application updates, announcements.
- Opportunities: `SearchBar`, `SegmentedTabs` (All / Open / Closing soon / Closed), filter and sort chips, `DriveCard` FlatList with skeletons matching card height.
- Applications: `SegmentedTabs` with counts, FlatList of application cards (status badge with icon, owner, applied date, "what happens next").
- Prepare: collapsible cards with per-section `ProgressBar`, info `Banner`, one CTA.
- Profile: identity card, tinted completion card, checklist, verification list, `RowGroup`s for edit and settings.
- Drive detail: bar header with bookmark `HeaderAction`, key facts (`KeyValueList`), deadline card with `Countdown`, eligibility `Banner` plus a stacked criteria table, rounds as `TimelineList`, single primary CTA in the footer.
- Apply: review sheet with deadline card, "Fix before you apply" (conflicts and missing), "Filled from your profile" (value, verification badge, source, who it is shared with), resume radio card, only `questionsToAsk`, confirm checkbox, error `Banner` above the footer button; receipt screen with `CodeBlock` reference.
- Application detail: status card, offer response card (one primary), `TimelineList` timeline, `ScheduleCard` (icons, link, calendar), receipt with `CodeBlock`, withdraw card, accept/decline sheet.
- Notifications (FlatList, mark-all as header action), Eligibility (StatTiles, `SegmentedTabs`, `DriveCard` plus expandable criteria table), Settings (Account, Reminders, Terms, Privacy), profile edit screens (Identity, Academics, Links, Resumes) with grouped cards and sticky Save, Support list / new / thread, Legal.

Bugs found and fixed
1. Status bar: a teal hero left light icons on white-header screens. `Page`, drive detail and drive loading shell now claim dark icons only while focused, so Home keeps light icons and returning to it restores them.
2. Eligibility table used four narrow columns that clipped or broke words at 360dp / 1.3x. Rebuilt as stacked blocks (Criterion, Required, Yours, then Met / Not met / Missing badge, source, verification).
3. Fixed-width labels (`width: 96` key/value, 4-column header) removed; rows wrap instead.
4. Badges beside labels (application cards, ticket rows, schedule card, reminders permission, resume default) were in the same row as flexible titles; moved under the text so neither side is crushed.
5. Three duplicate IST formatters (`kit.formatIST`, `kit.timeAgo`, support `whenIST` using `Intl` with a time zone, which can be missing on some Android Hermes builds) now call the shared `formatDateIST` / `formatDateTimeIST` / `timeAgo`. Raw ISO strings can no longer show device time.
6. Home used a private `DriveCard` and `Banner`; all lists now use the shared `DriveCard`, and `Banner` has an `action` instead of nested buttons. Private versions removed from `discover/blocks.tsx`.
7. Identity edit: tapping Save with a 9-digit mobile or a typo email (for example `@gmial.com`) only showed a toast because the field's own "touched" state had not fired. Errors are now passed explicitly on submit and on invalid submit.
8. Reminders: the switch row was a non-pressable View with `accessibilityRole="switch"` (TalkBack tap on the label did nothing). Row is now a 48dp+ Pressable toggling the switch; the inner Switch is hidden from accessibility. Quiet hours accept `2200` and format it to `22:00`; number pad instead of the punctuation keyboard.
9. Apply: footer showed a one-line coloured title only; the full error `Banner` now sits above the submit button so the server message is always visible. Resume and confirm errors have icon + text. Save-to-profile switch row no longer double-announces.
10. Notifications: unread state was colour-only (coral dot); now bold title, "New" badge with icon and an accessibility label. Pagination moved to `onEndReached` with a retry footer.
11. Applications / Notifications / Opportunities lists: added list-level error footer with retry for "load more" failures, skeletons with the same height as the final cards, and a refresh action on the plain empty state.
12. Support list: a failed page fetch replaced the whole list with an error; now the list stays and a retry sits below. New ticket: field errors clear on edit, double-send guard, sticky Send. Thread: resolved state is a `Banner` with a Reopen action; reply Send is disabled while sending.
13. Dispute shortcut now also on the drive detail when not eligible; contact mailto / tel links catch rejected `openURL`.
14. Delete-account confirmation field forces capital letters; danger zone is a `Banner` plus a danger button (no primary button competes).
15. `toast.show?.(...)` calls on a non-optional API replaced with plain calls and a tone.

Not changed / notes for later agents
- `appStatusMeta` in `discover/helpers.ts` is kept (label "Not selected") but screens use `StatusBadge` from `me/kit` ("Not taken forward"). Pick one label before launch.
- Pass `useIsFocused`-gated `<StatusBar style="dark" />` on any new white-header stack screen (use `Page`), otherwise Home's light icons can leak onto it.
- Officer screens import `useBack` from `me/kit` and `TicketList` / `ThreadView` from `features/support`; those exports are unchanged (ThreadView now renders inside `Page`, so officer wrappers must not add their own header).
- Status bar (coordinator follow-up): `ScreenHero` and the teal `Header` in `src/ui` now render their light `StatusBar` only while the screen is focused (`useIsFocused`), covering student and officer screens. Student `Page` and drive detail keep their focus-gated dark `StatusBar`. tsc 0 errors and Android export OK after this change.

## AI UI pass

Scope: student AI screens plus reusable officer/recruiter AI components, against `server/docs/ai-api.md`. Everything is gated by `features.ai` from `GET /api/v1/config` (new `useFeatureFlags` / `useAiEnabled`, defaults to off while loading or on failure).

New files
- API: `src/api/ai.ts` (hooks, SSE `streamChat`, error classifier `aiErrorInfo`), `src/api/aiTypes.ts`, `src/api/useFeatureFlags.ts`.
- Student routes `app/(student)/ai/`: `index` (hub + quota), `chat` (streaming, suggested prompts, quota, Draft badge, stop), `history` (list, delete), `consent` (AI privacy: accept, revoke, delete my AI data), `resume-review` (paste or saved resume, optional drive match, score, before/after, `[X]` placeholders highlighted for `needs_student_input`), `mock-interview/index` (setup + history + delete) and `mock-interview/[id]` (question by question, per-answer feedback, finish report, resumable).
- Shared AI UI `src/features/ai/`: `kit.tsx` (AiGate, QuotaMeter, ConsentPanel, AiErrorBanner), `AiHomeCard`, and the staff components `QuestionSetEditor`, `CandidateSummaryCard`, `AnnouncementDraftButton`, `McqGenerateSheet` (props in `src/features/ai/README.md`).

Shared files patched (minimal)
- `app/(student)/(tabs)/index.tsx`: one import and `<AiHomeCard />` below the summary tiles.
- `app/(student)/(tabs)/profile.tsx`: `useAiEnabled()` and one conditional "AI assistant and privacy" row.

States handled: flag off, `AI_NOT_CONFIGURED`, `AI_DISABLED`, `AI_CONSENT_REQUIRED` (inline consent panel / banner), `AI_QUOTA_EXCEEDED`, `AI_RATE_LIMITED`, `AI_REQUEST_REJECTED`, bad output, upstream, timeout, offline, loading skeletons, empty and error with retry. Flat, no animations added, 48dp targets, text wraps for 1.3x. No screenshot blocking.

Notes
- Streaming uses `expo/fetch` (readable stream) with `?stream=1`; falls back to the JSON call if the runtime has no `TextDecoder`. The streamed text is always replaced by `done.message.content`.
- "Copy" uses the system share sheet (no `expo-clipboard` dependency in package.json); add `expo-clipboard` if a direct copy is preferred.
- `GET /config` was not mounted in `server/src` when this was built; until it is, `features.ai` reads false and every AI entry point stays hidden.
- Not exercised against a live server or device; verified with `tsc --noEmit` (0 errors) and `expo export --platform android`.

## Auth & integrations UI pass

Scope: feature flags from `GET /config`, Google sign-in, email OTP, forgot/reset password, Turnstile, R2 uploads, env docs. Written against `server/docs/integrations-api.md`. Verified in a scratch copy (`/tmp/work/app-auth`): `tsc --noEmit` 0 errors, `npx expo export --platform android` OK. **Not run on a device or against a live server**; Google sign-in, the Turnstile WebView and real R2 uploads need your keys (see `INTEGRATIONS.md`).

New files
- `src/api/integrations.ts`, `src/api/integrationsTypes.ts` (all new calls and types; `AuthUser` extends `User` with `emailVerified`, `authProvider`, `hasPassword`, `phoneDisplay`).
- `src/config/features.ts` (+ `defaults.ts`): `FeatureFlagsProvider`, `useFeatures()` ({flags, config, status 'loading'|'ready'|'fallback', refetch}), `useFeature('ai')`, `getAppConfig()`. Safe defaults (all off, limits 5/2/1/5 MB) on failure/offline; retries 3s/10s/30s, re-reads on reconnect and when the app returns to the foreground.
- `src/features/auth/`: `GoogleSignIn.tsx` (button, consent panel, `useGoogleAvailable`), `Turnstile.tsx` (`TurnstileWidget`, `useTurnstile`), `otp.tsx` (OTP field, expiry line, resend with cooldown), `postAuth.ts` (post-sign-in steps), `VerifyEmailBanner.tsx`, `errors.ts`.
- Screens: `app/verify-email.tsx`, `app/complete-profile.tsx`, `app/(auth)/forgot-password.tsx`, `app/(auth)/reset-password.tsx`.
- `src/features/uploads/` (`useFileUpload`, `uploadFile`, `UploadStatus`, `ResumeUploader`, `LogoUploader`, `README.md` with props).
- `app.config.js` (registers the reversed Google client ids as app schemes from env), `INTEGRATIONS.md`, `.env.example` rewritten with every `EXPO_PUBLIC_*`.

Shared files patched (minimal)
- `app/_layout.tsx`: `FeatureFlagsProvider` around the app; Gate redirects to `/complete-profile` or `/verify-email` when `useAuthStep()` says so and leaves those two top-level routes alone.
- `app/(auth)/login.tsx`, `register.tsx`: Turnstile, Google button, "Forgot password?" link; sign-in/register go through `loginRequest` / `registerRequest` so the Turnstile token is sent. Terms checkbox, validation and error mapping unchanged.
- `src/api/client.ts`: `ApiError.retryAfterSeconds` (body `retryAfterSeconds` or `Retry-After` header) for `429 RESEND_COOLDOWN`.
- `package.json`, `package-lock.json`: expo-auth-session, expo-web-browser, expo-crypto, react-native-webview.

Behaviour notes
- Google: authorization code + PKCE via `expo-auth-session/providers/google`, ID token sent to `POST /auth/google`. Hidden unless `features.googleLogin` and a client id exists for the platform. New accounts get a Terms consent panel on `TERMS_REQUIRED` (the API demands `acceptTerms` at sign-up, so Terms are collected there, not on the phone step); Register passes its own Terms checkbox up front. Phone step (`/complete-profile`) is blocking for Google students without a number. Needs a dev/production build, not Expo Go.
- Email OTP: resend cooldown, 10-minute expiry line, client-side attempts-left count (the API does not return it), lock on `TOO_MANY_ATTEMPTS`, Gmail/Hotmail typo banner with "change email" (PATCH /me). Shown once after email sign-up, skippable; `<VerifyEmailBanner />` is available for Home/Apply.
- Turnstile token is single use: widget resets after every submit. `CAPTCHA_FAILED` triggers a `/config` re-read in case the flag changed.

For other agents
- Use `useFeature('ai')` / `useFeatures()` from `@/config/features`. `src/api/useFeatureFlags.ts` (AI module) still works and can be switched over later.
- Resume entries can have `kind: 'file'` with `url: null`; `student/profile/resumes.tsx` and apply/officer views that print `r.url` must handle that and open files via `fileUrl(fileId)`. Not patched here (owned by another pass). Mount `<ResumeUploader />` there and `<LogoUploader />` in the drive stepper (see `src/features/uploads/README.md`).

Not done / limits
- No Google "G" logo asset (plain outlined button, label "Continue with Google"); Google branding rules may ask for it before Play review.
- The Turnstile WebView needs a hostname the widget accepts (`EXPO_PUBLIC_TURNSTILE_BASE_URL`); local dev with real keys will fail with Cloudflare error 110200 unless localhost is on the list. Use Cloudflare's test keys locally.

## Recruiter UI pass
Scope: new role group `app/(recruiter)/**`, `app/(auth)/recruiter-invite.tsx`, `src/features/recruiter/**`, `src/api/recruiter.ts` + `recruiterTypes.ts`. Built against `server/docs/pipeline-api.md`. Verified in `/tmp/work/app-recruiter` (current outputs tree + these files): `npx tsc --noEmit` 0 errors, `npx expo export --platform android` OK. Not run on a device or emulator or against a live server; 360dp / 1.3x font checks are by construction (wrapping rows, `minWidth: 0`, no fixed text widths).

Screens
- Tabs: Drives, Candidates, Messages, Profile. Candidates and Messages show the drive picked in a `Select` (kept in memory in `selection.ts`); drive detail sets it.
- Onboarding: `(auth)/recruiter-invite` accepts a bare token or the shared link (`placementos://recruiter-invite?token=...`), calls `/auth/recruiter-invite/lookup`, shows company/role/email/expiry, then the register form (name, 10-digit mobile, password, terms; same validators as student register). Maps `INVITE_INVALID`, `INVITE_EXPIRED`, `PHONE_TAKEN`, `EMAIL_TAKEN`. Welcome has "I have a recruiter invite". Login is the normal login.
- Drives list and drive detail (funnel tiles, decisions, status counts, per-round counts, links to the sub-screens).
- Candidates: debounced search, decision chips, Filters sheet (status, round, status in round, sort), multi-select with bulk shortlist/reject behind a confirm sheet (reject needs a reason; max 100; per-row failures listed), pagination, pull to refresh.
- Candidate detail (tabs Profile / Evaluate / Notes / Progress): ONLY the apply-time snapshot (`fields` + `fieldKeys` + verification badge) and the answers; resume opens through `.../resume` with a fresh signed URL on every tap; working decision; notes (team/private, delete own); blind scorecard (round picker, rubric-driven 1-5 ratings, recommendation, confirm, edit own, "N hidden until you submit", others revealed from the server response); propose select/reject outcome; offer status + propose offer; rounds and status history.
- Rounds and attendance: rounds list, round screen with status tabs and counts, per-candidate present/absent/passed/failed/on hold (permission-gated), bulk present/absent, attendance code (shown once).
- Interview slots: list, propose slot sheet (IST pickers, length, mode, venue/link, seats), cancel with reason; Approve button exists but renders only for role officer (server: approve is officer-only; recruiter proposals stay "Awaiting officer approval").
- Offers: list with status, tier, policy badge and reasons; "ready for an offer" list; offer form with live (debounced) `/pipeline/offers/policy-check` banner (allowed / needs override / blocked, send disabled when blocked), server re-check on submit, stipend drives skip the policy check.
- Messages: drive thread (newest at bottom), `clientId` idempotency so a retried send does not duplicate.
- AI: `CandidateSummaryCard` (Profile tab) and `QuestionSetEditor` (Evaluate tab) from `@/features/ai`, shown only when `features.ai` is true; `CANDIDATE_NO_AI_CONSENT` is rendered by their own error banner ("Candidate has not opted in").

Routing and guards
- `Role` gained `'recruiter'`; `RegisterBody.role` is `Exclude<Role,'recruiter'>` so the public register can never send it.
- `app/index.tsx`, root `Gate` in `app/_layout.tsx`: recruiter -> `/(recruiter)/(tabs)`; any recruiter on a student/officer/auth route is redirected back, and student/officer on `(recruiter)` are redirected to their own group (the existing `group !== own` rule). Push taps for recruiters open the drive.
- `(recruiter)/_layout.tsx` also renders nothing but a redirect unless role is `recruiter`, and gates the whole area on `features.recruiter` from `useFeatures()` (`@/config/features`): loading skeleton, "could not check settings" retry when `/config` failed, "not enabled" message with Sign out when the flag is off.
- Terms/Privacy for recruiters live at `(recruiter)/legal/*` because `(auth)` routes are bounced by the root guard once signed in.

Shared files patched (minimal): `src/api/types.ts` (Role, RegisterBody), `app/index.tsx`, `app/_layout.tsx` (three one-line recruiter branches), `app/(auth)/welcome.tsx` (one ghost button).

Notes and open items
- `POST /pipeline/slots/:id/approve` is officer-only per the API doc, so recruiters cannot approve slots; the approve hook exists for an officer pipeline view to reuse.
- The recruiter can create offers only for `selected` candidates (server rule); the form shows the policy result but the server stays the authority.
- Round results/advance/waitlist/rubric/settings editing are officer configuration and are not in the recruiter UI. Recruiters record results per candidate on the round screen.
- Candidate list `status=selected` is used to build "Ready for an offer"; it shows the first 30 only.
- Local verification needed `expo-web-browser`, `expo-auth-session`, `react-native-webview` installed with `--no-save` because the auth agent's files import them but `package.json` in outputs did not list them yet; add them to `package.json` before the final build.

## Pipeline UI pass
Scope: hiring-pipeline screens for students and officers (API: `server/docs/pipeline-api.md`). Recruiter-role screens are not part of this pass. New API code: `src/api/pipeline.ts` (functions, query keys, hooks, friendly error-code messages) and `src/api/pipelineTypes.ts`. Screens reuse the design system (`@/ui`, `@/theme`) and the student `Page`/`useOnce`/`confirm` kit; no raw hex, no slide/scale/pop animation, no drag handles. Verified in a copy of the CURRENT outputs tree plus my files (`/tmp/work/app-pipe-verify`): `npx tsc --noEmit` 0 errors, `npx expo export --platform android` OK (Hermes bundle 7.4 MB). Not run on a device or emulator; 360dp / 1.3x font are by construction (wrapping rows, buttons in `flexWrap` rows, sheets scroll).

Student
- Application detail: new "Hiring rounds" tracker (`RoundTracker`, GET /pipeline/applications/:id/rounds) with a status badge per round (icon + text), waitlist note, "result awaited" until the cell publishes, and the cell's rejection note from the timeline on a not-passed round. Rows lead to slots and attendance.
- `application/[id]/slots`: list open slots grouped by round, book with a confirm dialog, current booking card, Reschedule (releases the booking after a confirm, then the list unlocks), Cancel with optional reason. Server conflict codes (SLOT_FULL, ALREADY_BOOKED, CANDIDATE_BUSY, CANCEL_WINDOW_CLOSED, NOT_IN_ROUND, SLOT_NOT_OPEN, SLOT_STARTED) show plain-language text in a Banner; stale-slot errors refetch the list.
- Offer card (`OfferCard`, GET /pipeline/applications/:id/offer): pay breakdown, joining date, location, letter link, expiry countdown from server time (`getServerOffsetMs`), Accept/Decline through the existing `POST /applications/:id/respond` after a native confirm dialog. Buttons disappear when the server-time clock passes `expiresAt`; OFFER_EXPIRED is handled. When no pipeline offer exists the old respond card is unchanged.
- `(student)/attendance`: scan with `expo-camera` (QR only, one scan in flight, pauses after a result), permission states (loading, ask, denied with "Open settings"), manual code entry fallback, offline banner, success / replayed / error results with the server's reason.

Officer (all under `app/(officer)/drive/[id]/`, entry: "Hiring pipeline" row on the drive detail for non-draft drives)
- `pipeline`: hub with funnel (applications by status, per-round progress and counts, recruiter decisions, offer counts) and links.
- `recruiters`: invite with permission checklist (one-time invite code shown with Share), resend (new code), revoke invite, edit permissions, revoke access with optional reason, "show revoked".
- `rounds`: add / edit / delete, reorder with Move up / Move down (full-order POST, buttons lock while saving), publish results with confirm.
- `round/[roundId]`: candidate list with status tabs (counts), multi-select, bulk Mark present, More actions (invite, absent, passed / not passed / on hold via results API, waitlist, promote), Add screened candidates, Upload results (paste `reference, result, score, remark`, line-level validation, per-row failures), Advance (preview, then confirm with an idempotency key reused on retry), Attendance QR sheet (create, QR via `react-native-qrcode-svg` plus the code as text, share, revoke).
- `rubric` (drive or per round, up/down/remove, unsaved-changes guard), `slots` (approve, decline with reason, cancel with reason, create), `offers` (tabs, create with policy check and override reason, approve with re-check, reject, revoke, mark joined), `outcomes` (approve with confirm, decline with note).

Dependencies added (shared files)
- `expo-camera ~58.0.14`, `react-native-svg 15.x`, `react-native-qrcode-svg ^6.3.54` in `package.json` / `package-lock.json` (additive only); `expo-camera` config plugin with camera permission text in `app.json`. These are native modules: a new dev build / EAS build is required (Expo Go on SDK 58 may not include them).

Notes / not done
- Pipeline settings (auto-accept slot proposals, blind scorecards, cancel cut-off) have no UI; defaults apply. Round `assessmentId` link is not exposed in the round form. Slot edit/reschedule (PATCH) is not exposed; officers cancel and recreate. Panelists default to the creating officer.
- Invite code is shared as text; there is no deep link because the recruiter registration route belongs to the auth / recruiter work.
- The student drive detail was not changed; the per-application tracker lives on the application screen.
- Outcome and offer lists read `candidate.name` / `candidate.applicationReference` defensively because the doc does not spell out the candidate summary shape for outcomes; falls back to "Candidate".

## Student tests UI pass

Scope: student test-taking (MCQ + coding) and practice, against `server/docs/assessments-api.md` (`/my/assessments*`, `/attempts/*`, `/practice/*`). Gated by `features.assessments` (all entry points, list, detail, practice) and `features.codeExecution` (practice problems; Run / Submit code are disabled with an explanation only when the config loaded and the flag is off). The test runner itself is never gated by config, so an attempt in progress stays usable offline.

New files
- API: `src/api/tests.ts` (client functions, TanStack hooks, `useTestsFeatures` / `useTestsEnabled`, error helpers), `src/api/testsTypes.ts`.
- Feature code `src/features/tests/`: `useAttemptSession.ts` (runner engine), `QuestionView.tsx`, `CodingPanel.tsx` (shared by attempts and practice), `CodeEditor.tsx`, `RunnerParts.tsx` (save indicator, palette, submit summary, nav buttons), `Gate.tsx`, `kit.tsx` (formatting, light markdown, verdict badges), `store.ts` (device persistence via expo-file-system), `TestsHomeCard.tsx`.
- Routes `app/(student)/tests/`: `_layout` (own stack, swipe-back off for the runner), `index` (My tests: Live / Upcoming / Completed, resume banner), `[id]` (detail: window by server time, rules, sections, instructions, attempts, start/resume with read-the-rules checkbox), `attempt/[attemptId]` (runner), `result/[attemptId]`, `practice/index` (coding problems with search and filters, practice sets), `practice/problem/[id]`.

Shared files patched (minimal, 2-3 lines each)
- `app/(student)/(tabs)/index.tsx`: import + `<TestsHomeCard />` under the AI card.
- `app/(student)/(tabs)/prepare.tsx`: import + `<TestsHomeCard />` at the top of the Prepare tab.
- `app/(student)/(tabs)/profile.tsx`: `useTestsEnabled()` and one conditional "Tests and practice" row.

Runner behaviour
- Clock: `offset = serverNow - deviceNow` refreshed from every response (start, GET attempt, autosave, foreground resync); remaining = `deadlineAt - (now + offset)`, shown with `TestTimerBar`; a second line shows the section clock for timed sections.
- Autosave: edits queue per question (answer and flag, strictly increasing `clientTs`), debounced (0.7 s text, 1.5 s code, 0.3 s flags), batches of 20 to `PUT /attempts/:id/answers`; the queue is mirrored to a file so an app kill or lost connection keeps unsent edits; retry with back-off, on reconnect and on foreground. Indicator states: saved / saving / saving soon / offline (N waiting) / error. `stale` and `rejected` (SECTION_CLOSED) are handled; a 400 drops only the offending item.
- Resume: opening `GET /attempts/:id` rebuilds everything from the server, then re-applies device edits that are newer than the server's `savedAt` (clock-corrected) and flushes them.
- Sections: with any timed section the attempt is sequential; only the entered, unlocked section is navigable, "Next section" asks for confirmation then calls `/sections/:id/enter`; `SECTION_NOT_NEXT` refreshes the state; when a section clock ends the next one opens automatically.
- Palette: answered / marked for review / seen-not-answered / not visited, each with an icon and a legend (not colour only), locked sections shown as locked. Submit summary: totals, per section, flagged, coding answers never sent through "Submit code" (they are judged automatically at submit), offline warning.
- Auto-submit at the server deadline (retried every 4 s until the server confirms, pending answers sent in the body); 409 DEADLINE_PASSED / ATTEMPT_ALREADY_SUBMITTED reload the state and go to the result.
- Proctoring is event logging only: `focus_lost` (inactive), `app_background`, `focus_regained`, `network_offline` via AppState/NetInfo, de-duplicated with `eventId`, retried when offline; warning banner with server warning count / max and a local "times you left" count. Screenshots and recording are never blocked.
- Coding: tabs Problem / Code; language picker with per-language buffers; plain monospace `TextInput` with Tab / outdent / bracket helper keys and Enter auto-indent; Run on samples or custom stdin showing stdout, stderr, compile errors, time and memory; Submit code showing per-sample pass/fail and masked hidden tests (counts only), best result kept; `503 CODE_EXECUTION_UNAVAILABLE` shows "Queued, will be evaluated" for submit and "runner unavailable" for run; 429 shows the server message. Unsaved-code safeguards: edits go through the persisted queue, "edited since last submission" hint, leave confirmation in the runner (Android back) and for practice problems, practice drafts stored on the device per problem and language.
- Result: handles `available:false` (AFTER_CLOSE / MANUAL / EVALUATION_PENDING), `evaluation: pending` (polls every 4 s), score, rank, percentile, time, warnings, section breakdown with cutoffs, coding verdicts, and expandable answer review when the server provides it.

States: every screen has skeletons, empty, error with retry, and offline handling; touch targets are 48dp or larger; text wraps (no fixed-height text); no animations added (Sheet fade only, as in the design system).

Verification (in a scratch copy): `tsc --noEmit` 0 errors; `npx expo export --platform android` OK. Not exercised against a live server or a device/emulator.

Notes for later
- The 503 CODE_EXECUTION_UNAVAILABLE body also carries a pending submission id; `ApiError` does not expose the body, so the app relies on the status code only.
- Review `correctAnswer` / `yourAnswer` formatting follows the documented shapes (option ids, numbers, strings); coding review shows verdicts only.
- Practice sets start with `POST /my/assessments/:id/start` and reuse the runner; the practice flag on the attempt is not used for anything special in the UI.
- `useFeatureFlags` returns an empty object on failure, so entry points hide when `/config` cannot be reached.

## Officer assessments UI pass

Scope: officer side of `server/docs/assessments-api.md` (question bank, test builder, results). Everything sits behind `features.assessments` from `GET /config`: the `assessments/_layout.tsx` shows a skeleton while loading, an error with retry if the flag check fails, and an empty state when the flag is off. Entry points are hidden in the same cases.

New files
- API: `src/api/assessments.ts` (TanStack hooks, cache root key `assess`), `src/api/assessmentsTypes.ts`.
- Shared UI: `src/features/assessments/` with `kit.tsx` (Frame, ToggleRow, FlatBar, labels, helpers), `questionForm.ts` (form state, client validation mirroring the server, payload builder), `ImportSheet.tsx`, `sheets.tsx` (RegradeSheet, KeyFixSheet), `builder/model.ts`, `builder/steps.tsx`, `builder/pickers.tsx`.
- Routes `app/(officer)/assessments/`: `index` (tests list), `questions/index` (bank), `questions/[id]` (create/edit, `new`), `builder/[id]` (6-step stepper, `new`), `[id]/index` (detail and actions), `[id]/preview`, `[id]/results`, `[id]/attempt/[attemptId]` (answer sheet and override), `[id]/analytics`, `[id]/plagiarism`, `[id]/shortlist`.

Behaviour notes
- Question bank: search, filter sheet (type, difficulty, topic, tag, active/archived/all, practice), archive, restore, duplicate, delete (409 `QUESTION_IN_USE` explained), create/edit for MCQ single/multi, numeric, short text and coding (languages, sample and hidden tests with weights, limits, comparison mode, starter code per language, reference solution). Server `fields` errors are mapped onto inputs. Import: document picker (.csv/.json), 200-row / 80 KB chunks, dry-run preview with row errors, confirm, template share. "Generate with AI" shows only when `features.ai` is on and reuses `McqGenerateSheet` (it handles 501 `QUESTION_BANK_NOT_LINKED` itself).
- Builder: Details, Questions (sections, pick from bank, auto-pick by topic/difficulty/type with a preview before adding, per-question marks, reorder), Rules (negative marking, cutoff, bulk marks, shuffle, attempts, ranking, review, proctoring maxWarnings/autoSubmit), Audience (drive applicants + statuses, eligible, specific students, cohort, all; live preview count and sample), Schedule (IST pickers, result visibility), Review (local checks plus inline `NOT_PUBLISHABLE` field errors that jump to the owning step). Next and Save draft persist to the server; leaving with unsaved changes asks first. Published tests: live-settings sheet (instructions, later close time, visibility, review, maxWarnings only), refresh audience, clone, archive, preview.
- Results: leaderboard with ranks, search, filters and sort, flags (plagiarism, override, auto-submit, proctor), answer sheet with code and judged submissions, score override with reason (and removal), answer-key fix then regrade with confirm and optional re-judge, plagiarism pairs, analytics as flat bars, publish/unpublish with confirm, CSV export via expo-file-system + expo-sharing, shortlist with dry-run preview then confirm (preview invalidated when inputs change, 409 `EVALUATION_PENDING` handled).
- Design: tokens and `@/ui` only, no animations added, 48dp targets, text wraps, loading/empty/error/offline everywhere, double-submit locks via async `Button` / `useOnce`.

Shared files patched (minimal, flag-gated rows)
- `app/(officer)/(tabs)/more.tsx` and `app/(officer)/(tabs)/index.tsx`: one "Tests and question bank" row each.
- `app/(officer)/drive/[id].tsx`: "Online tests" (list filtered to the drive) and "Create test for this drive" rows.

Limits and gaps
- Analytics: the API gives difficulty index, correct percent and attempt rate per question but no discrimination index, so none is shown.
- "Attach to a round": assessments link to a drive only (no round id in the API); the shortlist step moves the drive's applications to a chosen status instead.
- The tests list filters by drive on the client (the list endpoint has no drive filter); it keeps loading pages while that filter is active.
- Audience for `students` is picked from the first search pages of `/students`; cohorts need a cohort id typed in.
- Not exercised against a live server or device; verified with `tsc --noEmit` (0 errors in the scratch copy) and `expo export --platform android` (OK). The integrated outputs tree type-checks apart from missing packages other agents added (expo-camera, react-native-svg, qrcode) in this scratch install.

## Officer operations UI pass

Scope: officer Operations hub and ten sections against `server/docs/ops-api.md`. Verified in a scratch copy (`/tmp/work/app-ops`): `tsc --noEmit` 0 errors, `npx expo export --platform android` OK. **Not run on a device or against a live server.**

New files
- `src/api/ops.ts`, `src/api/opsTypes.ts` (all calls, hooks, types; exports use `apiGetText`).
- `src/features/ops/`: `kit.tsx` (OpsPage, Async states, ConfirmSheet, BarRow, IST date helpers, share helper), `routes.ts`, `policyForm.ts`, `ConditionEditor.tsx`, `CohortForm.tsx`, `StudentPicker.tsx`, `restrictionParts.tsx`, `annParts.tsx`, `crm.ts`.
- Screens under `app/(officer)/ops/`: `index` (hub, with pending appeal/document badges), `analytics`, `policy/{index,[id],conditions,version/[vid]}`, `restrictions/{index,new,[id]}` (appeals tab and decide sheet), `cohorts/{index,new,[id]}`, `announcements/{index,compose,templates,[id]}`, `calendar`, `companies/{index,new,[id]}` (`new?id=` edits), `audit`, `documents`, `settings`.

Shared file patched (one line)
- `app/(officer)/(tabs)/more.tsx`: "Operations" `ListRow` at the top of the Manage card (pushes `/(officer)/ops`). Re-applied on top of the current outputs version (which now has the Tests row).

Behaviour notes
- Analytics: selected, offers, accepted and joined are separate rows (students and applications each); flat View bars for funnel, branch, CTC bands, reminders; filters (batch, department, from/to in IST) with Apply; export any dataset as CSV/JSON through the share sheet; report pack shared as a text summary and as full JSON.
- Policy: version screen edits all policy fields, Validate (`validate-draft`), Simulate (impact bars + samples), approve, activate (opens an automatic impact preview first; a future `effectiveFrom` makes it "Schedule activation"), rollback and clone from the policy page. Approve/activate buttons follow `policyApproval`. "Draft defaults with AI" appears only when `features.ai` is on, calls `POST /ai/policy/draft`, and only fills the five default fields after review (department/batch limits it returns are reported as not applied). Condition builder (nested all/any/not, depth 6, 50 nodes, no drag) validates through `validate-conditions` and shares JSON.
- Restrictions: `SELF_APPROVAL` message is shown on the detail screen; appeals decided from the Appeals tab or the restriction.
- Announcements: audience (all, cohort, drive participants, eligible-not-applied), channels, send now / schedule / draft, pin, expiry, templates, read receipts, edit/delete before send, `AnnouncementDraftButton` when AI is on.
- Calendar: month grid + 30-day list; ICS feed link create (shown once), share/copy via share sheet, revoke.
- Dates are typed as YYYY-MM-DD and HH:mm in IST (no date-picker package in `package.json`).

Not done / limits
- Report pack is text + JSON, not PDF (no print/PDF package installed).
- Link copy uses the share sheet (no `expo-clipboard`).
- The condition builder is a standalone tool; it is not embedded in the drive stepper (owned by another pass), the officer pastes the JSON into `rules.extra`.
- Document "View" opens the file/link with the system (`Linking`); no in-app viewer.
- `GET /company-directory` and `/stats/public` (student-facing) are not used.

## Student extras UI pass
Scope: student extras and cross-module wiring (APIs: `server/docs/ops-api.md` student sides, `server/docs/integrations-api.md` files). New API code: `src/api/studentExtras.ts` (functions, query keys, hooks) and `src/api/studentExtrasTypes.ts`. Screens use `@/ui`, `@/theme` and the student `Page` / `QueryBoundary` kit; flat, no slide/scale/pop animation, no decorative shapes, 48dp targets, loading / empty / error / offline states. Each feature is hidden unless its server flag from `GET /config` is on (`opsRestrictions`, `opsAnalytics`, `opsCalendar`, `opsDocuments`, `assessments`, `ai`, `fileUploads`). Verified in a copy of the CURRENT outputs tree plus my files (`/tmp/work/extras-stage`): `npx tsc --noEmit` 0 errors, `npx expo export --platform android` OK. Not run on a device; 360dp / 1.3x font by construction (wrapping rows, `flexWrap` button rows, no fixed-height text).

A. Wiring leftovers
- `profile/resumes`: file resumes (`kind:'file'`, `url` null) show file name and size with a File/Link badge, "Open" uses `fileUrl(fileId)` (fresh 300 s signed url, never cached) and `Linking.openURL`; `<ResumeUploader/>` mounted (disabled at 5 resumes; hidden when `fileUploads` is off, the link form stays); link to the resume builder.
- Apply screen: file resumes labelled "Uploaded file" in the picker; `<VerifyEmailBanner/>` mounted; `EMAIL_NOT_VERIFIED` (action to `/verify-email`, preview re-runs when the student returns), `PHONE_REQUIRED` (inline sheet to add the number via `PATCH /me`, then the preview re-runs) and `RESTRICTED` (reason plus "View reason and appeal") are handled both from the preview (`blockedCode`, or drive eligibility `restricted`) and from the submit error, with a fix-it action in the sticky footer.
- Officer drive applicants: "Resume" button per applicant uses `GET /applications/:id/resume-url` (works for files and links). The officer views did not print `r.url` anywhere, so nothing else needed changing.
- Officer drive stepper company step: `<LogoUploader/>` mounted; `company.logoFileId` is sent only after the officer picks or removes a logo (undefined leaves it unchanged); `LOGO_PUBLIC_URL_NOT_CONFIGURED` shows plain text in the save error.
- `<VerifyEmailBanner/>` also on student Home.

B. Restrictions and appeals
- `RestrictionBanner` on Home (from `GET /my/restrictions`), "Restricted" badge on drive cards, restricted banner and CTA on drive detail (eligibility status `restricted`).
- `(student)/restrictions` ("My restrictions", Profile row): respectful message, scope, duration (IST), appeal form (10-1000 chars, `APPEAL_EXISTS` handled), appeal status badge and decision note; opened with `?id=` from the apply screen.

C. Stats and calendar
- `(student)/stats`: `GET /stats/public`; `enabled:false` empty state, totals, salary figures or a privacy note when `ctc` is null, branch and batch lists, suppressed groups explained with the server's `minGroupSize`.
- `(student)/calendar`: combined `GET /calendar` list (the endpoint is student accessible), 7/30/90 day range, grouped by IST day, rows open the application or drive. ICS subscribe: create (shown once, absolute url built from `API_URL`), open via `webcal://`, share, regenerate, revoke.

D. Resume builder (`(student)/resume-builder`, `src/features/resumeBuilder/`)
- Prefilled ONLY from the profile (name, email, phone, city, links, university/program/department/batch/CGPA/10th/12th, skills). Summary, projects, experience and achievements start empty. Two flat single-column ATS templates (Classic, Compact), live preview (WebView of the exact PDF HTML), PDF via `expo-print` + `expo-sharing`, "Save to my resumes" through the R2 upload flow (`startUpload` + `POST /profile/resumes`) when `fileUploads` is on, otherwise share only. Draft kept in app-private storage per user; "Start over" clears it. All text is HTML-escaped.

E. Prep hub (`(student)/prep`, entry on the Prepare tab and Home): resume builder, Practice problems (`/(student)/tests/practice`), AI mock interview and resume review (`/(student)/ai/...`), upcoming test entries from `GET /my/assessments?bucket=upcoming`. Plain string `router.push` paths, no imports from other modules, each row behind its flag.

F. Verification status (`(student)/verification`, Profile row): per-field verification from `GET /profile` plus documents from `GET /documents/mine` (status, reject reason). Change history is not exposed by any student API, so there is no history view.

Shared-file patches (minimal): `package.json` + `package-lock.json` (`expo-print ~58.0.8`, additive), `api/types.ts` (`EligibilityStatus` + `'restricted'`), `ui/Patterns.tsx` and `student/discover/helpers.ts` (restricted badge/label), student `index.tsx`, `prepare.tsx`, `profile.tsx`, `apply/[id].tsx`, `drive/[id].tsx`, `profile/resumes.tsx`, officer `drive/[id].tsx`, `officer/types.ts`, `officer/data.ts`, `stepper/steps.tsx`, `stepper/DriveStepper.tsx`.

Notes / not done
- `expo-print` is a native module: a new dev or EAS build is needed (Expo Go on SDK 58 may not include it). The preview uses `react-native-webview` which is already a dependency.
- Test and practice destinations (`/(student)/tests`, `/(student)/tests/practice`) belong to the assessments agent; if they are renamed the two paths in `prep.tsx` change.
- Officer student detail does not list a student's resumes, so it needed no file handling. Deleting a file resume removes the entry; the server frees the file per its own rules.
- The resume preview scaling relies on the WebView viewport (794 px page width); not seen on a device.

## Student bug pass

Static review of student, auth, verify-email and complete-profile screens at 360dp / 1.3x font. tsc 0 errors; expo export (android) OK. 24 files changed, no officer or recruiter files touched.

Fixed:
- discover/helpers.ts: useSaveToggle left a stale optimistic override that hid un-saves made elsewhere; cleared after success.
- me/kit.tsx, pipeline/kit.tsx: 'Not taken forward' unified to 'Not selected'.
- pipeline/kit.tsx, discover/questions.tsx, studentExtras/restrictions.tsx, application/[id]/index.tsx, support/NewTicket.tsx, support/ThreadView.tsx, ai/mock-interview/[id].tsx: duplicate character counters removed (TextField already shows one).
- drive/[id].tsx: missing eligibility or ctc block crashed or showed 'not eligible'; now null-safe.
- ApplyGate.tsx: phone sheet errors were toasts hidden behind the modal; now inline.
- ThreadView.tsx: null author crash.
- profile/edit-identity.tsx: unchanged invalid fields blocked saving other fields; stale 'no email verification' copy corrected.
- (tabs)/profile.tsx: next step printed as [object Object]; resumes subtitle corrected.
- (tabs)/prepare.tsx, legal/LegalScreen.tsx, settings/account.tsx: stale copy (links-only resumes, no password reset).
- eligibility.tsx: restricted drives vanished from every tab; added Restricted group, hid Dispute for them.
- tests/[id].tsx, tests/result/[attemptId].tsx, practice/index.tsx, practice/problem/[id].tsx: null-safe sections, attempts, proctoring, languages, difficulty, best percent.
- api/tests.ts: practice search lost keyboard focus on every debounced query (added keepPreviousData).
- ai/chat.tsx: double-send guard.
- ai/mock-interview/[id].tsx, ai/resume-review.tsx: null-safe report arrays and score.

Left:
- RootBanner (app/_layout.tsx) can add an empty top inset strip while offline when a screen banner also shows.
- recruiter-invite extractToken: decodeURIComponent may throw on malformed input.
- Toasts show behind Sheet modals in general.
- calendar.tsx fixes `from` at mount; apply screen has no unsaved-answers guard; ai/chat scrollToEnd can yank scroll; drive detail footer hint numberOfLines=3 may clip; slots ReasonSheet uses booking!.roundId.
- Not reviewed in depth: resumeBuilder/*, pipeline/student/*, uploads/*, tests/{QuestionView,CodingPanel,CodeEditor}.
- Officer: app/(officer)/drive/[id]/outcomes.tsx:38 still says 'not taken forward'.

## Recruiter/AI/Tests bug pass

Static review at 360dp / 1.3x font scale (no device or live server was available). Overlapping AI/tests files were merged with the student agent's concurrent edits.

### Test / coding runner
| File | Issue | Fix |
|---|---|---|
| src/features/tests/useAttemptSession.ts | Clock offset skewed by request latency | Offset uses request midpoint on load and flush |
| same | Restored pending edits not flushed after resume | Debounced flush once phase is ready |
| same | MCQ/flag changes lost if app killed before debounce | Persist at once for mcq/flag, debounce for typing |
| same | Double section entry | enteringRef guard in enterNext |
| same | Device clock tampering / drift auto-closed sections | confirmExpired re-reads the attempt (throttled 3s) before auto-entering next section or locking |
| same | Long offline past deadline kept editing | lockedOffline state (15s past deadline); hook returns locked |
| same | Submit with big queue or closed section failed | Flush first if >100 pending; retry once with [] on SECTION_CLOSED/400 |
| same | Proctor event spam | network_offline throttled to 1 per 20s, queue capped at 200 |
| same | Pending edits lost on unmount | Final persist and flush in cleanup; alive ref reset in effect |
| app/(student)/tests/attempt/[attemptId].tsx | Footer covered by keyboard, editor dismissed on drag | kbOpen hides footer, Screen keyboard, keyboardDismissMode none for coding |
| same | Stale test list after finish; error state dead end | Invalidate tk.all; "Back to my tests" button |
| same | Wrong total, misleading warning title, readOnly ignoring offline lock | summary.total, clearer title, readOnly uses s.locked, proctor fallback |
| src/features/tests/CodingPanel.tsx | Large/null output, double run, language change mid-run | Null-safe clip() reporting cut characters, busyRef guard, read-only language text when busy |
| src/features/tests/QuestionView.tsx | iOS numeric keypad lacked minus/decimal | numbers-and-punctuation on iOS |
| src/features/tests/RunnerParts.tsx | NavButton label clipped | numberOfLines 2, centred |
| app/(student)/tests/practice/problem/[id].tsx | Refetch overwrote typed draft; keyboard covered editor | Restore draft once, keyboardDismissMode none, Screen keyboard |
| app/(student)/tests/result/[attemptId].tsx | undefined treated as value (rank, percentile, cutoff, passed) | != null checks |

### AI
| File | Issue | Fix |
|---|---|---|
| src/api/ai.ts | Stream could hang forever | 45s idle timeout with AI_TIMEOUT error |
| app/(student)/ai/chat.tsx | History load could overwrite a started turn; composer editable lock; draft bubble hid Copy/Share from screen readers | Race guard, openingOld gate on send, no editable toggle, accessible only when not a draft |
| app/(student)/ai/mock-interview/[id].tsx | STALE_QUESTION refetch did not reseed; report crashed on missing parts | seeded reset, filter missing parts |
| app/(student)/ai/resume-review.tsx, mock-interview/index.tsx | Keyboard covered inputs | Page keyboard |
| src/features/ai/QuestionSetEditor.tsx | State leaked across applications; stored set not reopened; stale list | Reset on applicationId, auto-reopen latest set, invalidate on adopt, rubric null-safe |
| src/features/ai/CandidateSummaryCard.tsx | Null crashes | Optional chaining, ?? [] |

### Recruiter
| File | Issue | Fix |
|---|---|---|
| src/features/recruiter/CandidateList.tsx | Blind scorecards leaked average and score sort | Hide average and score sort while blind |
| app/(recruiter)/drive/[id]/candidate/[appId].tsx | Average shown in header when blind; null scorecards | Hidden when blind, ?? [] |
| app/(recruiter)/drive/[id]/round/[roundId].tsx | avgScore leak when blind; every tap minted a new code | Hidden when blind; reuse live code, confirm before making a new one |
| src/features/recruiter/panels.tsx | Snapshot card could show non-shared fields; note deleted without confirm | Restricted to fieldKeys; Alert confirm |
| src/features/recruiter/MessageThread.tsx | Idempotency key reused for edited text | clientId bound to exact body |
| app/(recruiter)/drive/[id]/offer-new.tsx | Stipend capped too low, stale CTC, stale policy error | 7 digits, memo deps, clear error |
| app/(auth)/recruiter-invite.tsx | Malformed link crashed decodeURIComponent | try/catch |

### Left / notes
- Server should also withhold avgScore and scoreSummary.avg when blindScorecards is on (client only hides them).
- Shared Select is single-line and has no disabled prop (shared UI, not edited).
- iOS has no leave action in the runner (swipe-back off by design); iOS inactive events count as "left".
- Abandoned attempts leave placementos-attempt-<id>.json on disk.
- Message thread polls every 30s in the background.
- No screenshot blocking, hard-coded colours or banned animations found in scope.
- Nothing was run on a device or live server.

## Officer bug pass

Static pass over every officer screen (routes, features/officer, ops, assessments, pipeline/officer) at 360dp and 1.3x font. `tsc --noEmit` = 0 and `expo export --platform android` OK after the changes. 29 files changed; about 30 bugs fixed.

Fixed
- features/officer/data.ts + drive/[id]/index.tsx: applicants list read only the first 50 and ignored nextCursor; now an infinite query with end-reached and a Load more / Retry footer.
- drive/[id]/index.tsx: moving an applicant to Rejected or Offer declined had no confirm; Publish drive had no confirm; work mode shown as raw value, now On-site / Hybrid / Remote.
- (tabs)/approvals.tsx: Publish had no confirm; the students auto-fetch effect looped on a failed request (added `!isError`).
- (tabs)/students.tsx: same auto-fetch retry loop on error.
- drive/[id]/round/[roundId].tsx: bulk Invite and Promote from waitlist had no confirm.
- drive/[id]/offers.tsx + components/pickers.tsx: "Mark joined" date picker blocked past dates; added `allowPast`; iOS spinner now also respects the minimum date.
- stepper/DriveStepper.tsx: edits typed during an autosave were marked clean (dirty race); publish gate showed raw field keys; save-failure toasts had no error tone; discarding an autosaved draft left the drives list stale.
- stepper/fields.tsx + steps.tsx: monthly stipend could not exceed 9,999 (4 integer digits); added `intDigits` (7 for stipend).
- stepper/review.tsx: work mode shown as raw value.
- assessments/builder/[id].tsx: adopting server section ids made the form look unsaved; concurrent saves could create duplicate drafts (now one in-flight save); hardware / swipe back skipped the unsaved guard; drives auto-fetch retried on error.
- assessments/builder/steps.tsx: section cutoff field dropped the decimal point while typing (2.5 was impossible).
- assessments/questions/[id].tsx: no unsaved-changes guard.
- assessments/kit.tsx: offline banner was edge to edge with no margins inside unpadded screens; Switch thumb used a raw hex.
- assessments/sheets.tsx: Regrade sheet could be closed while the regrade was running.
- assessments/[id]/index.tsx, questions/index.tsx: difficulty shown as raw "easy/medium/hard" in subtitles, chips and accessibility labels.
- assessments/[id]/shortlist.tsx: draft drives were offered as the shortlist target.
- assessments/[id]/attempt/[attemptId].tsx: only the first underscore of submit reason was replaced.
- assessments/[id]/results.tsx: rank column had a fixed width of 44 and clipped large ranks at 1.3x.
- student/[id].tsx: null application status would crash the badge.
- announce.tsx: sending to all students had no confirm, no unsaved guard, unknown server field errors were hidden, and drive audiences named only the company (now company and role).
- ops/announcements/compose.tsx: "Send now" had no confirm.
- ops/restrictions/new.tsx: tenant, department and batch restrictions had no confirm.
- ops/cohorts/[id].tsx, ops/policy/version/[vid].tsx: no unsaved-changes guard.
- ops/calendar.tsx: selected day stayed in the previous month after changing month; heading showed a raw ISO date; revoke-link failure was only a toast behind the sheet (now shown inside the sheet).
- import-students.tsx: IssueRow was defined inside the component, remounting every row on each render; hoisted.
- Toasts shown while a Sheet is open were invisible (Modal covers them). Another agent landed the same fix in src/ui/Toast.tsx + Sheet.tsx first, so those files were not touched here.

Left as is
- Calendar month grid day cells are about 42dp wide at 360dp (seven columns); cannot reach 48dp without dropping to a list, which the list view already provides.
- Drives (More) and a few ops lists show only the first page of drives in pickers beyond five pages.
- Slots Approve shows a spinner on every card while one approval runs (cosmetic).
- Company detail assumes `company` is present on some pipeline rows (null risk is low).
- Cohort ID is free text in the test builder audience step.
- Policy condition editor keeps a stale value when the field type changes (local validation catches it).
- Cohort member Remove has no confirm (reversible by re-adding).
