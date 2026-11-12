import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../src/errors';
import { waitlistRouter, MIN_FILL_MS } from '../src/routes/waitlist';
import { auth, cfg, makeApp, pool, register, resetDb } from './helpers';

const URL = '/api/v1/waitlist';
const good = (over: Record<string, unknown> = {}) => ({
  name: 'Asha Rao', role: 'student', college: 'Demo Institute', email: 'asha.rao@example.com', phone: '98765 43210',
  consent: true, website: '', elapsedMs: 8000, ...over,
});
const count = async () => Number((await pool.query('SELECT count(*) FROM waitlist_signups')).rows[0].count);

describe('waitlist', () => {
  const app = makeApp();
  beforeAll(async () => { await resetDb(); });
  beforeEach(async () => { await pool.query('TRUNCATE waitlist_signups'); });
  afterAll(async () => { await pool.query('TRUNCATE waitlist_signups'); await pool.end(); });

  it('stores a valid signup without authentication', async () => {
    const res = await request(app).post(URL).send(good());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = (await pool.query('SELECT * FROM waitlist_signups')).rows[0];
    expect(row.email).toBe('asha.rao@example.com');
    expect(row.phone).toBe('9876543210');
    expect(row.role).toBe('student');
    expect(row.ip_hash).toHaveLength(32);
  });

  it('is idempotent for a duplicate email (also gmail dot/plus variants) with an identical response', async () => {
    const a = await request(app).post(URL).send(good({ email: 'asha.rao@gmail.com' }));
    const b = await request(app).post(URL).send(good({ email: 'asharao+pilot@gmail.com', name: 'Someone Else' }));
    const c = await request(app).post(URL).send(good({ email: 'ASHA.RAO@googlemail.com' }));
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(b.body).toEqual(a.body);
    expect(await count()).toBe(1);
    expect((await pool.query('SELECT name FROM waitlist_signups')).rows[0].name).toBe('Asha Rao');
  });

  it('allows empty optional phone and college', async () => {
    const res = await request(app).post(URL).send(good({ phone: '', college: '' }));
    expect(res.status).toBe(200);
    const row = (await pool.query('SELECT phone, college FROM waitlist_signups')).rows[0];
    expect(row.phone).toBeNull();
    expect(row.college).toBeNull();
  });

  it('suggests gmail.com for typo domains', async () => {
    const res = await request(app).post(URL).send(good({ email: 'someone@gmial.com' }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBe('Did you mean gmail.com?');
    expect(await count()).toBe(0);
  });

  it.each([
    ['name', { name: 'X' }],
    ['email', { email: 'not-an-email' }],
    ['email', { email: 'a..b@example.com' }],
    ['phone', { phone: '1234567890' }],
    ['phone', { phone: '9999999999' }],
    ['phone', { phone: '5123456789' }],
    ['phone', { phone: '98765abcde' }],
    ['role', { role: 'admin' }],
    ['consent', { consent: false }],
    ['consent', { consent: 'yes' }],
  ])('rejects invalid %s', async (field, over) => {
    const res = await request(app).post(URL).send(good(over));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields[field]).toBeTruthy();
    expect(await count()).toBe(0);
  });

  it('accepts +91 and 0 prefixes for the phone', async () => {
    await request(app).post(URL).send(good({ email: 'p1@example.com', phone: '+91 98765-43210' })).expect(200);
    await request(app).post(URL).send(good({ email: 'p2@example.com', phone: '09876543211' })).expect(200);
    const phones = (await pool.query('SELECT phone FROM waitlist_signups ORDER BY phone')).rows.map((r) => r.phone);
    expect(phones).toEqual(['9876543210', '9876543211']);
  });

  it('rejects unknown fields and non-object bodies', async () => {
    const res = await request(app).post(URL).send(good({ isAdmin: true }));
    expect(res.status).toBe(400);
    await request(app).post(URL).send([1, 2]).expect(400);
  });

  it('honeypot: answers 200 but stores nothing', async () => {
    const res = await request(app).post(URL).send(good({ website: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await count()).toBe(0);
  });

  it('time-trap: too-fast or missing timing is dropped silently', async () => {
    expect((await request(app).post(URL).send(good({ elapsedMs: MIN_FILL_MS - 1 }))).status).toBe(200);
    const noTiming: any = good();
    delete noTiming.elapsedMs;
    expect((await request(app).post(URL).send(noTiming)).status).toBe(200);
    expect(await count()).toBe(0);
  });

  it('neutralises formula injection in the officer CSV export', async () => {
    await request(app).post(URL).send(good({ college: '=HYPERLINK("http://evil","x")', email: 'csv@example.com' })).expect(200);
    await request(app).post(URL).send(good({ college: '@SUM(A1)', email: 'csv2@example.com' })).expect(200);
    const officer = await register(app, 'officer');
    const res = await request(app).get(`${URL}/export`).set(auth(officer));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.startsWith('﻿')).toBe(true);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(res.text).toContain(`'@SUM(A1)`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(res.text).toMatch(/IST/);
  });

  it('export is officer-only', async () => {
    await request(app).get(`${URL}/export`).expect(401);
    const student = await register(app, 'student');
    await request(app).get(`${URL}/export`).set(auth(student)).expect(403);
  });

  it('POST stays public even though authenticated routers are mounted after it', async () => {
    const res = await request(app).post(URL).send(good({ email: 'public@example.com' }));
    expect(res.status).toBe(200);
  });

  it('rate limits to 5 requests per hour per IP', async () => {
    const limited = express();
    limited.set('trust proxy', 1);
    limited.use(express.json());
    limited.use('/api/v1/waitlist', waitlistRouter({ pool, cfg, push: async () => ({ invalidTokens: [] }) }, { rateLimit: true }));
    limited.use(errorHandler(() => undefined));
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await request(limited).post(URL).set('X-Forwarded-For', '203.0.113.9').send(good({ email: `rl${i}@example.com` }))).status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    // a different IP is unaffected
    expect((await request(limited).post(URL).set('X-Forwarded-For', '203.0.113.10').send(good({ email: 'rl-other@example.com' }))).status).toBe(200);
  });
});
