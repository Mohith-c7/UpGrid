import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DUPLICATE_WINDOW_SECONDS, TICKET_RATE_LIMIT } from '../src/routes/tickets';
import { auth, makeApp, makeOtherTenant, pool, register, resetDb } from './helpers';

const B = '/api/v1';
const app = makeApp();
let officer: Awaited<ReturnType<typeof register>>;
let student: Awaited<ReturnType<typeof register>>;

beforeAll(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  officer = await register(app, 'officer');
  student = await register(app, 'student', { name: 'Asha Rao' });
});
afterAll(async () => { await pool.end(); });

let seq = 0;
const create = (who = student, over: Record<string, unknown> = {}) =>
  request(app).post(`${B}/tickets`).set(auth(who)).send({ category: 'profile', subject: `Subject number ${++seq}`, message: `Message body ${seq}`, ...over });
const notifs = async (who: { token: string }, type: string) =>
  (await request(app).get(`${B}/notifications`).set(auth(who as any))).body.items.filter((n: any) => n.type === type);

describe('consent at registration', () => {
  const body = (o: Record<string, unknown> = {}) => ({ name: 'Priya Nair', email: 'priya.nair@example.com', phone: '9876501299', password: 'Passw0rd1', role: 'student', ...o });
  it('requires acceptTerms: true', async () => {
    for (const v of [undefined, false, 'true', 1, null, 'yes']) {
      const r = await request(app).post(`${B}/auth/register`).send(body(v === undefined ? {} : { acceptTerms: v }));
      expect(r.status, String(v)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.fields.acceptTerms).toMatch(/accept/i);
    }
    expect((await pool.query(`SELECT count(*)::int n FROM users WHERE email='priya.nair@example.com'`)).rows[0].n).toBe(0);
  });
  it('reports acceptTerms together with other field errors', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ phone: '123', acceptTerms: false }));
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['acceptTerms', 'phone']);
  });
  it('stores a consent record (version v1, timestamp, no IP) and nothing on failure', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ acceptTerms: true }));
    expect(r.status).toBe(201);
    const c = (await pool.query(`SELECT * FROM user_consents WHERE user_id=$1`, [r.body.user.id])).rows;
    expect(c).toHaveLength(1);
    expect(c[0].policy_version).toBe('v1');
    expect(Date.now() - new Date(c[0].accepted_at).getTime()).toBeLessThan(60_000);
    expect(Object.keys(c[0]).sort()).toEqual(['accepted_at', 'id', 'policy_version', 'tenant_id', 'user_id']);
    // duplicate email: 409 and no orphan consent row
    const dup = await request(app).post(`${B}/auth/register`).send(body({ acceptTerms: true, phone: '9876501298' }));
    expect(dup.status).toBe(409);
    expect((await pool.query('SELECT count(*)::int n FROM user_consents WHERE user_id NOT IN (SELECT id FROM users)')).rows[0].n).toBe(0);
  });
  it('officer registration needs it too', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ role: 'officer', inviteCode: 'TEST-INVITE', email: 'off.two@example.com' }));
    expect(r.status).toBe(400);
    expect(r.body.error.fields.acceptTerms).toBeTruthy();
  });
  it('GET /legal/versions is public', async () => {
    const r = await request(app).get(`${B}/legal/versions`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ terms: 'v1', privacy: 'v1' });
  });
});

