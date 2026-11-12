# Integrations API (auth, email, Google, Turnstile, file storage)

Base path `/api/v1`. JSON. Errors: `{ "error": { "code", "message", "fields"? } }`. Bearer auth unless marked public.
Every integration degrades safely: with no keys set the API runs, `GET /config` reports the feature as off, and the endpoints listed under "Feature off" answer with the stated code. The app MUST read `GET /config` at start-up and hide UI for features that are off.

## 1. `GET /config` (public, no auth)
```json
{
  "features": {
    "googleLogin": false, "emailVerification": false, "fileUploads": false, "turnstile": false, "requireVerifiedEmail": false,
    "ai": false, "codeExecution": false
  },
  "googleClientIds": { "web": "…", "android": "…", "ios": "…" },
  "turnstileSiteKey": "0x4AAA…",
  "limits": { "resumeMb": 5, "photoMb": 2, "logoMb": 1, "documentMb": 5 }
}
```
- `features` = the five flags above plus flags other modules register (`ai`, `codeExecution`, … only appear when that module is deployed).
- `googleClientIds` keys exist only for configured ids (`{}` when Google login is off). `turnstileSiteKey` is present only when Turnstile is enforced (`features.turnstile`) and the site key is set.
- `emailVerification` = the server can send mail (SMTP configured). `requireVerifiedEmail` = applying needs a verified email (default: on when SMTP is configured; always false when email is not available).
- Cache for the session; re-read on app start.

## 2. User object (all auth responses, `GET /me`, `PATCH /me`)
```json
{ "id", "name", "email", "phone": "9876543210" | null, "phoneDisplay": "+91 98765 43210" | null, "role": "student"|"officer"|…,
  "tenantId", "createdAt", "emailVerified": true, "authProvider": "password" | "google", "hasPassword": true }
```
`authProvider` is how the account was created (`google` = created via Google sign-in). `hasPassword` is false for Google-created accounts until they set one through forgot/reset password. `phone` is null only for Google sign-ups that have not added a number yet.

## 3. Turnstile (Cloudflare captcha)
When `features.turnstile` is true the app must send the widget token as `turnstileToken` in the JSON body OR header `X-Turnstile-Token` on: `POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/google`.
- Missing/invalid/expired/reused token → `400 CAPTCHA_FAILED`.
- Cloudflare unreachable / 5xx / timeout (5 s) while enforced → `503 CAPTCHA_UNAVAILABLE` (retry later).
- When `features.turnstile` is false the field is ignored.

## 4. Email verification
Registration automatically sends a 6-digit code (non-blocking; registration never fails because of mail). Codes: 6 digits, hashed at rest, expire in **10 minutes**, **5** wrong attempts lock the code (request a new one), resend cooldown **60 s**, at most **5 codes/hour per email** and **20/hour per IP**. A new code invalidates the previous one. Codes are never returned by the API.

### `POST /auth/email/send-verification` (auth)
Body: none (`{}`). → `200 { "ok": true, "expiresInSeconds": 600, "resendAfterSeconds": 60 }`; if already verified → `200 { "ok": true, "alreadyVerified": true }`.
Errors: `503 EMAIL_NOT_CONFIGURED` (feature off); `429 RESEND_COOLDOWN` (body also has `error.retryAfterSeconds`, header `Retry-After`); `429 RATE_LIMITED`.

### `POST /auth/email/verify` (auth)
Body `{ "code": "123456" }` → `200 { "ok": true, "user": <User> }` (idempotent when already verified).
Errors: `400 VALIDATION_ERROR` (code not 6 digits); `400 INVALID_CODE` (wrong, or no active code); `400 CODE_EXPIRED`; `429 TOO_MANY_ATTEMPTS` (locked, ask for a new code); `503 EMAIL_NOT_CONFIGURED`.

### Verified-email gate
If `features.requireVerifiedEmail`, `POST /drives/:id/apply` returns `403 EMAIL_NOT_VERIFIED` for unverified students, and `POST /drives/:id/application/preview` returns `canApply:false` with `blockedReason` and a new `blockedCode: "EMAIL_NOT_VERIFIED"`. Changing the email with `PATCH /me` clears `emailVerified` and (if mail is available) sends a new code.

