import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFeatureFlags } from '../src/features';
import { buildIntegrations, parseGoogleClientIds } from '../src/integrations';
import { sendMail } from '../src/mail';
import { renderTemplate, TEMPLATE_NAMES } from '../src/mail/templates';
import { issueOtp, safeEqualHex, hashCode, OTP } from '../src/otp';
import { nameFromGoogle } from '../src/routes/authExtra';
import { turnstileGuard } from '../src/turnstile';
import { DEFAULT_TENANT_ID } from '../src/config';
import {
  applyTo, auth, createOpenDrive, makeEligibleStudent, pool, register, resetDb, screenedApplication,
} from './helpers';
import { B, googleIdentity, googleLogin, makeIntegApp, MockMailer } from './integ-helpers';

afterAll(async () => { await pool.end(); });

const backdate = (seconds: number) =>
  pool.query(`UPDATE otp_codes SET created_at = created_at - ($1 || ' seconds')::interval, expires_at = expires_at - ($1 || ' seconds')::interval`, [String(seconds)]);
const rowsFor = async (email: string, purpose?: string) =>
  (await pool.query(`SELECT * FROM otp_codes WHERE email_key=$1 ${purpose ? `AND purpose='${purpose}'` : ''} ORDER BY created_at`, [email])).rows;

// ===================================================================== config
describe('GET /config', () => {
  it('is public and reports everything off with no env', async () => {
    const app = makeIntegApp();
    const r = await request(app).get(`${B}/config`);
    expect(r.status).toBe(200);
    expect(r.body.features).toMatchObject({ googleLogin: false, emailVerification: false, fileUploads: false, turnstile: false, requireVerifiedEmail: false });
    expect(r.body.googleClientIds).toEqual({});
    expect(r.body.turnstileSiteKey).toBeUndefined();
    expect(r.body.limits).toEqual({ resumeMb: 5, photoMb: 2, logoMb: 1, documentMb: 5 });
    expect(JSON.stringify(r.body)).not.toMatch(/secret|SMTP|password/i);
  });
  it('reflects configured integrations and merges flags registered by other modules', async () => {
    registerFeatureFlags(() => ({ ai: true, codeExecution: false }));
    const app = makeIntegApp({
      SMTP_HOST: 'smtp.example.test', GOOGLE_CLIENT_IDS: 'web-id.apps.googleusercontent.com,android-id,ios-id',
      TURNSTILE_SECRET_KEY: 's3cret', TURNSTILE_SITE_KEY: '0xSITE', R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b',
    });
    const r = await request(app).get(`${B}/config`);
    expect(r.body.features).toMatchObject({
      googleLogin: true, emailVerification: true, fileUploads: true, turnstile: true, requireVerifiedEmail: true, ai: true, codeExecution: false,
    });
    expect(r.body.googleClientIds).toEqual({ web: 'web-id.apps.googleusercontent.com', android: 'android-id', ios: 'ios-id' });
    expect(r.body.turnstileSiteKey).toBe('0xSITE');
    expect(JSON.stringify(r.body)).not.toContain('s3cret');
  });
  it('parses labelled and per-platform google client ids', () => {
    expect(parseGoogleClientIds({ GOOGLE_CLIENT_IDS: 'ios:i1, web:w1' }).clientIds).toEqual({ ios: 'i1', web: 'w1' });
    expect(parseGoogleClientIds({ GOOGLE_CLIENT_IDS: 'only-web' }).clientIds).toEqual({ web: 'only-web' });
    expect(parseGoogleClientIds({ GOOGLE_ANDROID_CLIENT_ID: 'a1' }).clientIds).toEqual({ android: 'a1' });
    expect(parseGoogleClientIds({}).all).toEqual([]);
  });
  it('REQUIRE_VERIFIED_EMAIL defaults to on only when SMTP is configured, and never without mail', () => {
    expect(buildIntegrations({ env: { SMTP_HOST: 'h' } }).requireVerifiedEmail).toBe(true);
    expect(buildIntegrations({ env: { SMTP_HOST: 'h', REQUIRE_VERIFIED_EMAIL: 'false' } }).requireVerifiedEmail).toBe(false);
    expect(buildIntegrations({ env: {} }).requireVerifiedEmail).toBe(false);
    expect(buildIntegrations({ env: { REQUIRE_VERIFIED_EMAIL: 'true' } }).requireVerifiedEmail).toBe(false);
  });
});

