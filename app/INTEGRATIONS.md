# Integrations: what you need to fill in

The app reads `GET /api/v1/config` at start-up and shows each integration only when the server says it is on.
With no keys at all the app still works (email + password sign-in, link-only resumes). Nothing here is a secret:
the server keeps the secrets (see `server/docs/integrations-api.md`, `server/INTEGRATIONS.md` and `server/.env.example`).

## 1. App variables (`app/.env`, copied from `.env.example`; build profiles in `eas.json` can set the same names)

| Variable | Required | What it is | Where to get it |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | yes | API base URL with `/api/v1` | your Render service URL |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | for Google on Android | OAuth client of type **Android** | Google Cloud Console > APIs & Services > Credentials > Create credentials > OAuth client ID > Android. Package name `com.upgrid.app`, SHA-1 of the signing key (EAS: `eas credentials`, Play App Signing: Play Console > App integrity) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | for Google on iOS | OAuth client of type **iOS** | same page, bundle id `com.upgrid.app` |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | no (the server wants it in `GOOGLE_CLIENT_IDS`) | OAuth client of type **Web** | same page |
| `EXPO_PUBLIC_TURNSTILE_BASE_URL` | only if Turnstile is on and the API host is not on the widget's hostname list | https origin the Turnstile WebView loads under | any hostname you added to the widget |

Rules that are easy to miss:
- The server must accept the ID token audience of every client id you use (its `GOOGLE_CLIENT_IDS`), or Google sign-in answers `401 INVALID_GOOGLE_TOKEN`.
- Google sign-in needs a **development or production build**, not Expo Go: the reversed client id is registered as an app URL scheme at build time by `app.config.js` (it reads the two env vars above). Change a client id = rebuild.
- Android: the SHA-1 registered in Google Cloud must match the key that signed the installed build (debug, EAS and Play signing keys all differ).
- Unset or empty client id for a platform = no Google button on that platform. The OAuth consent screen must be published (or add test users) or Google blocks everyone else.
- Env values are embedded at bundle time. `npx expo start -c` after editing `.env`.

## 2. Server-side switches that drive the UI (set on Render, not in the app)

| Feature in the app | Turns on when the server has | Get it from |
|---|---|---|
| Email OTP, forgot/reset password | SMTP settings (`SMTP_*`) | any SMTP provider (Brevo, SES, Resend, Gmail app password) |
| Google button | `GOOGLE_CLIENT_IDS` (`web:...,android:...,ios:...`) | Google Cloud Console (above) |
| Turnstile widget | `TURNSTILE_SECRET_KEY` (enforces) + `TURNSTILE_SITE_KEY` (handed to the app by `/config`) | Cloudflare dashboard > Turnstile > Add widget (mode Managed, add your hostname). For tests use Cloudflare's always-pass key pair `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` |
| Resume and logo uploads | `R2_*` (account id, bucket, access key, secret) and `R2_PUBLIC_BASE_URL` for logos | Cloudflare dashboard > R2 > bucket + API token (Object Read & Write). Logos need the bucket's public `r2.dev` or custom domain URL; resumes stay private |
| Verified-email gate on Apply | email on + `requireVerifiedEmail` | server default when SMTP is set |

Check what the server reports: open `https://<api>/api/v1/config` in a browser. If a feature is `false` the app hides it.

## 3. Things that cannot be tested without your keys
Google sign-in, the Turnstile widget and real R2 uploads were written against the API doc and type-checked, but not run end to end. First run checklist:
1. `/config` shows the flag true, 2. install a dev build (`eas build --profile development --platform android`), 3. try each flow once on a real phone, 4. watch the server log for `INVALID_GOOGLE_TOKEN`, `CAPTCHA_FAILED`, `FILE_MISMATCH`.