describe('POST /tickets', () => {
  it('creates a ticket with its first message and notifies officers', async () => {
    const r = await create(student, { category: 'eligibility', subject: '  CGPA not showing  ', message: 'My CGPA is missing\nfrom eligibility.' });
    expect(r.status).toBe(201);
    expect(r.body.ticket).toMatchObject({ category: 'eligibility', subject: 'CGPA not showing', status: 'open', resolvedAt: null, student: { id: student.id, name: 'Asha Rao' } });
    expect(r.body.ticket.id).toBeTruthy();
    const d = await request(app).get(`${B}/tickets/${r.body.ticket.id}`).set(auth(student));
    expect(d.body.messages).toHaveLength(1);
    expect(d.body.messages[0]).toMatchObject({ author: { id: student.id, name: 'Asha Rao', role: 'student' }, message: 'My CGPA is missing\nfrom eligibility.' });
    const n = await notifs(officer, 'ticket');
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('New support ticket: CGPA not showing');
    expect(n[0].data.ticketId).toBe(r.body.ticket.id);
  });

  it('is for students only and needs authentication', async () => {
    expect((await create(officer)).status).toBe(403);
    expect((await request(app).post(`${B}/tickets`).send({ category: 'other', subject: 'abc', message: 'abcde' })).status).toBe(401);
  });

  it('validates category, subject (3-120) and message (5-2000)', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ category: 'billing' }, 'category'], [{ category: undefined }, 'category'],
      [{ subject: 'ab' }, 'subject'], [{ subject: '   ab   ' }, 'subject'], [{ subject: 'x'.repeat(121) }, 'subject'], [{ subject: 'two\nlines' }, 'subject'], [{ subject: 'nul\u0000' }, 'subject'], [{ subject: 5 }, 'subject'],
      [{ message: 'abcd' }, 'message'], [{ message: '  abcd  ' }, 'message'], [{ message: 'm'.repeat(2001) }, 'message'], [{ message: 'bad\u0007char' }, 'message'], [{ message: undefined }, 'message'],
      [{ extra: true }, 'extra'],
    ];
    for (const [over, field] of cases) {
      const r = await create(student, over);
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.fields[field], JSON.stringify(over)).toBeTruthy();
    }
    expect((await create(student, { subject: 'abc', message: 'abcde' })).status).toBe(201);
    expect((await create(student, { subject: 'x'.repeat(120), message: 'm'.repeat(2000) })).status).toBe(201);
    expect((await create(student, { subject: 'ünïcode ✓ subject', message: 'tab\tand\nnewline ok' })).status).toBe(201);
  });

  it('rate limits creation to 5 per hour per user (429 RATE_LIMITED with Retry-After), per user not global', async () => {
    for (let i = 0; i < TICKET_RATE_LIMIT.max; i++) expect((await create()).status).toBe(201);
    const blocked = await create();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await pool.query('SELECT count(*)::int n FROM tickets WHERE user_id=$1', [student.id])).rows[0].n).toBe(5);
    // another student is unaffected
    const other = await register(app, 'student');
    expect((await create(other)).status).toBe(201);
    // after the window passes the user can create again
    await pool.query(`UPDATE tickets SET created_at = now() - interval '61 minutes' WHERE user_id=$1`, [student.id]);
    expect((await create()).status).toBe(201);
  });

  it('rejected (invalid) attempts do not count towards the limit', async () => {
    for (let i = 0; i < 8; i++) expect((await create(student, { subject: 'x' })).status).toBe(400);
    expect((await create()).status).toBe(201);
  });

  it('an identical double-submit within a minute returns the same ticket (200, replayed) and does not use up the limit', async () => {
    const body = { category: 'document', subject: 'Resume link broken', message: 'The link does not open.' };
    const a = await create(student, body);
    const b = await create(student, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(b.body.ticket.id).toBe(a.body.ticket.id);
    expect((await pool.query('SELECT count(*)::int n FROM tickets')).rows[0].n).toBe(1);
    expect(await notifs(officer, 'ticket')).toHaveLength(1);
    // concurrent double-tap
    const both = await Promise.all([create(student, { ...body, subject: 'Concurrent one' }), create(student, { ...body, subject: 'Concurrent one' })]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 201]);
    // a different message with the same subject is a new ticket; and after the window an identical one is too
    expect((await create(student, { ...body, message: 'A different problem.' })).status).toBe(201);
    await pool.query(`UPDATE tickets SET created_at = now() - ($1 || ' seconds')::interval`, [String(DUPLICATE_WINDOW_SECONDS + 5)]);
    expect((await create(student, body)).status).toBe(201);
  });
});

