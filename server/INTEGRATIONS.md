# Integrations setup (paste keys, redeploy, done)

Everything below is **optional and independent**. With a group's variables empty the API still runs, `GET /api/v1/config` reports the feature as `false` and the app hides the matching UI. After changing env on Render, redeploy (or "Restart") and check:

```bash
curl https://<your-api>/api/v1/config
# {"features":{"googleLogin":true,"emailVerification":true,"fileUploads":true,"turnstile":true,"requireVerifiedEmail":true,...},"googleClientIds":{...},...}
```

The server also prints one `[integrations] ...` line per integration at start-up (no secrets). Exact API shapes are in `docs/integrations-api.md`.

| Feature | Turns on when | Off behaviour |
|---|---|---|
| Email (verification, reset, notifications) | `SMTP_HOST` set | dev: mails printed to console; production: logged no-op; `/auth/email/*` answer 503 `EMAIL_NOT_CONFIGURED`; forgot-password stays a generic 200 |
| Verified-email requirement | email on (override `REQUIRE_VERIFIED_EMAIL`) | applying never blocked |
| Google sign-in | `GOOGLE_CLIENT_IDS` set | `POST /auth/google` 503 `GOOGLE_LOGIN_NOT_CONFIGURED` |
| Turnstile captcha | `TURNSTILE_SECRET_KEY` set | no captcha check |
| File uploads | all of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `/files/*` 503 `FILE_STORAGE_NOT_CONFIGURED`; resumes stay link-only |
| Coding tests | `JUDGE0_URL` set | `features.codeExecution=false` |
| AI | `GEMINI_API_KEY` or Vertex vars | `features.ai=false`, 503 `AI_NOT_CONFIGURED` |
| Recruiter invite emails | email on | the invite token is still returned to the officer (`emailSent:false`) |

---

## 1. Google sign-in (Google Cloud OAuth)

You need **one Google Cloud project** and up to three OAuth clients. Menu names below are from the Google Cloud Console and may move slightly.