// ===================================================================== OTP + email verification
describe('email verification (OTP)', () => {
  let app: Express;
  let mailer: MockMailer;
  beforeEach(async () => {
    await resetDb();
    mailer = new MockMailer();
    app = makeIntegApp({}, { mailer });
  });

  const reg = async (over: Record<string, unknown> = {}) => {
    const s = await register(app, 'student', over);
    await vi.waitFor(() => expect(mailer.to(s.email).length).toBeGreaterThan(0));
    return s;
  };

  it('registration sends a 6-digit code without exposing it, user starts unverified', async () => {
    const res = await request(app).post(`${B}/auth/register`).send({ name: 'Ria Sen', email: 'ria.sen@example.com', phone: '9876501234', password: 'Passw0rdX', role: 'student', acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ emailVerified: false, authProvider: 'password', hasPassword: true });
    expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/);
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0].subject).toBe('Your Placement OS verification code');
    expect(mailer.lastCode('ria.sen@example.com')).toMatch(/^\d{6}$/);
    const row = (await rowsFor('ria.sen@example.com'))[0];
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toContain(mailer.lastCode('ria.sen@example.com'));
    expect(row.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(row.attempts).toBe(0);
  });

  it('registration still succeeds when the mail transport is down', async () => {
    mailer.fail = true;
    const res = await request(app).post(`${B}/auth/register`).send({ name: 'Ria Sen', email: 'ria.down@example.com', phone: '9876501235', password: 'Passw0rdX', role: 'student', acceptTerms: true });
    expect(res.status).toBe(201);
  });

  it('happy path: verify sets emailVerified, is idempotent, and /me agrees', async () => {
    const s = await reg();
    const code = mailer.lastCode(s.email);
    const v = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ ok: true, user: { emailVerified: true } });
    expect((await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [s.id])).rows[0].email_verified_at).not.toBeNull();
    expect((await request(app).get(`${B}/me`).set(auth(s))).body.user.emailVerified).toBe(true);
    expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code })).status).toBe(200);
    const again = await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({});
    expect(again.body).toEqual({ ok: true, alreadyVerified: true });
    expect(code).not.toBe('');
  });

  it('wrong code -> 400 INVALID_CODE; format errors -> 400 VALIDATION_ERROR; auth required', async () => {
    const s = await reg();
    const wrong = mailer.lastCode(s.email) === '000000' ? '111111' : '000000';
    const r = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: wrong });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CODE');
    for (const bad of ['12345', '1234567', 'abcdef', 123456, null, undefined]) {
      const x = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: bad });
      expect(x.status).toBe(400);
      expect(x.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await request(app).post(`${B}/auth/email/verify`).send({ code: '123456' })).status).toBe(401);
    expect((await request(app).post(`${B}/auth/email/send-verification`).send({})).status).toBe(401);
  });

  it('expired code -> 400 CODE_EXPIRED (10 minute lifetime)', async () => {
    const s = await reg();
    const row = (await rowsFor(s.email.toLowerCase()))[0];
    expect((new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 60000).toBeCloseTo(10, 1);
    await backdate(601);
    const r = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: mailer.lastCode(s.email) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('CODE_EXPIRED');
  });

  it('locks after 5 wrong attempts: even the right code is then refused (429 TOO_MANY_ATTEMPTS)', async () => {
    const s = await reg();
    const good = mailer.lastCode(s.email);
    const wrong = good === '654321' ? '123456' : '654321';
    for (let n = 0; n < OTP.maxAttempts; n++) {
      expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: wrong })).body.error.code).toBe('INVALID_CODE');
    }
    const locked = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: good });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [s.id])).rows[0].email_verified_at).toBeNull();
    // a fresh code (after the cooldown) unlocks the flow
    await backdate(61);
    expect((await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({})).status).toBe(200);
    await vi.waitFor(() => expect(mailer.to(s.email)).toHaveLength(2));
    expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: mailer.lastCode(s.email) })).status).toBe(200);
  });

  it('60 s resend cooldown (429 RESEND_COOLDOWN + Retry-After); a new code invalidates the old one', async () => {
    const s = await reg();
    const first = mailer.lastCode(s.email);
    const cd = await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({});
    expect(cd.status).toBe(429);
    expect(cd.body.error.code).toBe('RESEND_COOLDOWN');
    expect(cd.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(cd.body.error.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(Number(cd.headers['retry-after'])).toBeGreaterThan(0);
    expect(mailer.to(s.email)).toHaveLength(1);
    await backdate(61);
    const ok = await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({});
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, expiresInSeconds: 600, resendAfterSeconds: 60 });
    await vi.waitFor(() => expect(mailer.to(s.email)).toHaveLength(2));
    const second = mailer.lastCode(s.email);
    if (second !== first) {
      expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: first })).body.error.code).toBe('INVALID_CODE');
    }
    expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: second })).status).toBe(200);
  });

  it('rate limits: 5 codes per email per hour and 20 per IP per hour', async () => {
    const s = await reg();
    for (let n = 0; n < 4; n++) {
      await backdate(61);
      expect((await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({})).status).toBe(200);
    }
    await backdate(61);
    const limited = await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    // per-IP
    let last: any;
    for (let n = 0; n < OTP.perIpPerHour + 1; n++) {
      last = await issueOtp(pool, { tenantId: DEFAULT_TENANT_ID, userId: null, emailKey: `ip-user-${n}@example.com`, purpose: 'reset_password', ip: '203.0.113.9' });
      if (n < OTP.perIpPerHour) expect(last.ok).toBe(true);
    }
    expect(last).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect((await issueOtp(pool, { tenantId: DEFAULT_TENANT_ID, userId: null, emailKey: 'other-ip@example.com', purpose: 'reset_password', ip: '203.0.113.10' })).ok).toBe(true);
  });

  it('constant-time compare helper and salted hashing', () => {
    const h = hashCode('123456', 'aa');
    expect(safeEqualHex(h, hashCode('123456', 'aa'))).toBe(true);
    expect(safeEqualHex(h, hashCode('123457', 'aa'))).toBe(false);
    expect(hashCode('123456', 'bb')).not.toBe(h);
    expect(safeEqualHex(h, 'abcd')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });

  it('PATCH /me with a new email clears verification and sends a new code', async () => {
    const s = await reg();
    await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: mailer.lastCode(s.email) });
    const p = await request(app).patch(`${B}/me`).set(auth(s)).send({ email: 'changed.address@example.com' });
    expect(p.status).toBe(200);
    expect(p.body.user.emailVerified).toBe(false);
    await vi.waitFor(() => expect(mailer.to('changed.address@example.com')).toHaveLength(1));
    const v = await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: mailer.lastCode('changed.address@example.com') });
    expect(v.body.user.emailVerified).toBe(true);
    // changing only the name keeps the flag
    expect((await request(app).patch(`${B}/me`).set(auth(s)).send({ name: 'Renamed Person' })).body.user.emailVerified).toBe(true);
  });

  it('REQUIRE_VERIFIED_EMAIL: apply and preview are blocked until verified', async () => {
    const officer = await register(app, 'officer');
    const s = await makeEligibleStudent(app);
    const drive = await createOpenDrive(app, officer);
    const pv = await request(app).post(`${B}/drives/${drive.id}/application/preview`).set(auth(s)).send({});
    expect(pv.body).toMatchObject({ canApply: false, blockedCode: 'EMAIL_NOT_VERIFIED' });
    const ap = await applyTo(app, s, drive.id);
    expect(ap.status).toBe(403);
    expect(ap.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    await vi.waitFor(() => expect(mailer.to(s.email).length).toBeGreaterThan(0));
    await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: mailer.lastCode(s.email) });
    expect((await request(app).post(`${B}/drives/${drive.id}/application/preview`).set(auth(s)).send({})).body.canApply).toBe(true);
    expect((await applyTo(app, s, drive.id)).status).toBe(201);
  });

  it('REQUIRE_VERIFIED_EMAIL=false lets unverified students apply', async () => {
    const app2 = makeIntegApp({ REQUIRE_VERIFIED_EMAIL: 'false' }, { mailer });
    const officer = await register(app2, 'officer');
    const s = await makeEligibleStudent(app2);
    const drive = await createOpenDrive(app2, officer);
    expect((await applyTo(app2, s, drive.id)).status).toBe(201);
  });

  it('seed-style pre-verified users are not blocked', async () => {
    const officer = await register(app, 'officer');
    const s = await makeEligibleStudent(app);
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [s.id]);
    const drive = await createOpenDrive(app, officer);
    expect((await applyTo(app, s, drive.id)).status).toBe(201);
  });
});