describe('GET /tickets', () => {
  it('students see only their own; officers see the tenant with student names; status filter and paging work', async () => {
    const other = await register(app, 'student', { name: 'Ravi Kumar' });
    const t1 = await create(student);
    const t2 = await create(student);
    const t3 = await create(other);
    await request(app).post(`${B}/tickets/${t2.body.ticket.id}/status`).set(auth(student)).send({ status: 'resolved' });

    const mine = await request(app).get(`${B}/tickets`).set(auth(student));
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((x: any) => x.id).sort()).toEqual([t1.body.ticket.id, t2.body.ticket.id].sort());
    expect(mine.body.nextCursor).toBeNull();
    const all = await request(app).get(`${B}/tickets`).set(auth(officer));
    expect(all.body.items).toHaveLength(3);
    expect(all.body.items.find((x: any) => x.id === t3.body.ticket.id).student).toEqual({ id: other.id, name: 'Ravi Kumar' });
    expect(all.body.items[0]).toMatchObject({ messageCount: 1 });
    expect((await request(app).get(`${B}/tickets?status=open`).set(auth(officer))).body.items.map((x: any) => x.id).sort()).toEqual([t1.body.ticket.id, t3.body.ticket.id].sort());
    expect((await request(app).get(`${B}/tickets?status=resolved`).set(auth(student))).body.items.map((x: any) => x.id)).toEqual([t2.body.ticket.id]);
    expect((await request(app).get(`${B}/tickets?status=closed`).set(auth(student))).status).toBe(400);

    const p1 = await request(app).get(`${B}/tickets?limit=2`).set(auth(officer));
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await request(app).get(`${B}/tickets?limit=2&cursor=${p1.body.nextCursor}`).set(auth(officer));
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    expect((await request(app).get(`${B}/tickets?limit=51`).set(auth(officer))).status).toBe(400);
    expect((await request(app).get(`${B}/tickets`)).status).toBe(401);
  });

  it('recent activity sorts first', async () => {
    const a = await create();
    const b = await create();
    await request(app).post(`${B}/tickets/${a.body.ticket.id}/messages`).set(auth(officer)).send({ message: 'Looking into it' });
    const l = await request(app).get(`${B}/tickets`).set(auth(student));
    expect(l.body.items.map((x: any) => x.id)).toEqual([a.body.ticket.id, b.body.ticket.id]);
    expect(l.body.items[0].lastMessagePreview).toBe('Looking into it');
  });

  it('is tenant scoped', async () => {
    await create();
    const t2 = await makeOtherTenant('e');
    expect((await request(app).get(`${B}/tickets`).set(auth(t2.officer))).body.items).toHaveLength(0);
    expect((await create(t2.student)).status).toBe(201);
    expect((await request(app).get(`${B}/tickets`).set(auth(officer))).body.items).toHaveLength(1);
    expect((await request(app).get(`${B}/tickets`).set(auth(t2.officer))).body.items).toHaveLength(1);
  });
});

