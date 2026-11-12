import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExpoPushSender } from '../src/push';
import { inQuietHours } from '../src/notify';
import { reminderTimes, runDueReminders } from '../src/reminders';
import { applyTo, auth, createOpenDrive, makeApp, makeEligibleStudent, pool, register, resetDb, sent, fakePush } from './helpers';

const B = '/api/v1';
let app: Express;
let officer: Awaited<ReturnType<typeof register>>;

beforeAll(async () => {
  await resetDb();
  app = makeApp();
  officer = await register(app, 'officer');
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  await pool.end();
});

// 10:00 IST on a far-future date => 04:30Z
const DEADLINE = '2031-03-10T10:00:00+05:30';
const iso = (s: string) => new Date(s).toISOString();
const rows = async (driveId: string, userId?: string) =>
  (await pool.query(
    `SELECT kind, fire_at, status, user_id FROM scheduled_reminders WHERE drive_id=$1 ${userId ? 'AND user_id=$2' : ''} ORDER BY fire_at`,
    userId ? [driveId, userId] : [driveId])).rows;

describe('reminderTimes (pure)', () => {
  it('T-60/30/15 for a 10:00 deadline are 09:00/09:30/09:45', () => {
    const t = reminderTimes(new Date('2031-03-10T10:00:00+05:30'), new Date('2031-03-01T00:00:00Z'));
    expect(t.map((x) => [x.kind, x.fireAt.toISOString()])).toEqual([
      ['t60', iso('2031-03-10T09:00:00+05:30')], ['t30', iso('2031-03-10T09:30:00+05:30')], ['t15', iso('2031-03-10T09:45:00+05:30')],
    ]);
  });
  it('only future reminders are returned', () => {
    const dl = new Date('2031-03-10T10:00:00+05:30');
    expect(reminderTimes(dl, new Date('2031-03-10T09:20:00+05:30')).map((x) => x.kind)).toEqual(['t30', 't15']);
  });
  it('quiet hours wrap midnight in IST', () => {
    const q = { enabled: true, start: '22:00', end: '07:00' };
    expect(inQuietHours(q, new Date('2031-03-10T23:00:00+05:30'))).toBe(true);
    expect(inQuietHours(q, new Date('2031-03-10T06:59:00+05:30'))).toBe(true);
    expect(inQuietHours(q, new Date('2031-03-10T07:00:00+05:30'))).toBe(false);
    expect(inQuietHours(q, new Date('2031-03-10T12:00:00+05:30'))).toBe(false);
    expect(inQuietHours({ ...q, enabled: false }, new Date('2031-03-10T23:00:00+05:30'))).toBe(false);
  });
});