## 5. Forgot / reset password
### `POST /auth/forgot-password` (public; Turnstile)
Body `{ "email" }` → **always** `200 { "ok": true, "message": "If an account exists for this email, a reset code has been sent." }` (same body, also for unknown, malformed, rate-limited or Google-only emails; the work happens after the response). Works for Google-only accounts (that is how they set a first password). Nothing is sent when email is not configured.

### `POST /auth/reset-password` (public)
Body `{ "email", "code", "newPassword" }` → `200 { "ok": true }`. All refresh tokens of the user are revoked (user must log in again); the email is marked verified; Google-only users get a password (`hasPassword` becomes true).
Errors: `400 VALIDATION_ERROR` (password rule: 8–64 chars, a letter and a digit; code not 6 digits); `400 INVALID_CODE` (also for unknown emails); `400 CODE_EXPIRED`; `429 TOO_MANY_ATTEMPTS`.

## 6. Google login
### `POST /auth/google` (public; Turnstile)
Body `{ "idToken": "<Google ID token>", "acceptTerms"?: true, "turnstileToken"? }` (no other fields; `role`/`inviteCode` are rejected 400).
→ `200 { "user": <User>, "accessToken", "refreshToken", "isNewUser": boolean, "needsPhone": boolean }` (status `200` for both sign-in and sign-up).
- Existing account found by Google subject, else by normalised email (account is linked, `emailVerified` becomes true). Roles never change; officer/recruiter accounts can sign in only when that email already has that role.
- New user → created as `student` with name from the token, `phone: null`, no password. If `acceptTerms !== true` → `400 TERMS_REQUIRED` (`fields.acceptTerms`) — show the Terms checkbox and retry the same call with `acceptTerms: true` (get a fresh idToken if needed).
- Linking onto a password account whose email was never verified removes that account's password and sessions (anti pre-registration hijack); the user can set a new one via forgot-password.
- `needsPhone: true` → send the user to a "Mobile number" step: `PATCH /me { "phone": "98765 43210" }` (10-digit rules, `409 PHONE_TAKEN`).
Errors: `401 INVALID_GOOGLE_TOKEN`; `401 GOOGLE_EMAIL_UNVERIFIED`; `409 GOOGLE_ACCOUNT_CONFLICT` (email belongs to an account linked to another Google user); `503 GOOGLE_LOGIN_NOT_CONFIGURED` (feature off); `400 CAPTCHA_FAILED`.
Password login (`POST /auth/login`) for an account without a password → `401 INVALID_CREDENTIALS`. `POST /me/change-password` for such an account → `400 NO_PASSWORD_SET` (use forgot-password).
### Phone gate
`POST /drives/:id/apply` → `403 PHONE_REQUIRED` when the student has no phone; preview returns `canApply:false`, `blockedCode:"PHONE_REQUIRED"`. `GET /profile` completion has a new item `{ key:"phone", label:"Mobile number", done, why }`.

## 7. Email notifications (best effort)
Sent after the database commit, never fail the request, only when mail is configured and the user's `email` setting is true: schedule created/updated (to the student), offer accepted/declined (to the officers who get the in-app notification), ticket replies (to the other party).
`GET /reminder-settings` and `PUT /reminder-settings` gain `email: boolean` (default `true`) — the "Email notifications" switch:
`{ t60,t30,t15,push,inApp,email,quietHours:{enabled,start,end} }`. `POST /reminder-settings/reset` returns the defaults including `email:true`.

## 8. File uploads (Cloudflare R2, private bucket, presigned URLs)
Off (no R2 env) → every `/files*` route and `/applications/:id/resume-url` for file resumes answers `503 FILE_STORAGE_NOT_CONFIGURED`.
Allowlist (content type must match exactly; size in bytes ≤ limit):
| purpose | who | types | max |
|---|---|---|---|
| `resume` | student | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 5 MB |
| `photo` | any user | `image/png`, `image/jpeg`, `image/webp` | 2 MB |
| `company_logo` | officer | `image/png`, `image/jpeg`, `image/webp` (no SVG) | 1 MB |
| `document` | any user | `application/pdf`, `image/png`, `image/jpeg` | 5 MB |