1. <https://console.cloud.google.com> -> create a project (e.g. "Placement OS").
2. **APIs & Services -> OAuth consent screen** (also called "Google Auth platform -> Branding"): user type **External**, app name, support email, developer email. Scopes: only `openid`, `email`, `profile` (non-sensitive, no verification review needed). Under **Audience**, click **Publish app** (status "In production"); while it is "Testing" only listed test users can sign in.
3. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**, three times:
   - **Web application** (required; the Expo app asks Google for an ID token with this client ID on every platform). No redirect URI is needed for the ID-token flow; add the ones your auth library asks for (for `expo-auth-session` the Expo proxy URI or your scheme).
   - **Android**: Package name = your `android.package` from `app.json`; **SHA-1 certificate fingerprint**:
     - Debug/dev build: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` (or `cd android && ./gradlew signingReport`).
     - EAS build: `eas credentials -p android` -> your keystore -> copy the SHA-1.
     - Play Store: **Play Console -> Your app -> Test and release -> App integrity -> App signing -> "App signing key certificate" SHA-1** (Google re-signs your app; this is the one production users get). Create an Android client for each SHA-1 you use (debug, EAS upload key, Play signing key); each is a separate client ID.
   - **iOS**: Bundle ID = your `ios.bundleIdentifier`. (App Store ID and Team ID are optional.)
4. Put the IDs in one variable, order **web, android, ios**:
   ```
   GOOGLE_CLIENT_IDS=1234-web.apps.googleusercontent.com,1234-android.apps.googleusercontent.com,1234-ios.apps.googleusercontent.com
   ```
   You can label them if you only have some: `web:...,ios:...`. Extra Android clients (debug + Play signing) can be appended unlabelled after the three: the server accepts every ID listed as a token audience, while `/config` shows the first of each platform to the app.
5. The app reads the IDs from `GET /config -> googleClientIds` and sends the ID token to `POST /auth/google`. The server verifies the signature, expiry, issuer and that the token's audience is one of your IDs, and requires `email_verified`.

Behaviour you should know: Google creates **students only**; an existing officer account can sign in with Google if the Google email equals the officer's email; new Google users have no phone number and must add one before applying; linking Google onto an email+password account that never verified its email removes that password (anti-squatting) - the user can set a new one with "Forgot password".

## 2. Email (SMTP)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (and optionally `APP_NAME`). Port 587 + `SMTP_SECURE=false` means STARTTLS; port 465 + `SMTP_SECURE=true` means implicit TLS. `MAIL_FROM` must be an address/domain your provider has verified, otherwise mail is rejected or lands in spam.

**Brevo (recommended for free volume, 300 mails/day on the free plan)**
1. Sign up at brevo.com -> **Senders, domains & dedicated IPs** -> add and verify your sender address (better: authenticate your domain by adding the DKIM + SPF/DMARC DNS records Brevo shows).
2. **SMTP & API -> SMTP** -> generate an SMTP key.
3. `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=<the login email shown on that page>`, `SMTP_PASS=<SMTP key>`, `MAIL_FROM=Placement OS <no-reply@yourdomain.com>`.

**Gmail with an app password (fine for pilots, ~500 mails/day)**
1. Google Account -> Security -> turn on 2-Step Verification -> **App passwords** -> create one (16 characters, no spaces).
2. `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (or 465 + `true`), `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `MAIL_FROM=Placement OS <you@gmail.com>` (Gmail rewrites other From addresses).

**Zoho Mail**
1. Zoho Mail -> My Account -> Security -> **App passwords** -> generate one (needed when 2FA is on).
2. India data centre: `SMTP_HOST=smtp.zoho.in`; others: `smtp.zoho.com` / `smtp.zoho.eu`. `SMTP_PORT=465`, `SMTP_SECURE=true` (or 587 + `false`), `SMTP_USER=<full mailbox address>`, `SMTP_PASS=<app password>`, `MAIL_FROM=Placement OS <that same mailbox>`.

Test: register a new account in the app; the 6-digit code should arrive within seconds. In local development leave `SMTP_HOST` empty and set `EMAIL_DEV_ECHO=1`: the code is printed in the server console (never in API responses, never when `NODE_ENV=production`).

`REQUIRE_VERIFIED_EMAIL` defaults to **true when SMTP is configured**; set `false` to make verification optional.

## 3. Cloudflare R2 (file uploads)

1. Cloudflare dashboard -> **R2 Object Storage** -> **Create bucket** (e.g. `placement-os-files`, location hint: Asia-Pacific). Keep it **private** (do not enable public access on the bucket itself).
2. Note your **Account ID** (R2 overview page, right side) -> `R2_ACCOUNT_ID`; bucket name -> `R2_BUCKET`.
3. **R2 -> Manage API tokens -> Create API token** -> permission **Object Read & Write**, restrict to this bucket -> copy the **Access Key ID** and **Secret Access Key** (shown once) -> `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. (The "Account API token" and the S3-compatible endpoint `https://<account>.r2.cloudflarestorage.com` are what the server uses; region is `auto`.)
4. **CORS** (needed only for browser/web clients uploading with the presigned `PUT`; native apps do not need it). Bucket -> Settings -> CORS policy:
   ```json
   [
     {
       "AllowedOrigins": ["https://app.yourdomain.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   (`"*"` for origins is fine while testing.)
5. **Public URL for company logos only**: bucket -> Settings -> **Custom Domains** -> connect e.g. `files.yourdomain.com` (the domain must be on Cloudflare). Set `R2_PUBLIC_BASE_URL=https://files.yourdomain.com`. A public domain exposes every object whose path is known, so **restrict it to logos**: Cloudflare -> your domain -> Security -> **WAF -> Custom rules** -> *Block* when `Hostname equals files.yourdomain.com` **and** `URI Path does not match wildcard "/*/*/company_logo/*"`. Object keys are `<tenant>/<user>/<purpose>/<uuid>.<ext>`, so this leaves only `company_logo` objects reachable on the public host; resumes, photos and documents stay private and are served only through 5-minute signed URLs on the private S3 endpoint. Without a custom domain, leave `R2_PUBLIC_BASE_URL` empty: uploads work, logo upload to drives returns 422 `LOGO_PUBLIC_URL_NOT_CONFIGURED`.
6. Limits enforced by the server: resume PDF/DOCX 5 MB, photo PNG/JPEG/WebP 2 MB, company logo PNG/JPEG/WebP 1 MB (officers, no SVG), document PDF/PNG/JPEG 5 MB, 20 files per user. Optionally add an R2 lifecycle rule to abort incomplete multipart uploads after 1 day (not used by this API, harmless).