describe('scheduling', () => {
  it('publish schedules 9:00/9:30/9:45 for eligible and pending students only', async () => {
    const elig = await makeEligibleStudent(app);
    const low = await makeEligibleStudent(app, { cgpa: 5 });
    const pending = await register(app, 'student');
    const d = await createOpenDrive(app, officer, { company: { name: 'RemCo' }, deadline: DEADLINE });
    const r = await rows(d.id, elig.id);
    expect(r.map((x) => x.kind)).toEqual(['t60', 't30', 't15']);
    expect(r.map((x) => new Date(x.fire_at).toISOString())).toEqual([
      iso('2031-03-10T09:00:00+05:30'), iso('2031-03-10T09:30:00+05:30'), iso('2031-03-10T09:45:00+05:30'),
    ]);
    expect(r.every((x) => x.status === 'pending')).toBe(true);
    expect(await rows(d.id, low.id)).toHaveLength(0);
    expect(await rows(d.id, pending.id)).toHaveLength(3);
  });

  it('deadline edit cancels and reschedules to the new times', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'EditCo' }, deadline: DEADLINE });
    const upd = await request(app).put(`${B}/drives/${d.id}`).set(auth(officer)).send({ deadline: '2031-03-10T11:00:00+05:30' });
    expect(upd.status).toBe(200);
    const r = await rows(d.id, s.id);
    expect(r).toHaveLength(3);
    expect(r.map((x) => new Date(x.fire_at).toISOString())).toEqual([
      iso('2031-03-10T10:00:00+05:30'), iso('2031-03-10T10:30:00+05:30'), iso('2031-03-10T10:45:00+05:30'),
    ]);
    expect(r.every((x) => x.status === 'pending')).toBe(true);
    // a past deadline edit on an open drive is refused and leaves reminders intact
    const bad = await request(app).put(`${B}/drives/${d.id}`).set(auth(officer)).send({ deadline: new Date(Date.now() - 1000).toISOString() });
    expect(bad.status).toBe(422);
    expect((await rows(d.id, s.id)).every((x) => x.status === 'pending')).toBe(true);
  });

  it('applying cancels that student’s pending reminders (others keep theirs)', async () => {
    const a = await makeEligibleStudent(app);
    const b = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'ApplyRemCo' }, deadline: DEADLINE });
    expect((await applyTo(app, a, d.id)).status).toBe(201);
    expect((await rows(d.id, a.id)).every((x) => x.status === 'cancelled')).toBe(true);
    expect((await rows(d.id, b.id)).every((x) => x.status === 'pending')).toBe(true);
    // withdrawing brings reminders back
    const appl = (await pool.query('SELECT id FROM applications WHERE user_id=$1', [a.id])).rows[0];
    await request(app).post(`${B}/applications/${appl.id}/withdraw`).set(auth(a));
    expect((await rows(d.id, a.id)).every((x) => x.status === 'pending')).toBe(true);
  });

  it('closing a drive cancels all pending reminders', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'CloseRemCo' }, deadline: DEADLINE });
    await request(app).post(`${B}/drives/${d.id}/close`).set(auth(officer));
    expect((await rows(d.id, s.id)).every((x) => x.status === 'cancelled')).toBe(true);
  });

  it('late publish only schedules future reminders', async () => {
    const s = await makeEligibleStudent(app);
    const dl = new Date(Date.now() + 20 * 60_000);
    const d = await createOpenDrive(app, officer, { company: { name: 'LatePubCo' }, deadline: dl.toISOString() });
    const r = await rows(d.id, s.id);
    expect(r.map((x) => x.kind)).toEqual(['t15']); // t60 & t30 are already in the past
    expect(new Date(r[0].fire_at).getTime()).toBe(dl.getTime() - 15 * 60_000);
    const d2 = await createOpenDrive(app, officer, { company: { name: 'VeryLatePubCo' }, deadline: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(await rows(d2.id, s.id)).toHaveLength(0);
  });

  it('student becoming eligible via profile change gets reminders; becoming ineligible loses them', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'SyncCo' }, deadline: DEADLINE });
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 5 } });
    expect((await rows(d.id, s.id)).every((x) => x.status === 'cancelled')).toBe(true);
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 8 } });
    expect((await rows(d.id, s.id)).every((x) => x.status === 'pending')).toBe(true);
    // brand-new student registering and filling the profile after publish
    const late = await register(app, 'student');
    expect(await rows(d.id, late.id)).toHaveLength(0);
    await request(app).put(`${B}/profile`).set(auth(late)).send({ academics: { cgpa: 9, activeBacklogs: 0 } });
    expect(await rows(d.id, late.id)).toHaveLength(3);
  });
});

