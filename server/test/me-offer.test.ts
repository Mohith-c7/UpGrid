import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { applyTo, auth, createOpenDrive, makeApp, makeEligibleStudent, pool, register, resetDb } from './helpers';

const app = makeApp();
const patchMe = (s: { token: string }, body: unknown) => request(app).patch('/api/v1/me').set(auth(s as any)).send(body as any);

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await pool.end(); });

describe('PATCH /me', () => {
  beforeEach(async () => { await resetDb(); });

  it('updates name, email and phone, normalising each', async () => {
    const s = await register(app);
    const r = await patchMe(s, { name: '  Asha   Rao ', email: '  Asha.Rao@Example.COM ', phone: '+91 98765-43210' });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ name: 'Asha Rao', email: 'asha.rao@example.com', phone: '9876543210', phoneDisplay: '+91 98765 43210', role: 'student' });
    const g = await request(app).get('/api/v1/me').set(auth(s));
    expect(g.body.user.email).toBe('asha.rao@example.com');
    // new email works for login
    const l = await request(app).post('/api/v1/auth/login').send({ email: 'asha.rao@example.com', password: 'Passw0rdX' });
    expect(l.status).toBe(200);
  });

  it('allows a partial patch and keeps the other fields', async () => {
    const s = await register(app);
    const before = (await request(app).get('/api/v1/me').set(auth(s))).body.user;
    const r = await patchMe(s, { name: 'Neha Iyer' });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe(before.email);
    expect(r.body.user.phone).toBe(before.phone);
  });

  it('requires authentication and at least one field', async () => {
    expect((await request(app).patch('/api/v1/me').send({ name: 'Abc' })).status).toBe(401);
    const s = await register(app);
    const r = await patchMe(s, {});
    expect(r.status).toBe(400);
  });

  it.each([
    ['gmial.com typo', 'someone@gmial.com', 'Did you mean gmail.com?'],
    ['gmail.con typo', 'someone@gmail.con', 'Did you mean gmail.com?'],
    ['no at sign', 'plainaddress', 'Enter a valid email address'],
    ['double dot', 'a..b@example.com', 'Enter a valid email address'],
    ['short gmail user', 'abc@gmail.com', 'Gmail usernames must be 6–30 characters'],
  ])('rejects invalid email: %s', async (_n, email, msg) => {
    const s = await register(app);
    const r = await patchMe(s, { email });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.fields.email).toBe(msg);
  });

  it('accepts a valid gmail address and normalises googlemail.com', async () => {
    const s = await register(app);
    const r = await patchMe(s, { email: 'Real.Person+tag@googlemail.com' });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('real.person+tag@gmail.com');
  });

  it.each([
    ['9 digits', '987654321'],
    ['11 digits no zero', '98765432101'],
    ['starts with 5', '5876543210'],
    ['repeated digits', '9999999999'],
    ['sequence', '1234567890'],
    ['letters', '98765abcde'],
    ['+91 with 9 digits', '+91 987654321'],
    ['+44 prefix', '+44 9876543210'],
  ])('rejects invalid phone: %s', async (_n, phone) => {
    const s = await register(app);
    const r = await patchMe(s, { phone });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.phone).toBe('Enter a valid 10-digit mobile number starting with 6–9');
  });

  it.each([['+91 98765 43210'], ['919876543210'], ['09876543210'], ['98765-43210']])('accepts phone format %s', async (phone) => {
    const s = await register(app);
    const r = await patchMe(s, { phone });
    expect(r.status).toBe(200);
    expect(r.body.user.phone).toBe('9876543210');
  });

  it('rejects bad names', async () => {
    const s = await register(app);
    for (const name of ['A', 'Name123', '', 'x'.repeat(81)]) {
      const r = await patchMe(s, { name });
      expect(r.status).toBe(400);
      expect(r.body.error.fields.name).toBeTruthy();
    }
  });

  it('reports every invalid field at once', async () => {
    const s = await register(app);
    const r = await patchMe(s, { email: 'x@gmial.com', phone: '123' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['email', 'phone']);
  });

  it('returns EMAIL_TAKEN, including gmail dot/plus aliases, and PHONE_TAKEN', async () => {
    const a = await register(app, 'student', { email: 'first.user@gmail.com', phone: '9876500001' });
    const b = await register(app);
    let r = await patchMe(b, { email: 'firstuser+x@gmail.com' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
    expect(r.body.error.fields.email).toBeTruthy();
    r = await patchMe(b, { email: 'FIRST.USER@googlemail.com' });
    expect(r.status).toBe(409);
    r = await patchMe(b, { phone: '+91 98765 00001' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PHONE_TAKEN');
    expect(r.body.error.fields.phone).toBeTruthy();
    // nothing changed on b
    const g = await request(app).get('/api/v1/me').set(auth(b));
    expect(g.body.user.phone).not.toBe('9876500001');
    void a;
  });

  it('lets a user re-save their own email/phone and change case or gmail dots of their own address', async () => {
    const s = await register(app, 'student', { email: 'my.name@gmail.com', phone: '9876500002' });
    let r = await patchMe(s, { email: 'my.name@gmail.com', phone: '9876500002' });
    expect(r.status).toBe(200);
    r = await patchMe(s, { email: 'myname@gmail.com' });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('myname@gmail.com');
  });

  it('frees the old email and phone for others', async () => {
    const a = await register(app, 'student', { email: 'old@example.com', phone: '9876500003' });
    expect((await patchMe(a, { email: 'new@example.com', phone: '9876500004' })).status).toBe(200);
    const b = await register(app, 'student', { email: 'old@example.com', phone: '9876500003' });
    expect(b.id).toBeTruthy();
  });

  it('never changes role or other fields, for students and officers', async () => {
    const st = await register(app);
    const off = await register(app, 'officer');
    for (const s of [st, off]) {
      const r = await patchMe(s, { role: s === st ? 'officer' : 'student' });
      expect(r.status).toBe(400);
      expect(r.body.error.fields.role).toBe('Role cannot be changed');
      const r2 = await patchMe(s, { name: 'Valid Name', role: 'officer', tenantId: 'x' });
      expect(r2.status).toBe(400);
    }
    expect((await pool.query('SELECT role FROM users WHERE id=$1', [off.id])).rows[0].role).toBe('officer');
    expect((await pool.query('SELECT role FROM users WHERE id=$1', [st.id])).rows[0].role).toBe('student');
    // officers may edit contact details; role stays
    const ok = await patchMe(off, { name: 'Officer Kumar' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('officer');
  });
});

describe('POST /applications/:id/respond', () => {
  beforeEach(async () => { await resetDb(); });

  async function setup() {
    const officer = await register(app, 'officer');
    const other = await register(app, 'officer');
    const student = await makeEligibleStudent(app);
    const drive = await createOpenDrive(app, officer);
    const ap = await applyTo(app, student, drive.id);
    expect(ap.status).toBe(201);
    const id = ap.body.application.id as string;
    const status = (to: string) => request(app).post(`/api/v1/applications/${id}/status`).set(auth(officer)).send({ status: to });
    return { officer, other, student, drive, id, status };
  }
  async function toOffer(x: Awaited<ReturnType<typeof setup>>) {
    for (const st of ['screening', 'selected', 'offer_issued']) expect((await x.status(st)).status).toBe(200);
  }
  const respond = (s: { token: string }, id: string, body: unknown) =>
    request(app).post(`/api/v1/applications/${id}/respond`).set(auth(s as any)).send(body as any);

  it('accept happy path: status, event, officer notification, canRespondToOffer', async () => {
    const x = await setup();
    await toOffer(x);
    const before = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.student));
    expect(before.body.application.canRespondToOffer).toBe(true);
    const r = await respond(x.student, x.id, { decision: 'accept', note: 'Happy to join.' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ application: { id: x.id, status: 'offer_accepted' }, replayed: false });
    const g = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.student));
    expect(g.body.application.status).toBe('offer_accepted');
    expect(g.body.application.canRespondToOffer).toBe(false);
    const last = g.body.application.events.at(-1);
    expect(last).toMatchObject({ status: 'offer_accepted', actorRole: 'student', note: 'Happy to join.' });
    // drive owner notified, the other officer is not (owner exists)
    const n = await request(app).get('/api/v1/notifications').set(auth(x.officer));
    const item = n.body.items.find((i: any) => i.type === 'offer_response');
    expect(item).toBeTruthy();
    expect(item.title).toMatch(/accepted/i);
    expect(item.data.applicationId).toBe(x.id);
    const n2 = await request(app).get('/api/v1/notifications').set(auth(x.other));
    expect(n2.body.items.some((i: any) => i.type === 'offer_response')).toBe(false);
  });

  it('decline happy path with default note', async () => {
    const x = await setup();
    await toOffer(x);
    const r = await respond(x.student, x.id, { decision: 'decline' });
    expect(r.status).toBe(200);
    expect(r.body.application.status).toBe('offer_declined');
    const g = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.officer));
    expect(g.body.application.events.at(-1).status).toBe('offer_declined');
    expect(g.body.application.allowedNextStatuses).toEqual([]);
  });

  it('is idempotent: replaying the same decision adds no event or notification', async () => {
    const x = await setup();
    await toOffer(x);
    expect((await respond(x.student, x.id, { decision: 'accept' })).status).toBe(200);
    const again = await respond(x.student, x.id, { decision: 'accept' });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect((await pool.query(`SELECT count(*)::int c FROM application_events WHERE application_id=$1 AND status='offer_accepted'`, [x.id])).rows[0].c).toBe(1);
    expect((await pool.query(`SELECT count(*)::int c FROM notifications WHERE type='offer_response'`)).rows[0].c).toBe(1);
  });

  it('rejects the opposite decision after responding', async () => {
    const x = await setup();
    await toOffer(x);
    await respond(x.student, x.id, { decision: 'accept' });
    const r = await respond(x.student, x.id, { decision: 'decline' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('OFFER_ALREADY_DECIDED');
    const g = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.student));
    expect(g.body.application.status).toBe('offer_accepted');
  });

  it('rejects wrong state (no offer issued yet)', async () => {
    const x = await setup();
    let r = await respond(x.student, x.id, { decision: 'accept' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NO_OFFER_TO_RESPOND_TO');
    await x.status('screening');
    await x.status('selected');
    r = await respond(x.student, x.id, { decision: 'decline' });
    expect(r.status).toBe(422);
    const g = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.student));
    expect(g.body.application.canRespondToOffer).toBe(false);
  });

  it('validates the body', async () => {
    const x = await setup();
    await toOffer(x);
    expect((await respond(x.student, x.id, { decision: 'maybe' })).status).toBe(400);
    expect((await respond(x.student, x.id, {})).status).toBe(400);
    expect((await respond(x.student, x.id, { decision: 'accept', note: 'x'.repeat(301) })).status).toBe(400);
    expect((await respond(x.student, x.id, { decision: 'accept', status: 'joined' })).status).toBe(400);
  });

  it('only the owning student can respond; officers cannot; unknown id is 404', async () => {
    const x = await setup();
    await toOffer(x);
    const stranger = await makeEligibleStudent(app);
    expect((await respond(stranger, x.id, { decision: 'accept' })).status).toBe(404);
    expect((await respond(x.officer, x.id, { decision: 'accept' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/applications/${x.id}/respond`).send({ decision: 'accept' })).status).toBe(401);
    expect((await respond(x.student, '00000000-0000-4000-8000-0000000000aa', { decision: 'accept' })).status).toBe(404);
    const g = await request(app).get(`/api/v1/applications/${x.id}`).set(auth(x.student));
    expect(g.body.application.status).toBe('offer_issued');
  });

  it('after acceptance the officer can still mark joined', async () => {
    const x = await setup();
    await toOffer(x);
    await respond(x.student, x.id, { decision: 'accept' });
    expect((await x.status('joined')).status).toBe(200);
  });
});

describe('hardening', () => {
  it('health is public, oversized JSON is rejected, limit above 50 is rejected', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    const big = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    await resetDb();
    const s = await register(app);
    for (const path of ['/drives', '/notifications', '/applications']) {
      expect((await request(app).get(`/api/v1${path}?limit=500`).set(auth(s))).status).toBe(400);
    }
  });
});