describe('GET /tickets/:id, messages and status', () => {
  it('detail returns ticket and ordered messages; foreign students and other tenants get 404', async () => {
    const t = (await create()).body.ticket;
    await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(officer)).send({ message: 'Please share a screenshot.' });
    await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(student)).send({ message: 'Done, attached in the resume link.' });
    const d = await request(app).get(`${B}/tickets/${t.id}`).set(auth(officer));
    expect(d.status).toBe(200);
    expect(d.body.ticket.id).toBe(t.id);
    expect(d.body.messages.map((m: any) => [m.author.role, m.message])).toEqual([
      ['student', expect.stringMatching(/^Message body/)], ['officer', 'Please share a screenshot.'], ['student', 'Done, attached in the resume link.'],
    ]);
    expect(d.body.messages[1].author).toEqual({ id: officer.id, name: 'Test User', role: 'officer' });
    expect(Object.keys(d.body.messages[0]).sort()).toEqual(['author', 'createdAt', 'id', 'message']);
    const stranger = await register(app, 'student');
    expect((await request(app).get(`${B}/tickets/${t.id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(stranger)).send({ message: 'hello there' })).status).toBe(404);
    expect((await request(app).post(`${B}/tickets/${t.id}/status`).set(auth(stranger)).send({ status: 'resolved' })).status).toBe(404);
    const t2 = await makeOtherTenant('f');
    for (const who of [t2.officer, t2.student]) {
      expect((await request(app).get(`${B}/tickets/${t.id}`).set(auth(who))).status).toBe(404);
      expect((await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(who)).send({ message: 'hello there' })).status).toBe(404);
      expect((await request(app).post(`${B}/tickets/${t.id}/status`).set(auth(who)).send({ status: 'resolved' })).status).toBe(404);
    }
    expect((await request(app).get(`${B}/tickets/00000000-0000-4000-8000-000000000999`).set(auth(officer))).status).toBe(404);
    expect((await request(app).get(`${B}/tickets/not-a-uuid`).set(auth(officer))).status).toBe(400);
    expect((await request(app).get(`${B}/tickets/${t.id}`)).status).toBe(401);
  });

  it('new messages notify the other party only', async () => {
    const t = (await create()).body.ticket;
    const before = (await notifs(officer, 'ticket_message')).length;
    await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(officer)).send({ message: 'We are checking.' });
    const sn = await notifs(student, 'ticket_message');
    expect(sn).toHaveLength(1);
    expect(sn[0].title).toMatch(/^New reply on: Subject number/);
    expect(sn[0].body).toMatch(/Test User: We are checking\./);
    expect(sn[0].data.ticketId).toBe(t.id);
    expect(await notifs(officer, 'ticket_message')).toHaveLength(before);
    await request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(student)).send({ message: 'Thank you!' });
    expect(await notifs(officer, 'ticket_message')).toHaveLength(before + 1);
    expect(await notifs(student, 'ticket_message')).toHaveLength(1);
  });

  it('validates messages (5-2000), rejects unknown keys and resolved tickets', async () => {
    const t = (await create()).body.ticket;
    const post = (m: unknown, who = student) => request(app).post(`${B}/tickets/${t.id}/messages`).set(auth(who)).send(m as any);
    for (const m of [{}, { message: 'abcd' }, { message: '  abcd  ' }, { message: 'x'.repeat(2001) }, { message: 'bad\u0000' }, { message: 12 }, { message: 'okay then', extra: 1 }]) {
      expect((await post(m)).status, JSON.stringify(m)).toBe(400);
    }
    expect((await post({ message: 'x'.repeat(2000) })).status).toBe(201);
    const ok = await post({ message: '  trimmed  ' });
    expect(ok.status).toBe(201);
    expect(ok.body.message).toMatchObject({ message: 'trimmed', author: { id: student.id, role: 'student' } });
    await request(app).post(`${B}/tickets/${t.id}/status`).set(auth(officer)).send({ status: 'resolved' });
    const closed = await post({ message: 'still broken' });
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('TICKET_RESOLVED');
    expect((await post({ message: 'reply anyway' }, officer)).status).toBe(422);
    await request(app).post(`${B}/tickets/${t.id}/status`).set(auth(student)).send({ status: 'open' });
    expect((await post({ message: 'now it works' })).status).toBe(201);
  });

  it('status: owner or officer, idempotent, sets resolvedAt, rejects bad values', async () => {
    const t = (await create()).body.ticket;
    const set = (status: unknown, who = student) => request(app).post(`${B}/tickets/${t.id}/status`).set(auth(who)).send({ status } as any);
    const r = await set('resolved');
    expect(r.status).toBe(200);
    expect(r.body.ticket).toMatchObject({ id: t.id, status: 'resolved' });
    expect(r.body.ticket.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const again = await set('resolved', officer);
    expect(again.status).toBe(200);
    expect(again.body.ticket.resolvedAt).toBe(r.body.ticket.resolvedAt);
    const reopened = await set('open', officer);
    expect(reopened.body.ticket).toMatchObject({ status: 'open', resolvedAt: null });
    for (const bad of ['closed', '', null, undefined, 1]) expect((await set(bad)).status, String(bad)).toBe(400);
    expect((await request(app).post(`${B}/tickets/${t.id}/status`).set(auth(student)).send({ status: 'open', x: 1 })).status).toBe(400);
    expect((await request(app).post(`${B}/tickets/${t.id}/status`).send({ status: 'open' })).status).toBe(401);
    expect((await request(app).get(`${B}/tickets?status=open`).set(auth(student))).body.items).toHaveLength(1);
  });
});