## 4. Cloudflare Turnstile (captcha)

1. Cloudflare dashboard -> **Turnstile** -> **Add widget** -> name, hostnames (the page that hosts the widget - for a mobile app that is the web page/WebView host the app loads, e.g. `app.yourdomain.com`), mode **Managed**.
2. Copy the **Site key** -> `TURNSTILE_SITE_KEY` (public; the app gets it from `/config`) and the **Secret key** -> `TURNSTILE_SECRET_KEY`. **Set both**: the server enforces as soon as the secret is set, and the app cannot render the widget without the site key (the server logs a warning in that case).
3. Enforced on `register`, `login`, `forgot-password`, `google`. Missing/invalid token -> 400 `CAPTCHA_FAILED`; Cloudflare unreachable -> 503 `CAPTCHA_UNAVAILABLE`.
4. For automated tests use Cloudflare's dummy keys: site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` (always passes), or `2x0000000000000000000000000000000AA` (always fails).

## 5. Judge0 (running candidates' code in coding tests)

The server never executes untrusted code itself.

**Option A - RapidAPI (fastest)**: subscribe to *Judge0 CE* on RapidAPI (free tier is small; pay as you grow). Then
```
JUDGE0_URL=https://judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=<your X-RapidAPI-Key>
JUDGE0_API_HOST=judge0-ce.p.rapidapi.com
```
**Option B - self-host** (cheaper at scale; needs a VPS where Docker can run privileged containers - Render web services cannot): follow the Judge0 docs (`judge0/judge0` release zip with `docker-compose.yml` and `judge0.conf`), set `AUTHN_TOKEN` and strong DB/Redis passwords in `judge0.conf`, put it behind HTTPS, and
```
JUDGE0_URL=https://judge0.yourdomain.com
JUDGE0_AUTH_TOKEN=<the AUTHN_TOKEN value>
```
Never expose an unauthenticated Judge0 to the internet. With `JUDGE0_URL` empty, coding questions cannot be published.

## 6. Gemini (AI features)

**Option A - Google AI Studio key**: <https://aistudio.google.com/apikey> -> create key -> `GEMINI_API_KEY`.

**Option B - Vertex AI** (data stays in your Google Cloud project, billing via the project): enable the *Vertex AI API*; create a service account with role **Vertex AI User**; create a JSON key; minify it to one line (`jq -c . key.json`) and paste it into `GOOGLE_APPLICATION_CREDENTIALS_JSON`; set `GOOGLE_CLOUD_PROJECT=<project id>` and `GOOGLE_CLOUD_LOCATION=asia-south1` (or `us-central1`).

Tuning: `AI_MODEL` (default `gemini-flash-lite-latest`), `AI_DAILY_LIMIT` (default 30 per student per day; `AI_DAILY_LIMIT_STAFF` for staff), `AI_ENABLED=false` to switch AI off without removing keys.

---

## Environment variable reference