describe('worker', () => {
  beforeEach(async () => {
    await pool.query("UPDATE drives SET status='closed' WHERE status='open'");
    await pool.query("UPDATE scheduled_reminders SET status='cancelled' WHERE status='pending'");
  });
  it('sends in-app + push at fire time, exactly once (idempotent), copy mentions company', async () => {
    const s = await makeEligibleStudent(app);
    await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'ExponentPushToken[wrk1]', platform: 'android' });
    const d = await createOpenDrive(app, officer, { company: { name: 'WorkerCo' }, deadline: DEADLINE });
    const before = (await request(app).get(`${B}/notifications/unread-count`).set(auth(s))).body.count;

    // nothing due yet
    let res = await runDueReminders(pool, fakePush, new Date('2031-03-10T08:59:59+05:30'));
    expect(res.sent).toBe(0);
    // 09:00:01 -> t60 fires
    res = await runDueReminders(pool, fakePush, new Date('2031-03-10T09:00:01+05:30'));
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const again = await runDueReminders(pool, fakePush, new Date('2031-03-10T09:00:02+05:30'));
    expect(again.sent).toBe(0);
    const n = await request(app).get(`${B}/notifications`).set(auth(s));
    const rem = n.body.items.filter((x: any) => x.type === 'reminder' && x.data.driveId === d.id);
    expect(rem).toHaveLength(1);
    expect(rem[0].title).toBe('Closing in 1 hour');
    expect(rem[0].body).toMatch(/WorkerCo/);
    expect(rem[0].body).toMatch(/10:00 AM IST/);
    expect(rem[0].data.driveId).toBe(d.id);
    expect((await request(app).get(`${B}/notifications/unread-count`).set(auth(s))).body.count).toBe(before + 1);
    const pushed = sent.flat().filter((m) => m.to === 'ExponentPushToken[wrk1]');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].title).toBe('Closing in 1 hour');
    expect(pushed[0].data).toMatchObject({ driveId: d.id });

    await runDueReminders(pool, fakePush, new Date('2031-03-10T09:45:30+05:30'));
    const all = (await rows(d.id, s.id)).map((x) => x.status);
    expect(all).toEqual(['sent', 'sent', 'sent']);
  });

  it('never sends at/after the deadline and skips applicants, closed drives, disabled kinds', async () => {
    const applied = await makeEligibleStudent(app);
    const optOut = await makeEligibleStudent(app);
    const normal = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'GuardRemCo' }, deadline: DEADLINE });
    await request(app).put(`${B}/reminder-settings`).set(auth(optOut)).send({ t60: false });
    // simulate a stale pending reminder for an applicant (belt and braces: worker re-checks)
    await applyTo(app, applied, d.id);
    await pool.query(`UPDATE scheduled_reminders SET status='pending' WHERE drive_id=$1 AND user_id=$2`, [d.id, applied.id]);
    // at 09:00:01 only t60 is due
    await runDueReminders(pool, fakePush, new Date('2031-03-10T09:00:01+05:30'));
    expect((await rows(d.id, applied.id)).find((x) => x.kind === 't60')!.status).toBe('cancelled');
    expect((await rows(d.id, optOut.id)).find((x) => x.kind === 't60')!.status).toBe('skipped');
    expect((await rows(d.id, normal.id)).find((x) => x.kind === 't60')!.status).toBe('sent');
    const nA = (await request(app).get(`${B}/notifications`).set(auth(applied))).body.items.filter((x: any) => x.type === 'reminder' && x.data.driveId === d.id);
    expect(nA).toHaveLength(0);
    // after the deadline: everything left is cancelled, nothing sent
    const after = await runDueReminders(pool, fakePush, new Date('2031-03-10T10:00:01+05:30'));
    expect(after.sent).toBe(0);
    expect((await rows(d.id, normal.id)).filter((x) => x.status === 'cancelled')).toHaveLength(2);
  });

  it('quiet hours: in-app only, no push', async () => {
    const s = await makeEligibleStudent(app);
    await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'ExponentPushToken[quiet1]', platform: 'ios' });
    // deadline 03:00 IST => reminders 02:00 etc (inside 22:00-07:00)
    const d = await createOpenDrive(app, officer, { company: { name: 'QuietCo' }, deadline: '2031-03-11T03:00:00+05:30' });
    await request(app).put(`${B}/reminder-settings`).set(auth(s)).send({ quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    await runDueReminders(pool, fakePush, new Date('2031-03-11T02:00:05+05:30'));
    const n = (await request(app).get(`${B}/notifications`).set(auth(s))).body.items.filter((x: any) => x.type === 'reminder' && x.data.driveId === d.id);
    expect(n).toHaveLength(1);
    expect(sent.flat().some((m) => m.to === 'ExponentPushToken[quiet1]')).toBe(false);
  });

  it('push disabled -> in-app only; inApp disabled with push enabled -> push only; both off -> skipped', async () => {
    const a = await makeEligibleStudent(app);
    const b = await makeEligibleStudent(app);
    const c = await makeEligibleStudent(app);
    for (const [u, tok] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) await request(app).post(`${B}/devices`).set(auth(u)).send({ expoPushToken: `ExponentPushToken[mode${tok}]`, platform: 'android' });
    await request(app).put(`${B}/reminder-settings`).set(auth(a)).send({ push: false });
    await request(app).put(`${B}/reminder-settings`).set(auth(b)).send({ inApp: false });
    await request(app).put(`${B}/reminder-settings`).set(auth(c)).send({ inApp: false, push: false });
    const d = await createOpenDrive(app, officer, { company: { name: 'ModesCo' }, deadline: '2031-03-12T10:00:00+05:30' });
    await runDueReminders(pool, fakePush, new Date('2031-03-12T09:00:05+05:30'));
    const cnt = async (u: any) => (await request(app).get(`${B}/notifications`).set(auth(u))).body.items.filter((x: any) => x.type === 'reminder' && x.data.driveId === d.id).length;
    expect(await cnt(a)).toBe(1);
    expect(await cnt(b)).toBe(0);
    expect(await cnt(c)).toBe(0);
    const toks = sent.flat().map((m) => m.to);
    expect(toks).toContain('ExponentPushToken[modeb]');
    expect(toks).not.toContain('ExponentPushToken[modea]');
    expect(toks).not.toContain('ExponentPushToken[modec]');
    expect((await rows(d.id, c.id)).find((x) => x.kind === 't60')!.status).toBe('skipped');
  });

  it('two concurrent workers never double-send (SKIP LOCKED)', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'ConcurrentCo' }, deadline: '2031-03-13T10:00:00+05:30' });
    const now = new Date('2031-03-13T09:00:05+05:30');
    await Promise.all([runDueReminders(pool, fakePush, now), runDueReminders(pool, fakePush, now), runDueReminders(pool, fakePush, now)]);
    const n = (await request(app).get(`${B}/notifications`).set(auth(s))).body.items.filter((x: any) => x.type === 'reminder' && x.data.driveId === d.id);
    expect(n).toHaveLength(1);
  });

  it('removes tokens Expo reports as unregistered', async () => {
    const s = await makeEligibleStudent(app);
    await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'ExponentPushToken[dead1]', platform: 'android' });
    await createOpenDrive(app, officer, { company: { name: 'DeadTokenCo' }, deadline: '2031-03-14T10:00:00+05:30' });
    const calls: any[] = [];
    const fakeFetch = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const msgs = JSON.parse(init.body) as { to: string }[];
      return { ok: true, json: async () => ({ data: msgs.map((m) => (m.to.includes('dead1') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) };
    }) as any;
    const sender = createExpoPushSender(fakeFetch);
    await runDueReminders(pool, sender, new Date('2031-03-14T09:00:05+05:30'));
    expect(calls[0].url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls.flatMap((c) => c.body).some((m: any) => m.to === 'ExponentPushToken[dead1]')).toBe(true);
    expect((await pool.query(`SELECT count(*)::int n FROM devices WHERE expo_push_token='ExponentPushToken[dead1]'`)).rows[0].n).toBe(0);
  });

  it('push sender never throws on network failure', async () => {
    const sender = createExpoPushSender((async () => { throw new Error('offline'); }) as any, undefined, () => undefined);
    await expect(sender([{ to: 'ExponentPushToken[x]', title: 't', body: 'b' }])).resolves.toEqual({ invalidTokens: [] });
  });
});