// ===================================================================== email disabled / dev echo
describe('email not configured', () => {
  beforeEach(async () => { await resetDb(); });

  it('is a clean feature-off: registration works, send/verify answer 503 EMAIL_NOT_CONFIGURED, forgot-password stays generic', async () => {
    const logs: string[] = [];
    const app = makeIntegApp({ NODE_ENV: 'production', EMAIL_DEV_ECHO: '1' }, { log: (m) => logs.push(m) });
    const s = await register(app, 'student');
    expect((await pool.query('SELECT count(*)::int n FROM otp_codes')).rows[0].n).toBe(0);
    expect((await request(app).post(`${B}/auth/email/send-verification`).set(auth(s)).send({})).body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    expect((await request(app).post(`${B}/auth/email/verify`).set(auth(s)).send({ code: '123456' })).status).toBe(503);
    const f = await request(app).post(`${B}/auth/forgot-password`).send({ email: s.email });
    expect(f.status).toBe(200);
    expect(await sendMail('a@b.co', 'generic_notification', { title: 'x', body: 'y' })).toBe(false);
    expect(logs.join('\n')).not.toMatch(/\b\d{6}\b/);
    expect((await request(app).get(`${B}/config`)).body.features.emailVerification).toBe(false);
  });

  it('dev: EMAIL_DEV_ECHO=1 logs the code to the console only; the API never returns it', async () => {
    const logs: string[] = [];
    const app = makeIntegApp({ EMAIL_DEV_ECHO: '1' }, { log: (m) => logs.push(m) });
    const res = await request(app).post(`${B}/auth/register`).send({ name: 'Dev User', email: 'dev.user@example.com', phone: '9876501299', password: 'Passw0rdX', role: 'student', acceptTerms: true });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(logs.some((l) => l.includes('[mail:dev-echo]'))).toBe(true));
    const code = /code for dev\.user@example\.com: (\d{6})/.exec(logs.join('\n'))![1];
    expect(JSON.stringify(res.body)).not.toContain(code);
    expect(logs.some((l) => l.includes('[mail:console]'))).toBe(true);
    expect((await request(app).get(`${B}/config`)).body.features.emailVerification).toBe(true);
    expect((await request(app).get(`${B}/config`)).body.features.requireVerifiedEmail).toBe(false);
  });

  it('without EMAIL_DEV_ECHO the dev console transport does not log the code', async () => {
    const logs: string[] = [];
    const app = makeIntegApp({ SMTP_HOST: '' }, { log: (m) => logs.push(m) });
    await register(app, 'student');
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.join('\n')).not.toMatch(/\b\d{6}\b/);
  });
});