Every variable the server reads, listed once (`.env.example` has the same set with comments; `render.yaml` declares them with `sync: false` so Render asks for the secrets, never stores them in git).

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | auto-filled by the Blueprint |
| `JWT_SECRET` | yes | min 24 chars, generated by the Blueprint |
| `OFFICER_INVITE_CODE` | yes in production | any strong string; share only with real officers |
| `PORT` | no | default 4000 (Render sets it) |
| `NODE_ENV` | no | `production` on Render |
| `CORS_ORIGINS` | no | `*` is fine for the native app |
| `BCRYPT_ROUNDS` | no | default 10 |
| `SCHEDULER_INTERVAL_MS` | no | worker poll interval, default 30000 |
| `DISABLE_SCHEDULER` | no | `1` = no in-process workers (reminders, announcements, assessments, pipeline) |
| `PGSSL` | no | `1` when the Postgres needs SSL and the URL has no `sslmode` |
| `SEED_FORCE` | no | `1` lets `npm run seed` wipe and seed a production database. Never set it on Render |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` `APP_NAME` | for email | section 2 |
| `EMAIL_DEV_ECHO` | no | development only: print the 6-digit codes to the console |
| `REQUIRE_VERIFIED_EMAIL` | no | default on when SMTP is set |
| `GOOGLE_CLIENT_IDS` | for Google | `web,android,ios` or labelled; alternatively `GOOGLE_WEB_CLIENT_ID` `GOOGLE_ANDROID_CLIENT_ID` `GOOGLE_IOS_CLIENT_ID` |
| `TURNSTILE_SECRET_KEY` `TURNSTILE_SITE_KEY` | for captcha | both |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | for uploads and for AI to read uploaded resumes | `R2_PUBLIC_BASE_URL` too for company logos |
| `JUDGE0_URL` (+ `JUDGE0_API_KEY` + `JUDGE0_API_HOST`, or `JUDGE0_AUTH_TOKEN`) | for coding tests | `JUDGE0_LANGUAGE_IDS` optional JSON override |
| `GEMINI_API_KEY` or `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` + `GOOGLE_APPLICATION_CREDENTIALS_JSON` | for AI | section 6 |
| `AI_ENABLED` `AI_MODEL` `AI_DAILY_LIMIT` `AI_DAILY_LIMIT_STAFF` `AI_TIMEOUT_MS` `AI_BURST_PER_MINUTE` `AI_CACHE_TTL_SECONDS` `AI_RETRY_BACKOFF_MS` `AI_REQUIRE_CANDIDATE_CONSENT` | no | AI tuning and kill switch; defaults in `.env.example` |

`TEST_DATABASE_URL` is read only by `npm test`.

Resumes uploaded to R2 are readable by the AI module and by recruiters assigned to the candidate's drive only when R2 is configured; without R2 resumes are https links and AI asks the student to paste the text.

After saving: wait for the deploy, then `GET /api/v1/config`, register a test student (code email arrives), try "Sign in with Google", upload a resume, and open it as an officer.

## Troubleshooting

- **`emailVerification: false` although SMTP is set** - `SMTP_HOST` is empty/whitespace in Render, or the service was not redeployed.
- **No verification email** - check Render logs for `[mail:error]` (bad credentials, sender not verified, port/`SMTP_SECURE` mismatch). Registration never fails because of mail; users can tap "Resend" (60 s cooldown, 5 codes per hour).
- **Google: "INVALID_GOOGLE_TOKEN"** - the app signed in with a client ID that is not in `GOOGLE_CLIENT_IDS` (check the Android SHA-1 of the build you are testing), or the device clock is wrong.
- **Upload: 403 from R2 on PUT** - the app did not send the exact `Content-Type` header returned by `/files/presign`, the URL expired (10 min), or the token lacks write permission on the bucket.
- **Confirm: 422 `FILE_MISMATCH`** - the uploaded size/type differs from what was declared; presign again.
- **Logo: 422 `LOGO_PUBLIC_URL_NOT_CONFIGURED`** - set `R2_PUBLIC_BASE_URL`.