### Upload flow
1. `POST /files/presign` `{ "purpose", "fileName", "contentType", "size" }` → `200 { "fileId", "uploadUrl", "method": "PUT", "headers": { "Content-Type": "<contentType>" }, "expiresIn": 600 }`.
2. App uploads the bytes: `PUT uploadUrl` with exactly those headers and body = the file (no auth header, no multipart).
3. `POST /files/:id/confirm` `{}` → `200 { "file": { id, purpose, fileName, contentType, size, status:"ready", createdAt, publicUrl? } }` (`publicUrl` only for `company_logo`). Idempotent.
4. Use the id: `POST /profile/resumes { label, fileId }`, or `PUT /drives/:id { company: { …, logoFileId } }`.
Presign errors: `400 VALIDATION_ERROR` (`fields.purpose|fileName|contentType|size`, e.g. wrong type for the purpose, too large, zero), `403 FORBIDDEN` (wrong role for purpose), `409 FILE_QUOTA_EXCEEDED` (20 ready files per user), `429 RATE_LIMITED` (too many unconfirmed uploads).
Confirm errors: `404 FILE_NOT_FOUND` (not yours), `409 UPLOAD_NOT_FOUND` (nothing uploaded yet — retry after upload), `422 FILE_MISMATCH` (uploaded size/type differs from what was declared; the file is discarded, presign again), `409 FILE_QUOTA_EXCEEDED`.
The storage key is `<tenant>/<user>/<purpose>/<uuid>.<ext>` (extension from the content type, never from the client file name).

### `GET /files/:id/url` → `200 { "url", "expiresIn": 300 }`
Signed GET, valid 300 s; do not cache longer. Owner always; officers of the same tenant for resume/document files that belong to an applicant (a file attached to one of their applications) and for company logos; other roles only via access rules that modules register with `registerFileAccessRule()` (server side, e.g. recruiters of a drive). Everything else is `404 FILE_NOT_FOUND`.
### `DELETE /files/:id` → `200 { "ok": true }`
Owner only. `409 FILE_IN_USE` when the file is attached to a non-withdrawn application. Also removes resume entries that use the file.

### Resumes
`POST /profile/resumes` accepts `{ label, fileId, isDefault? }` OR `{ label, url, isDefault? }` (exactly one). Max 5 total (`409 RESUME_LIMIT`). File must be a `ready` `resume` file owned by the caller (`400 VALIDATION_ERROR` `fields.fileId`).
Resume object (list/create/officer student detail/apply preview):
`{ id, label, url: string|null, isDefault, createdAt, fileId: string|null, kind: "file"|"link", fileName: string|null, size: number|null }` (`url` is null for `kind:"file"`; open files through `GET /files/:id/url`).
### `GET /applications/:id/resume-url` (officer) → `200 { "kind": "file"|"link", "label", "url", "fileName"?, "expiresIn"?: 300 }`
`fileName` and `expiresIn` only for files (signed URL, 300 s). `404 APPLICATION_NOT_FOUND`, `404 RESUME_NOT_AVAILABLE` (file deleted), `503 FILE_STORAGE_NOT_CONFIGURED` (file resume while R2 is off). `GET /applications/:id` `application.resume` = `{ label, url: string|null, kind: "file"|"link", fileId? }` (applications submitted before this release have only `{label,url}`: treat a missing `kind` as `link`).
### Applicants CSV
`GET /drives/:id/applicants/export` has a new last column `resumeKind` (`file`|`link`); `resumeUrl` is empty for file resumes (no signed URLs in exports).
### Company logo
`PUT /drives/:id` (and `POST /drives`) accept `company.logoFileId` (a ready `company_logo` file owned by an officer of the tenant): the server sets `company.logoUrl = R2_PUBLIC_BASE_URL + "/" + key`. `logoFileId: null` clears the logo. Errors: `400 VALIDATION_ERROR` (`fields["company.logoFileId"]`), `503 FILE_STORAGE_NOT_CONFIGURED`, `422 LOGO_PUBLIC_URL_NOT_CONFIGURED` (R2_PUBLIC_BASE_URL unset).

## 9. Rule change: scheduling without screening
Officers may now move `submitted` → `assessment` and `submitted` → `interview` (via `POST /applications/:id/status` and `POST /applications/:id/schedule`). `allowedNextStatuses` reflects it.