// ===================================================================== forgot / reset
describe('forgot and reset password', () => {
  let app: Express;
  let mailer: MockMailer;
  beforeEach(async () => {
    await resetDb();
    mailer = new MockMailer();
    app = makeIntegApp({}, { mailer });
  });
  const forgot = (email: unknown) => request(app).post(`${B}/auth/forgot-password`).send({ email });
  const reset = (body: Record<string, unknown>) => request(app).post(`${B}/auth/reset-password`).send(body);

  it('always answers 200 with the same body (no account enumeration)', async () => {
    const s = await register(app, 'student');
    await vi.waitFor(() => expect(mailer.to(s.email)).toHaveLength(1));
    const known = await forgot(s.email);
    const unknown = await forgot('nobody.here@example.com');
    const junk = await forgot('not an email');
    const none = await request(app).post(`${B}/auth/forgot-password`).send({});
    for (const r of [known, unknown, junk, none]) expect(r.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(junk.body).toEqual(known.body);
    expect(none.body).toEqual(known.body);
    expect(known.body.ok).toBe(true);
    expect(JSON.stringify(known.body)).not.toMatch(/\b\d{6}\b/);
    await vi.waitFor(() => expect(mailer.to(s.email)).toHaveLength(2));
    expect(mailer.to('nobody.here@example.com')).toHaveLength(0);
    expect(mailer.to(s.email)[1].subject).toBe('Your Placement OS password reset code');
    // the cooldown / rate limit are silent too
    const again = await forgot(s.email);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(known.body);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.to(s.email)).toHaveLength(2);
  });

  it('reset: new password works, old does not, all refresh tokens are revoked, email becomes verified', async () => {
    const s = await register(app, 'student', { password: 'OldPassw0rd1' });
    const other = await request(app).post(`${B}/auth/login`).send({ email: s.email, password: 'OldPassw0rd1' });
    await forgot(s.email);
    await vi.waitFor(() => expect(mailer.to(s.email).length).toBe(2));
    const r = await reset({ email: s.email, code: mailer.lastCode(s.email), newPassword: 'BrandNewPass9' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    for (const rt of [s.refresh, other.body.refreshToken]) {
      const x = await request(app).post(`${B}/auth/refresh`).send({ refreshToken: rt });
      expect(x.status).toBe(401);
    }
    expect((await pool.query('SELECT count(*)::int n FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [s.id])).rows[0].n).toBe(0);
    expect((await request(app).post(`${B}/auth/login`).send({ email: s.email, password: 'OldPassw0rd1' })).status).toBe(401);
    const ok = await request(app).post(`${B}/auth/login`).send({ email: s.email, password: 'BrandNewPass9' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);
    // the code is single use
    expect((await reset({ email: s.email, code: mailer.lastCode(s.email), newPassword: 'AnotherPass77' })).body.error.code).toBe('INVALID_CODE');
  });

  it('reset errors: wrong code, unknown email, weak password, bad format, expiry, attempt lock', async () => {
    const s = await register(app, 'student');
    await forgot(s.email);
    await vi.waitFor(() => expect(mailer.to(s.email).length).toBe(2));
    const good = mailer.lastCode(s.email);
    const wrong = good === '135790' ? '246801' : '135790';
    expect((await reset({ email: s.email, code: wrong, newPassword: 'BrandNewPass9' })).body.error.code).toBe('INVALID_CODE');
    expect((await reset({ email: 'ghost@example.com', code: good, newPassword: 'BrandNewPass9' })).body.error.code).toBe('INVALID_CODE');
    const weak = await reset({ email: s.email, code: good, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.fields.newPassword).toBeTruthy();
    expect((await reset({ email: s.email, code: '12ab', newPassword: 'BrandNewPass9' })).body.error.code).toBe('VALIDATION_ERROR');
    for (let n = 0; n < 4; n++) await reset({ email: s.email, code: wrong, newPassword: 'BrandNewPass9' });
    const locked = await reset({ email: s.email, code: good, newPassword: 'BrandNewPass9' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    // expiry
    await backdate(61);
    await forgot(s.email);
    await vi.waitFor(() => expect(mailer.to(s.email).length).toBe(3));
    await backdate(601);
    expect((await reset({ email: s.email, code: mailer.lastCode(s.email), newPassword: 'BrandNewPass9' })).body.error.code).toBe('CODE_EXPIRED');
    // a verification code cannot be used to reset a password (separate purposes)
    expect((await pool.query(`SELECT count(*)::int n FROM otp_codes WHERE purpose='verify_email'`)).rows[0].n).toBe(1);
  });

  it('a verification code cannot reset a password', async () => {
    const s = await register(app, 'student');
    await vi.waitFor(() => expect(mailer.to(s.email)).toHaveLength(1));
    const r = await reset({ email: s.email, code: mailer.lastCode(s.email), newPassword: 'BrandNewPass9' });
    expect(r.body.error.code).toBe('INVALID_CODE');
  });
});

// ===================================================================== Google
describe('POST /auth/google', () => {
  let app: Express;
  let mailer: MockMailer;
  let identities: Record<string, any>;
  const verifier = async (token: string, audiences: string[]) => {
    expect(audiences).toEqual(['web-client', 'android-client', 'ios-client']);
    if (!identities[token]) throw new Error('bad token');
    return identities[token];
  };
  beforeEach(async () => {
    await resetDb();
    mailer = new MockMailer();
    identities = { t1: googleIdentity() };
    app = makeIntegApp({ GOOGLE_CLIENT_IDS: 'web-client,android-client,ios-client' }, { mailer, googleVerifier: verifier });
  });

  it('new user: TERMS_REQUIRED without acceptTerms (nothing created), then created as a phone-less passwordless student', async () => {
    const no = await googleLogin(app, 't1');
    expect(no.status).toBe(400);
    expect(no.body.error.code).toBe('TERMS_REQUIRED');
    expect(no.body.error.fields.acceptTerms).toBeTruthy();
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(0);
    const falsy = await googleLogin(app, 't1', { acceptTerms: false });
    expect(falsy.body.error.code).toBe('TERMS_REQUIRED');

    const ok = await googleLogin(app, 't1', { acceptTerms: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ isNewUser: true, needsPhone: true });
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeTruthy();
    expect(ok.body.user).toMatchObject({
      role: 'student', name: 'New Student', email: 'new.student@example.com', phone: null, phoneDisplay: null,
      emailVerified: true, authProvider: 'google', hasPassword: false,
    });
    const row = (await pool.query('SELECT * FROM users WHERE id=$1', [ok.body.user.id])).rows[0];
    expect(row.password_hash).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.google_sub).toBe('g-sub-1');
    expect((await pool.query('SELECT 1 FROM user_consents WHERE user_id=$1', [row.id])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM profiles WHERE user_id=$1', [row.id])).rowCount).toBe(1);
    // tokens work; second login is not new
    expect((await request(app).get(`${B}/me`).set({ Authorization: `Bearer ${ok.body.accessToken}` })).body.user.id).toBe(ok.body.user.id);
    const again = await googleLogin(app, 't1');
    expect(again.body).toMatchObject({ isNewUser: false, needsPhone: true });
    expect(again.body.user.id).toBe(ok.body.user.id);
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(1);
    expect(mailer.sent).toHaveLength(0); // already verified by Google: no verification mail
  });

  it('matches by google_sub even when the email differs, and by normalised email (links the account, verifies it)', async () => {
    const first = await googleLogin(app, 't1', { acceptTerms: true });
    identities.t2 = googleIdentity({ email: 'moved.address@example.com' });
    const again = await googleLogin(app, 't2');
    expect(again.body.user.id).toBe(first.body.user.id);

    const pw = await register(app, 'student', { email: 'first.last@gmail.com', password: 'Passw0rdX' });
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [pw.id]);
    identities.t3 = googleIdentity({ sub: 'g-sub-3', email: 'First.Last+tag@googlemail.com' });
    const link = await googleLogin(app, 't3');
    expect(link.status).toBe(200);
    expect(link.body.isNewUser).toBe(false);
    expect(link.body.user).toMatchObject({ id: pw.id, emailVerified: true, hasPassword: true, authProvider: 'password' });
    expect((await pool.query('SELECT google_sub FROM users WHERE id=$1', [pw.id])).rows[0].google_sub).toBe('g-sub-3');
    expect((await request(app).post(`${B}/auth/login`).send({ email: pw.email, password: 'Passw0rdX' })).status).toBe(200);
    expect(link.body.needsPhone).toBe(false);
    expect(link.body.user.phone).toBe(pw.phone);
  });

  it('linking onto an UNVERIFIED password account removes that password and its sessions (pre-registration hijack guard)', async () => {
    const squatter = await register(app, 'student', { email: 'victim@example.com', password: 'Squatter123' });
    identities.v = googleIdentity({ sub: 'g-victim', email: 'victim@example.com', name: 'Real Victim' });
    const r = await googleLogin(app, 'v');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: squatter.id, emailVerified: true, hasPassword: false });
    expect((await request(app).post(`${B}/auth/login`).send({ email: 'victim@example.com', password: 'Squatter123' })).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await request(app).post(`${B}/auth/refresh`).send({ refreshToken: squatter.refresh })).status).toBe(401);
  });

  it('rejects unverified Google emails, invalid tokens, other-account conflicts and extra fields', async () => {
    identities.unv = googleIdentity({ sub: 'g-u', email: 'u@example.com', emailVerified: false });
    const u = await googleLogin(app, 'unv', { acceptTerms: true });
    expect(u.status).toBe(401);
    expect(u.body.error.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
    expect((await googleLogin(app, 'nope', { acceptTerms: true })).body.error.code).toBe('INVALID_GOOGLE_TOKEN');
    expect((await request(app).post(`${B}/auth/google`).send({})).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(0);
    await googleLogin(app, 't1', { acceptTerms: true });
    identities.other = googleIdentity({ sub: 'g-other' });
    const c = await googleLogin(app, 'other', { acceptTerms: true });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('GOOGLE_ACCOUNT_CONFLICT');
    for (const extra of [{ role: 'officer' }, { inviteCode: 'TEST-INVITE' }]) {
      identities.x = googleIdentity({ sub: 'g-x', email: 'x.user@example.com' });
      const r = await googleLogin(app, 'x', { acceptTerms: true, ...extra });
      expect(r.status).toBe(400);
    }
    expect((await pool.query(`SELECT count(*)::int n FROM users WHERE email='x.user@example.com'`)).rows[0].n).toBe(0);
  });

  it('role protection: Google creates students only; existing officers keep their role and are never created', async () => {
    const officer = await register(app, 'officer', { email: 'head.officer@example.com' });
    identities.off = googleIdentity({ sub: 'g-off', email: 'head.officer@example.com', name: 'Head Officer' });
    const r = await googleLogin(app, 'off');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: officer.id, role: 'officer' });
    // a brand-new Google identity is always a student, even if the email looks official
    identities.adm = googleIdentity({ sub: 'g-adm', email: 'placement.officer@example.com' });
    const n = await googleLogin(app, 'adm', { acceptTerms: true });
    expect(n.body.user.role).toBe('student');
    expect((await pool.query(`SELECT count(*)::int n FROM users WHERE role<>'student'`)).rows[0].n).toBe(1);
  });

  it('password login and change-password on a passwordless account fail cleanly; forgot/reset sets a first password', async () => {
    const g = await googleLogin(app, 't1', { acceptTerms: true });
    for (const pw of ['dummy-password-1', 'Passw0rdX', '']) {
      const l = await request(app).post(`${B}/auth/login`).send({ email: 'new.student@example.com', password: pw });
      expect(l.status).toBe(401);
      expect(l.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const cp = await request(app).post(`${B}/me/change-password`).set({ Authorization: `Bearer ${g.body.accessToken}` }).send({ currentPassword: 'Passw0rdX', newPassword: 'Another1234' });
    expect(cp.status).toBe(400);
    expect(cp.body.error.code).toBe('NO_PASSWORD_SET');
    await request(app).post(`${B}/auth/forgot-password`).send({ email: 'new.student@example.com' });
    await vi.waitFor(() => expect(mailer.to('new.student@example.com')).toHaveLength(1));
    const rs = await request(app).post(`${B}/auth/reset-password`).send({ email: 'new.student@example.com', code: mailer.lastCode('new.student@example.com'), newPassword: 'MyFirstPass1' });
    expect(rs.status).toBe(200);
    const l = await request(app).post(`${B}/auth/login`).send({ email: 'new.student@example.com', password: 'MyFirstPass1' });
    expect(l.status).toBe(200);
    expect(l.body.user).toMatchObject({ hasPassword: true, authProvider: 'google', emailVerified: true });
  });

  it('phone gate: applying needs a phone (403 PHONE_REQUIRED); PATCH /me sets it with the 10-digit rules; completion has a Mobile number item', async () => {
    const officer = await register(app, 'officer');
    const g = await googleLogin(app, 't1', { acceptTerms: true });
    const tok = { Authorization: `Bearer ${g.body.accessToken}` };
    const prof = await request(app).get(`${B}/profile`).set(tok);
    expect(prof.body.user.phone).toBeNull();
    expect(prof.body.user.phoneDisplay).toBeNull();
    expect(prof.body.completion.items.find((i: any) => i.key === 'phone')).toMatchObject({ label: 'Mobile number', done: false });
    const { goodAcademics } = await import('./helpers');
    expect((await request(app).put(`${B}/profile`).set(tok).send({ academics: goodAcademics })).status).toBe(200);
    const rs = await request(app).post(`${B}/profile/resumes`).set(tok).send({ label: 'Main', url: 'https://example.com/cv.pdf' });
    const drive = await createOpenDrive(app, officer);
    const pv = await request(app).post(`${B}/drives/${drive.id}/application/preview`).set(tok).send({});
    expect(pv.body).toMatchObject({ canApply: false, blockedCode: 'PHONE_REQUIRED' });
    const ap = await applyTo(app, { token: g.body.accessToken, resumeId: rs.body.resume.id, id: g.body.user.id }, drive.id);
    expect(ap.status).toBe(403);
    expect(ap.body.error.code).toBe('PHONE_REQUIRED');
    for (const bad of ['12345', '5876543210', '9999999999', 'abcdefghij']) {
      const x = await request(app).patch(`${B}/me`).set(tok).send({ phone: bad });
      expect(x.status).toBe(400);
      expect(x.body.error.fields.phone).toBeTruthy();
    }
    const set = await request(app).patch(`${B}/me`).set(tok).send({ phone: '+91 98765 43210' });
    expect(set.status).toBe(200);
    expect(set.body.user).toMatchObject({ phone: '9876543210', phoneDisplay: '+91 98765 43210' });
    const taken = await register(app, 'student', { phone: '9123456780' });
    const dup = await request(app).patch(`${B}/me`).set(tok).send({ phone: taken.phone });
    expect(dup.body.error.code).toBe('PHONE_TAKEN');
    expect((await request(app).get(`${B}/profile`).set(tok)).body.completion.items.find((i: any) => i.key === 'phone').done).toBe(true);
    expect((await applyTo(app, { token: g.body.accessToken, resumeId: rs.body.resume.id, id: g.body.user.id }, drive.id)).status).toBe(201);
  });

  it('is off (503 GOOGLE_LOGIN_NOT_CONFIGURED) without GOOGLE_CLIENT_IDS', async () => {
    const off = makeIntegApp({}, { googleVerifier: async () => { throw new Error('must not be called'); } });
    const r = await googleLogin(off, 't1', { acceptTerms: true });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('GOOGLE_LOGIN_NOT_CONFIGURED');
    expect((await request(off).get(`${B}/config`)).body.features.googleLogin).toBe(false);
  });

  it('derives a valid display name from messy Google names', () => {
    expect(nameFromGoogle('Ananya Iyer', 'a@b.co')).toBe('Ananya Iyer');
    expect(nameFromGoogle('R2 D2!!', 'a@b.co')).toMatch(/^[\p{L} .'’-]{2,}$/u);
    expect(nameFromGoogle(null, 'priya.nair99@gmail.com')).toMatch(/^[\p{L} .'’-]{2,80}$/u);
    expect(nameFromGoogle('', '123@x.co')).toBe('Student');
  });
});

// ===================================================================== Turnstile
describe('Turnstile', () => {
  let calls: { url: string; body: URLSearchParams }[];
  let result: () => Promise<any>;
  const fakeFetch = async (url: string, init?: any) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    return result();
  };
  const okJson = (success: boolean) => async () => ({ ok: true, status: 200, json: async () => ({ success }) });
  let mailer: MockMailer;
  const mk = () => makeIntegApp({ TURNSTILE_SECRET_KEY: 'sek', TURNSTILE_SITE_KEY: 'site', GOOGLE_CLIENT_IDS: 'web' }, {
    fetch: fakeFetch as any, mailer, googleVerifier: async () => googleIdentity(),
  });
  beforeEach(async () => { await resetDb(); calls = []; result = okJson(true); mailer = new MockMailer(); });

  const regBody = (n: number, extra: Record<string, unknown> = {}) => ({
    name: 'Test User', email: `ts${n}@example.com`, phone: `98765012${String(n).padStart(2, '0')}`, password: 'Passw0rdX', role: 'student', acceptTerms: true, ...extra,
  });

  it('passes with a valid token (body or X-Turnstile-Token) and verifies against Cloudflare with secret + token', async () => {
    const app = mk();
    const a = await request(app).post(`${B}/auth/register`).send(regBody(1, { turnstileToken: 'tok-body' }));
    expect(a.status).toBe(201);
    const b = await request(app).post(`${B}/auth/login`).set('X-Turnstile-Token', 'tok-header').send({ email: 'ts1@example.com', password: 'Passw0rdX' });
    expect(b.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0].body.get('secret')).toBe('sek');
    expect(calls[0].body.get('response')).toBe('tok-body');
    expect(calls[1].body.get('response')).toBe('tok-header');
  });

  it('guards register, login, forgot-password and google: missing or failed token -> 400 CAPTCHA_FAILED', async () => {
    const app = mk();
    const endpoints: [string, any][] = [
      ['/auth/register', regBody(2)], ['/auth/login', { email: 'x@example.com', password: 'Passw0rdX' }],
      ['/auth/forgot-password', { email: 'x@example.com' }], ['/auth/google', { idToken: 't', acceptTerms: true }],
    ];
    for (const [path, body] of endpoints) {
      const missing = await request(app).post(`${B}${path}`).send(body);
      expect(missing.status, path).toBe(400);
      expect(missing.body.error.code).toBe('CAPTCHA_FAILED');
    }
    expect(calls).toHaveLength(0);
    result = okJson(false);
    for (const [path, body] of endpoints) {
      const bad = await request(app).post(`${B}${path}`).send({ ...body, turnstileToken: 'bad' });
      expect(bad.status, path).toBe(400);
      expect(bad.body.error.code).toBe('CAPTCHA_FAILED');
    }
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(0);
    result = okJson(true);
    const g = await request(app).post(`${B}/auth/google`).send({ idToken: 't', acceptTerms: true, turnstileToken: 'ok' });
    expect(g.status).toBe(200);
    const f = await request(app).post(`${B}/auth/forgot-password`).set('X-Turnstile-Token', 'ok').send({ email: 'x@example.com' });
    expect(f.status).toBe(200);
  });

  it('fails closed with 503 CAPTCHA_UNAVAILABLE when Cloudflare is unreachable or errors', async () => {
    const app = mk();
    for (const r of [async () => { throw new Error('network'); }, async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })]) {
      result = r;
      const res = await request(app).post(`${B}/auth/register`).send(regBody(3, { turnstileToken: 't' }));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CAPTCHA_UNAVAILABLE');
    }
    expect((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(0);
  });

  it('times out after the configured delay (5 s in the app) -> 503', async () => {
    const guard = turnstileGuard('sek', (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))), 40);
    const next = vi.fn();
    await guard({ body: { turnstileToken: 'x' }, headers: {}, ip: '1.1.1.1' } as any, {} as any, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toMatchObject({ status: 503, code: 'CAPTCHA_UNAVAILABLE' });
  });

  it('is skipped entirely when TURNSTILE_SECRET_KEY is unset', async () => {
    const app = makeIntegApp({}, { fetch: fakeFetch as any });
    expect((await request(app).post(`${B}/auth/register`).send(regBody(4))).status).toBe(201);
    expect((await request(app).post(`${B}/auth/login`).send({ email: 'ts4@example.com', password: 'Passw0rdX' })).status).toBe(200);
    expect(calls).toHaveLength(0);
    const cfgBody = (await request(app).get(`${B}/config`)).body;
    expect(cfgBody.features.turnstile).toBe(false);
    expect(cfgBody.turnstileSiteKey).toBeUndefined();
    expect((await request(mk()).get(`${B}/config`)).body).toMatchObject({ features: { turnstile: true }, turnstileSiteKey: 'site' });
  });
});

// ===================================================================== notifications by email
describe('email notifications (best effort, respect the user setting)', () => {
  let app: Express;
  let mailer: MockMailer;
  beforeEach(async () => {
    await resetDb();
    mailer = new MockMailer();
    app = makeIntegApp({ REQUIRE_VERIFIED_EMAIL: 'false' }, { mailer });
  });
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const sched = (id: string, officer: any, over: Record<string, unknown> = {}) =>
    request(app).post(`${B}/applications/${id}/schedule`).set(auth(officer)).send({ type: 'interview', scheduledAt: inHours(48), mode: 'online', venueOrLink: 'https://meet.example.com/x', ...over });

  it('schedule created and updated -> mail to the student; setting email:false stops it', async () => {
    const officer = await register(app, 'officer');
    const { student, applicationId } = await screenedApplication(app, officer, { company: { name: 'MailCo' } });
    await vi.waitFor(() => expect(mailer.to(student.email).length).toBeGreaterThan(0)); // verification mail
    const before = mailer.to(student.email).length;
    expect((await sched(applicationId, officer)).status).toBe(200);
    await vi.waitFor(() => expect(mailer.to(student.email)).toHaveLength(before + 1));
    const m1 = mailer.to(student.email).pop()!;
    expect(m1.subject).toBe('Interview scheduled: MailCo');
    expect(m1.text).toContain('IST');
    expect(m1.html).toContain('https://meet.example.com/x');
    expect((await sched(applicationId, officer, { scheduledAt: inHours(72) })).status).toBe(200);
    await vi.waitFor(() => expect(mailer.to(student.email)).toHaveLength(before + 2));
    expect(mailer.to(student.email).pop()!.subject).toBe('Interview rescheduled: MailCo');

    const off = await request(app).put(`${B}/reminder-settings`).set(auth(student)).send({ email: false });
    expect(off.body.email).toBe(false);
    expect((await request(app).get(`${B}/reminder-settings`).set(auth(student))).body.email).toBe(false);
    expect((await sched(applicationId, officer, { scheduledAt: inHours(96) })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(mailer.to(student.email)).toHaveLength(before + 2);
    expect((await request(app).post(`${B}/reminder-settings/reset`).set(auth(student))).body.email).toBe(true);
    expect((await request(app).put(`${B}/reminder-settings`).set(auth(student)).send({ email: 'no' })).status).toBe(400);
  });

  it('a mail failure never fails the request', async () => {
    const officer = await register(app, 'officer');
    const { applicationId } = await screenedApplication(app, officer);
    mailer.fail = true;
    expect((await sched(applicationId, officer)).status).toBe(200);
  });

  it('offer response -> mail to officers (respecting their setting); ticket replies -> mail to the other party', async () => {
    const officer = await register(app, 'officer');
    const { student, applicationId } = await screenedApplication(app, officer, { company: { name: 'OfferCo' } });
    for (const st of ['selected', 'offer_issued']) {
      await request(app).post(`${B}/applications/${applicationId}/status`).set(auth(officer)).send({ status: st });
    }
    await new Promise((r) => setTimeout(r, 50));
    const before = mailer.to(officer.email).length;
    const r = await request(app).post(`${B}/applications/${applicationId}/respond`).set(auth(student)).send({ decision: 'accept', note: 'Happy to join' });
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(mailer.to(officer.email)).toHaveLength(before + 1));
    const m = mailer.to(officer.email).pop()!;
    expect(m.subject).toBe('Offer accepted: OfferCo');
    expect(m.text).toContain('Happy to join');
    // replay sends nothing more
    await request(app).post(`${B}/applications/${applicationId}/respond`).set(auth(student)).send({ decision: 'accept' });
    await new Promise((r2) => setTimeout(r2, 50));
    expect(mailer.to(officer.email)).toHaveLength(before + 1);

    const t = await request(app).post(`${B}/tickets`).set(auth(student)).send({ category: 'other', subject: 'Need help', message: 'Please help me out' });
    const tid = t.body.ticket.id;
    const sb = mailer.to(student.email).length;
    expect((await request(app).post(`${B}/tickets/${tid}/messages`).set(auth(officer)).send({ message: 'Looking into it now' })).status).toBe(201);
    await vi.waitFor(() => expect(mailer.to(student.email)).toHaveLength(sb + 1));
    expect(mailer.to(student.email).pop()!.subject).toBe('New reply: Need help');
    await request(app).put(`${B}/reminder-settings`).set(auth(student)).send({ email: false });
    await request(app).post(`${B}/tickets/${tid}/messages`).set(auth(officer)).send({ message: 'One more update' });
    await new Promise((r2) => setTimeout(r2, 80));
    expect(mailer.to(student.email)).toHaveLength(sb + 1);
  });
});

// ===================================================================== templates + helper
describe('mail templates and sendMail()', () => {
  const samples: Record<string, any> = {
    verification_code: { name: 'Ria', code: '123456', expiresMinutes: 10 },
    password_reset_code: { name: 'Ria', code: '654321', expiresMinutes: 10 },
    schedule_notification: { name: 'Ria', company: 'Acme', role: 'SDE', type: 'interview', whenText: '12 Nov, 10:30 AM IST', mode: 'online', venueOrLink: 'https://meet.example.com/a', instructions: 'Bring ID', rescheduled: false },
    offer_response: { name: 'Meera', studentName: 'Ria Sen', company: 'Acme', role: 'SDE', decision: 'accepted', reference: 'PL-2026-ABCD', note: 'Thanks' },
    ticket_reply: { name: 'Ria', subject: 'Help', authorName: 'Meera', message: 'We fixed it' },
    generic_notification: { name: 'Ria', title: 'Hello', body: 'Something happened', ctaLabel: 'Open', ctaUrl: 'https://app.example.com/x' },
  };
  it('renders text + clean responsive HTML with brand teal and no images for all six templates', () => {
    expect(TEMPLATE_NAMES).toHaveLength(6);
    for (const name of TEMPLATE_NAMES) {
      const r = renderTemplate(name, samples[name]);
      expect(r.subject.length).toBeGreaterThan(3);
      expect(r.subject).not.toMatch(/\d{6}/); // codes never in subjects
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.html).toContain('#126B63');
      expect(r.html).toContain('name="viewport"');
      expect(r.html).toMatch(/max-width:520px/);
      expect(r.html).not.toMatch(/<img|<script|url\(/i);
    }
    expect(renderTemplate('verification_code', samples.verification_code).html).toContain('123456');
  });
  it('escapes user content and refuses non-https links', () => {
    const r = renderTemplate('ticket_reply', { name: '<b>x</b>', subject: 'a"b', authorName: '<script>alert(1)</script>', message: 'x <img src=y onerror=z>\nline2' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toMatch(/<img/i);
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('<br>');
    const g = renderTemplate('generic_notification', { title: 'T\r\nBcc: evil@x.com', body: 'b', ctaLabel: 'Go', ctaUrl: 'javascript:alert(1)' });
    expect(g.html).not.toContain('javascript:');
    expect(g.subject).not.toMatch(/[\r\n]/);
  });
  it('sendMail never throws, even when the transport fails or mail is disabled', async () => {
    const mailer = new MockMailer();
    buildIntegrations({ env: { NODE_ENV: 'test' }, mailer, log: () => undefined });
    expect(await sendMail('a@b.co', 'generic_notification', samples.generic_notification)).toBe(true);
    expect(mailer.sent[0]).toMatchObject({ to: 'a@b.co', subject: 'Hello' });
    expect(mailer.sent[0].from).toBe('Placement OS <no-reply@localhost>');
    mailer.fail = true;
    expect(await sendMail('a@b.co', 'generic_notification', samples.generic_notification)).toBe(false);
    buildIntegrations({ env: { NODE_ENV: 'test' }, log: () => undefined }); // console transport, not "enabled"
    expect(await sendMail('a@b.co', 'generic_notification', samples.generic_notification)).toBe(false);
    expect(await sendMail('', 'generic_notification', samples.generic_notification)).toBe(false);
  });
  it('MAIL_FROM and APP_NAME are honoured', async () => {
    const mailer = new MockMailer();
    buildIntegrations({ env: { MAIL_FROM: 'Campus <jobs@campus.test>', APP_NAME: 'Campus Jobs' }, mailer, log: () => undefined });
    await sendMail('a@b.co', 'verification_code', samples.verification_code);
    expect(mailer.sent[0].from).toBe('Campus <jobs@campus.test>');
    expect(mailer.sent[0].subject).toBe('Your Campus Jobs verification code');
  });
  void bcrypt;
});
