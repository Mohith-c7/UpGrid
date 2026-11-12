# Placement OS app (Expo, Android first)

One app, three roles. Students browse drives, check eligibility, apply and track applications; placement officers manage drives, rounds, applicants and verification; recruiters (invited by an officer) review candidates, rounds and offers for their drives. Talks to the API in `../server`.

## Install

```bash
cd app
npm install
cp .env.example .env        # then set EXPO_PUBLIC_API_URL
npm run typecheck           # expect 0 errors
npx expo-doctor             # optional
```

Package versions target Expo SDK 58 (`expo ~58`, React Native 0.88, React 19.3). If you change a dependency, run `npx expo install --fix` and commit the lockfile.

## Environment

All variables are `EXPO_PUBLIC_*`, read at bundle time and visible inside the app, so never put secrets here. Full list, with where to get each value, in `.env.example` and `INTEGRATIONS.md`.

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Required. API base including `/api/v1`, no trailing slash. Android emulator to local server: `http://10.0.2.2:4000/api/v1`. Physical device: your computer's LAN IP. |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `..._IOS_CLIENT_ID`, `..._WEB_CLIENT_ID` | Optional. Google sign-in; `app.config.js` registers the reversed ids as URL schemes, so changing one needs a rebuild. Empty = no Google button. |
| `EXPO_PUBLIC_TURNSTILE_BASE_URL` | Optional. https origin for the Turnstile widget WebView. |

For EAS builds set values in `eas.json` (`build.<profile>.env`) or with `eas env:create`. Replace `YOUR-RENDER-SERVICE` in `eas.json` with your API host first. After editing `.env`, restart with `npx expo start -c`.

## Run (development)

```bash
npm start            # Metro; press "a" for an Android emulator
```

Expo Go is not enough for push notifications or Google sign-in. Use a development build:

```bash
npm i -g eas-cli
eas login
eas init                                              # once; writes extra.eas.projectId into app.json
eas build -p android --profile development            # dev client APK, then `npm start`
eas build -p android --profile preview                # installable APK for testers
eas build -p android --profile production             # AAB for Play Store
```

Until `eas init` is run the app works normally and only in-app notifications appear.

## Demo logins (from the server seed, `server/src/seed.ts`)

| Role | Email | Password |
| --- | --- | --- |
| Officer | `officer@placement.demo` | `Officer@123` |
| Student (complete profile, eligible for most drives) | `aarav.sharma@students.demo` | `Student@123` |
| Student (partial profile) | `diya.patel@students.demo` | `Student@123` |
| Student (ineligible) | `rohan.mehta@students.demo` | `Student@123` |

The seed includes a demo recruiter: recruiter@placement.demo / Recruiter@123. To test real invites, sign in as the officer, open a drive, invite a recruiter, and accept the invite from the recruiter sign-up screen.

## First run checklist

See section 3 of `INTEGRATIONS.md`: confirm `GET /api/v1/config` shows the integration flags you expect, install a development build, try each flow once on a real phone (Google sign-in, Turnstile, resume upload), and watch the server log for `INVALID_GOOGLE_TOKEN`, `CAPTCHA_FAILED`, `FILE_MISMATCH`. `INTEGRATION_REPORT.md` lists what was and was not verified end to end.

## Structure

- `app/` Expo Router routes: `(auth)`, `(student)`, `(officer)`, `(recruiter)`; root `_layout.tsx` gates by session role.
- `src/ui/` shared primitives (see `UI_READY.md` for exact signatures).
- `src/api/` fetch client (15 s timeout, single-flight token refresh, typed `ApiError`), TanStack Query hooks, types.
- `src/state/session.ts` tokens and user in `expo-secure-store`.
- `src/lib/` validation (mirrors the server), formatting (INR/LPA, IST dates), push registration.

## Behaviour notes

- Animations are short opacity fades only (no bounce, slide or pop), and are skipped when the OS reduce-motion setting is on. Screenshots and screen recording are never blocked.
- Deadlines use the server clock: the client measures its offset from `GET /time`.
- No ERP or SSO integration exists; academic data is entered by students and verified by officers.
