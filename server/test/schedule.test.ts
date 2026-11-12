import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDueReminders, upsertScheduleReminder } from '../src/reminders';
import { validateScheduledAt, validateVenueOrLink } from '../src/validation';
import { auth, fakePush, makeApp, makeOtherTenant, pool, register, resetDb, screenedApplication, sent } from './helpers';

const B = '/api/v1';
const app = makeApp();
let officer: Awaited<ReturnType<typeof register>>;

const inHours = (h: number) => new Date(Date.now() + h * 3600_000);
const valid = (over: Record<string, unknown> = {}) => ({
  type: 'interview', scheduledAt: inHours(48).toISOString(), mode: 'online', venueOrLink: 'https://meet.example.com/abc-def', instructions: 'Keep ID ready', ...over,
});
const schedule = (applicationId: string, body: unknown, who = officer) =>
  request(app).post(`${B}/applications/${applicationId}/schedule`).set(auth(who)).send(body as any);
const sr = async (applicationId: string) =>
  (await pool.query(`SELECT kind, fire_at, status, schedule_id FROM scheduled_reminders WHERE application_id=$1 ORDER BY fire_at`, [applicationId])).rows;

beforeAll(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  officer = await register(app, 'officer');
});
afterAll(async () => { await pool.end(); });

describe('schedule validators (pure)', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  it('accepts a future UTC instant and returns a Date', () => {
    const r = validateScheduledAt('2030-01-02T04:30:00Z', now);
    expect(r.ok && r.value.toISOString()).toBe('2030-01-02T04:30:00.000Z');
    expect(validateScheduledAt('2030-01-02T10:00:00+05:30', now).ok).toBe(true);
  });
  it('rejects past, equal-to-now, too far ahead, malformed, no-zone and impossible dates', () => {
    for (const bad of ['2029-12-31T23:59:59Z', '2030-01-01T00:00:00Z', '2031-01-02T00:00:00Z', 'tomorrow', '2030-01-02', '2030-01-02T10:00:00', '2030-02-30T10:00:00Z', '2030-01-02T25:00:00Z', 1735689600, null, undefined, '']) {
      expect(validateScheduledAt(bad as any, now).ok, String(bad)).toBe(false);
    }
  });
  it('venue rules by mode', () => {
    expect(validateVenueOrLink('online', 'https://meet.example.com/x').ok).toBe(true);
    for (const bad of ['http://meet.example.com/x', 'javascript:alert(1)', 'ftp://a.b/c', 'meet.example.com', 'https://', 'https://exa mple.com', '']) {
      expect(validateVenueOrLink('online', bad).ok, bad).toBe(false);
    }
    expect(validateVenueOrLink('in_person', 'Room 12').ok).toBe(true);
    expect(validateVenueOrLink('in_person', 'ab').ok).toBe(false);
    expect(validateVenueOrLink('in_person', 'x'.repeat(200)).ok).toBe(true);
    expect(validateVenueOrLink('in_person', 'x'.repeat(201)).ok).toBe(false);
    expect(validateVenueOrLink('in_person', 'Hall\u0000 1').ok).toBe(false);
  });
});

describe('POST /applications/:id/schedule', () => {
  it('is officer only and requires authentication', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    expect((await request(app).post(`${B}/applications/${applicationId}/schedule`).send(valid())).status).toBe(401);
    expect((await schedule(applicationId, valid(), student as any)).status).toBe(403);
    const d = await request(app).get(`${B}/applications/${applicationId}`).set(auth(student));
    expect(d.body.application.status).toBe('screening');
    expect(d.body.application.schedule).toBeNull();
    expect(d.body.schedule).toBeNull();
  });

  it('moves screening to interview, stores the schedule, appends an event and notifies the student (in-app + push, IST)', async () => {
    const { student, applicationId, drive } = await screenedApplication(app, officer, { company: { name: 'SchedCo' } });
    await request(app).post(`${B}/devices`).set(auth(student)).send({ expoPushToken: 'ExponentPushToken[sched1]', platform: 'android' });
    const soon = new Date(Date.now() + 5 * 86400_000);
    soon.setUTCHours(4, 30, 0, 0); // 10:00 AM IST on a future day
    const r = await schedule(applicationId, valid({ scheduledAt: soon.toISOString() }));
    expect(r.status).toBe(200);
    expect(r.body.application).toEqual({ id: applicationId, status: 'interview' });
    expect(r.body.schedule).toEqual({ type: 'interview', scheduledAt: soon.toISOString(), mode: 'online', venueOrLink: 'https://meet.example.com/abc-def', instructions: 'Keep ID ready' });
    expect(r.body.rescheduled).toBe(false);

    const d = await request(app).get(`${B}/applications/${applicationId}`).set(auth(student));
    expect(d.body.application.status).toBe('interview');
    expect(d.body.application.schedule).toEqual(r.body.schedule);
    expect(d.body.schedule).toEqual(r.body.schedule);
    const ev = d.body.application.events.at(-1);
    expect(ev).toMatchObject({ status: 'interview', actorRole: 'officer' });
    expect(ev.note).toMatch(/Interview scheduled for .*10:00 AM IST \(online\)/);
    // officers can read it too
    expect((await request(app).get(`${B}/applications/${applicationId}`).set(auth(officer))).body.application.schedule).toEqual(r.body.schedule);

    const n = (await request(app).get(`${B}/notifications`).set(auth(student))).body.items.filter((x: any) => x.type === 'schedule');
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Interview scheduled: SchedCo');
    expect(n[0].body).toMatch(/10:00 AM IST/);
    expect(n[0].body).toMatch(/https:\/\/meet\.example\.com\/abc-def/);
    expect(n[0].body).toMatch(/Keep ID ready/);
    expect(n[0].data).toMatchObject({ applicationId, driveId: drive.id, scheduleType: 'interview', scheduledAt: soon.toISOString() });
    const pushed = sent.flat().filter((m) => m.to === 'ExponentPushToken[sched1]');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].title).toBe('Interview scheduled: SchedCo');
  });

  it('assessment in person, instructions optional, then assessment to interview keeps only the latest schedule live', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    const a = await schedule(applicationId, { type: 'assessment', scheduledAt: inHours(24).toISOString(), mode: 'in_person', venueOrLink: 'Lab 3, Block B' });
    expect(a.status).toBe(200);
    expect(a.body.application.status).toBe('assessment');
    expect(a.body.schedule.instructions).toBeNull();
    const i = await schedule(applicationId, valid());
    expect(i.status).toBe(200);
    expect(i.body.application.status).toBe('interview');
    expect(i.body.rescheduled).toBe(true); // replaces the assessment slot
    const d = await request(app).get(`${B}/applications/${applicationId}`).set(auth(student));
    expect(d.body.application.schedule.type).toBe('interview');
    const live = await pool.query('SELECT type FROM application_schedules WHERE application_id=$1 AND superseded_at IS NULL', [applicationId]);
    expect(live.rows).toEqual([{ type: 'interview' }]);
    expect((await pool.query('SELECT count(*)::int n FROM application_schedules WHERE application_id=$1', [applicationId])).rows[0].n).toBe(2);
  });

  it('rescheduling the same round is allowed, wording changes, event is appended', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    await schedule(applicationId, valid());
    const again = await schedule(applicationId, valid({ scheduledAt: inHours(72).toISOString(), mode: 'in_person', venueOrLink: 'Seminar Hall' }));
    expect(again.status).toBe(200);
    expect(again.body.rescheduled).toBe(true);
    expect(again.body.schedule).toMatchObject({ mode: 'in_person', venueOrLink: 'Seminar Hall' });
    const n = (await request(app).get(`${B}/notifications`).set(auth(student))).body.items.filter((x: any) => x.type === 'schedule');
    expect(n.map((x: any) => x.title).sort()).toEqual(['Interview rescheduled: Acme Demo Co', 'Interview scheduled: Acme Demo Co']);
    const events = (await request(app).get(`${B}/applications/${applicationId}`).set(auth(student))).body.application.events;
    expect(events.filter((e: any) => e.status === 'interview')).toHaveLength(2);
    expect(events.at(-1).note).toMatch(/^Interview rescheduled for/);
  });

  it('validates every field and reports them together', async () => {
    const { applicationId } = await screenedApplication(app, officer);
    const bad = await schedule(applicationId, { type: 'hr', scheduledAt: 'soon', mode: 'phone', venueOrLink: 'x', instructions: 'y'.repeat(501) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['instructions', 'mode', 'scheduledAt', 'type']);

    const cases: [Record<string, unknown>, string][] = [
      [{ scheduledAt: inHours(-1).toISOString() }, 'scheduledAt'],
      [{ scheduledAt: new Date().toISOString() }, 'scheduledAt'],
      [{ scheduledAt: inHours(24 * 400).toISOString() }, 'scheduledAt'],
      [{ scheduledAt: '2031-02-30T10:00:00Z' }, 'scheduledAt'],
      [{ scheduledAt: inHours(24).toISOString().replace('Z', '') }, 'scheduledAt'],
      [{ venueOrLink: 'http://meet.example.com/x' }, 'venueOrLink'],
      [{ venueOrLink: 'javascript:alert(1)' }, 'venueOrLink'],
      [{ venueOrLink: 'meet.example.com/x' }, 'venueOrLink'],
      [{ venueOrLink: '' }, 'venueOrLink'],
      [{ venueOrLink: 'ab', mode: 'in_person' }, 'venueOrLink'],
      [{ venueOrLink: 'v'.repeat(201), mode: 'in_person' }, 'venueOrLink'],
      [{ venueOrLink: 'https://meet.example.com/x', mode: 'in_person', instructions: 'ok' }, ''],
      [{ instructions: 'a\u0000b' }, 'instructions'],
      [{ instructions: 'z'.repeat(501) }, 'instructions'],
      [{ mode: undefined }, 'mode'],
      [{ type: undefined }, 'type'],
      [{ extra: 1 }, 'extra'],
    ];
    for (const [over, field] of cases) {
      const r = await schedule(applicationId, valid(over));
      if (field === '') { expect(r.status, JSON.stringify(over)).toBe(200); continue; }
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.fields[field], JSON.stringify(over)).toBeTruthy();
    }
    expect((await schedule(applicationId, valid({ instructions: 'ö'.repeat(500) }))).status).toBe(200);
    expect((await schedule(applicationId, valid({ instructions: '' }))).body.schedule.instructions).toBeNull();
    expect((await request(app).post(`${B}/applications/${applicationId}/schedule`).set(auth(officer)).send([1])).status).toBe(400);
  });

  it('INVALID_TRANSITION (422) leaves no schedule, event or notification behind', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    await schedule(applicationId, valid()); // now interview
    const back = await schedule(applicationId, valid({ type: 'assessment' }));
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe('INVALID_TRANSITION');
    // a submitted (not yet screened) application cannot be scheduled either
    const fresh = await screenedApplication(app, officer);
    await request(app).post(`${B}/applications/${fresh.applicationId}/status`).set(auth(officer)).send({ status: 'rejected' });
    const rej = await schedule(fresh.applicationId, valid());
    expect(rej.status).toBe(422);
    expect(rej.body.error.code).toBe('INVALID_TRANSITION');
    expect((await pool.query('SELECT count(*)::int n FROM application_schedules WHERE application_id=$1', [fresh.applicationId])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='schedule' AND user_id=$1`, [fresh.student.id])).rows[0].n).toBe(0);
    expect((await sr(fresh.applicationId))).toHaveLength(0);
    const d = await request(app).get(`${B}/applications/${applicationId}`).set(auth(student));
    expect(d.body.application.status).toBe('interview');
    expect(d.body.application.schedule.type).toBe('interview');
  });

  it('submitted applications can be scheduled directly (no screening step needed)', async () => {
    const { makeEligibleStudent, createOpenDrive, applyTo } = await import('./helpers');
    for (const type of ['interview', 'assessment'] as const) {
      const s = await makeEligibleStudent(app);
      const d = await createOpenDrive(app, officer);
      const ap = await applyTo(app, s, d.id);
      const r = await schedule(ap.body.application.id, valid({ type }));
      expect(r.status).toBe(200);
      expect(r.body.application.status).toBe(type);
      const det = await request(app).get(`${B}/applications/${ap.body.application.id}`).set(auth(s));
      expect(det.body.application.events.map((e: any) => e.status)).toEqual(['submitted', type]);
    }
  });
  it('POST /applications/:id/status also allows submitted -> assessment / interview', async () => {
    const { makeEligibleStudent, createOpenDrive, applyTo } = await import('./helpers');
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer);
    const ap = await applyTo(app, s, d.id);
    const det = await request(app).get(`${B}/applications/${ap.body.application.id}`).set(auth(officer));
    expect(det.body.application.allowedNextStatuses).toEqual(expect.arrayContaining(['screening', 'assessment', 'interview']));
    const st = await request(app).post(`${B}/applications/${ap.body.application.id}/status`).set(auth(officer)).send({ status: 'assessment' });
    expect(st.status).toBe(200);
    expect(st.body.application.status).toBe('assessment');
    // submitted still cannot jump past the interview rounds
    const s2 = await makeEligibleStudent(app);
    const ap2 = await applyTo(app, s2, d.id);
    const bad = await request(app).post(`${B}/applications/${ap2.body.application.id}/status`).set(auth(officer)).send({ status: 'selected' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('404 for unknown ids, 400 for malformed ids, and tenant scoping', async () => {
    const { applicationId } = await screenedApplication(app, officer);
    expect((await schedule('00000000-0000-4000-8000-000000000999', valid())).status).toBe(404);
    expect((await schedule('not-a-uuid', valid())).status).toBe(400);
    const t2 = await makeOtherTenant('a');
    expect((await schedule(applicationId, valid(), t2.officer)).status).toBe(404);
    expect((await pool.query('SELECT count(*)::int n FROM application_schedules')).rows[0].n).toBe(0);
  });

  it('push respects the student push setting', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    await request(app).post(`${B}/devices`).set(auth(student)).send({ expoPushToken: 'ExponentPushToken[nopush]', platform: 'ios' });
    await request(app).put(`${B}/reminder-settings`).set(auth(student)).send({ push: false });
    sent.length = 0;
    expect((await schedule(applicationId, valid())).status).toBe(200);
    expect(sent.flat()).toHaveLength(0);
    expect((await request(app).get(`${B}/notifications`).set(auth(student))).body.items.some((x: any) => x.type === 'schedule')).toBe(true);
  });
});

describe('schedule reminders (60 minutes before)', () => {
  it('creates one pending sched60 reminder, sends it once with the IST time, and is idempotent', async () => {
    const { student, applicationId, drive } = await screenedApplication(app, officer, { company: { name: 'RemindCo' } });
    await request(app).post(`${B}/devices`).set(auth(student)).send({ expoPushToken: 'ExponentPushToken[sr1]', platform: 'android' });
    const at = inHours(48);
    await schedule(applicationId, valid({ scheduledAt: at.toISOString() }));
    const rows = await sr(applicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('sched60');
    expect(rows[0].status).toBe('pending');
    expect(new Date(rows[0].fire_at).getTime()).toBe(at.getTime() - 3600_000);

    sent.length = 0;
    const early = await runDueReminders(pool, fakePush, new Date(at.getTime() - 61 * 60_000));
    expect(early.sent).toBe(0);
    const fire = await runDueReminders(pool, fakePush, new Date(at.getTime() - 59 * 60_000));
    expect(fire.sent).toBe(1);
    const n = (await request(app).get(`${B}/notifications`).set(auth(student))).body.items.filter((x: any) => x.type === 'schedule_reminder');
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Interview in 1 hour');
    expect(n[0].body).toMatch(/RemindCo/);
    expect(n[0].body).toMatch(/IST/);
    expect(n[0].data).toMatchObject({ applicationId, driveId: drive.id, kind: 'sched60' });
    expect(sent.flat().filter((m) => m.to === 'ExponentPushToken[sr1]')).toHaveLength(1);
    const again = await runDueReminders(pool, fakePush, new Date(at.getTime() - 30 * 60_000));
    expect(again.sent).toBe(0);
    expect((await request(app).get(`${B}/notifications`).set(auth(student))).body.items.filter((x: any) => x.type === 'schedule_reminder')).toHaveLength(1);
  });

  it('rescheduling replaces the reminder (never two), and the old time no longer fires', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    const first = inHours(48);
    const second = inHours(96);
    await schedule(applicationId, valid({ scheduledAt: first.toISOString() }));
    await schedule(applicationId, valid({ scheduledAt: second.toISOString() }));
    const rows = await sr(applicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(new Date(rows[0].fire_at).getTime()).toBe(second.getTime() - 3600_000);
    const out = await runDueReminders(pool, fakePush, new Date(first.getTime() - 30 * 60_000));
    expect(out.sent).toBe(0);
    expect((await request(app).get(`${B}/notifications`).set(auth(student))).body.items.filter((x: any) => x.type === 'schedule_reminder')).toHaveLength(0);
  });

  it('rescheduling to less than 60 minutes away cancels the pending reminder instead of firing late', async () => {
    const { applicationId } = await screenedApplication(app, officer);
    await schedule(applicationId, valid());
    expect((await sr(applicationId))[0].status).toBe('pending');
    await schedule(applicationId, valid({ scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString() }));
    const rows = await sr(applicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
  });

  it('a schedule less than 60 minutes away creates no reminder', async () => {
    const { applicationId } = await screenedApplication(app, officer);
    await schedule(applicationId, valid({ scheduledAt: new Date(Date.now() + 20 * 60_000).toISOString() }));
    expect(await sr(applicationId)).toHaveLength(0);
  });

  it('upsertScheduleReminder is idempotent', async () => {
    const { student, applicationId, drive } = await screenedApplication(app, officer);
    const at = inHours(10);
    await schedule(applicationId, valid({ scheduledAt: at.toISOString() }));
    const sch = (await pool.query('SELECT id FROM application_schedules WHERE application_id=$1 AND superseded_at IS NULL', [applicationId])).rows[0];
    const input = { tenantId: '00000000-0000-4000-8000-000000000001', driveId: drive.id, userId: student.id, applicationId, scheduleId: sch.id, scheduledAt: at };
    await upsertScheduleReminder(pool, input);
    await upsertScheduleReminder(pool, input);
    expect(await sr(applicationId)).toHaveLength(1);
  });

  it('is cancelled at send time when the application is no longer in an interview/assessment stage', async () => {
    const { student, applicationId } = await screenedApplication(app, officer);
    const at = inHours(48);
    await schedule(applicationId, valid({ scheduledAt: at.toISOString() }));
    await request(app).post(`${B}/applications/${applicationId}/status`).set(auth(officer)).send({ status: 'rejected' });
    const out = await runDueReminders(pool, fakePush, new Date(at.getTime() - 59 * 60_000));
    expect(out.sent).toBe(0);
    expect(out.cancelled).toBe(1);
    expect((await request(app).get(`${B}/notifications`).set(auth(student))).body.items.some((x: any) => x.type === 'schedule_reminder')).toBe(false);
  });

  it('does not fire after the interview has started', async () => {
    const { applicationId } = await screenedApplication(app, officer);
    const at = inHours(48);
    await schedule(applicationId, valid({ scheduledAt: at.toISOString() }));
    const out = await runDueReminders(pool, fakePush, new Date(at.getTime() + 60_000));
    expect(out.sent).toBe(0);
    expect((await sr(applicationId))[0].status).toBe('cancelled');
  });

  it('survives drive close, which only cancels deadline reminders', async () => {
    const { applicationId, drive } = await screenedApplication(app, officer);
    await schedule(applicationId, valid());
    expect((await request(app).post(`${B}/drives/${drive.id}/close`).set(auth(officer))).status).toBe(200);
    expect((await sr(applicationId))[0].status).toBe('pending');
  });

  it('honours quiet hours (in-app only) and disabled in-app + push (skipped)', async () => {
    const q = await screenedApplication(app, officer);
    await request(app).post(`${B}/devices`).set(auth(q.student)).send({ expoPushToken: 'ExponentPushToken[quietsr]', platform: 'ios' });
    await request(app).put(`${B}/reminder-settings`).set(auth(q.student)).send({ quietHours: { enabled: true, start: '00:00', end: '23:59' } });
    const at = inHours(48);
    await schedule(q.applicationId, valid({ scheduledAt: at.toISOString() }));
    const o = await screenedApplication(app, officer);
    await request(app).put(`${B}/reminder-settings`).set(auth(o.student)).send({ inApp: false, push: false });
    await schedule(o.applicationId, valid({ scheduledAt: at.toISOString() }));
    sent.length = 0;
    const out = await runDueReminders(pool, fakePush, new Date(at.getTime() - 59 * 60_000));
    expect(out.sent).toBe(1);
    expect(out.skipped).toBe(1);
    expect(sent.flat().filter((m) => m.to === 'ExponentPushToken[quietsr]')).toHaveLength(0);
    expect((await request(app).get(`${B}/notifications`).set(auth(q.student))).body.items.some((x: any) => x.type === 'schedule_reminder')).toBe(true);
  });
});

describe('POST /drives/:id/schedule-bulk', () => {
  const bulk = (driveId: string, body: unknown, who = officer) =>
    request(app).post(`${B}/drives/${driveId}/schedule-bulk`).set(auth(who)).send(body as any);

  it('schedules many, reports per-application failures, and is officer only', async () => {
    const a = await screenedApplication(app, officer, { company: { name: 'BulkCo' } });
    const { makeEligibleStudent, applyTo } = await import('./helpers');
    const s2 = await makeEligibleStudent(app);
    const ap2 = await applyTo(app, s2, a.drive.id);
    await request(app).post(`${B}/applications/${ap2.body.application.id}/status`).set(auth(officer)).send({ status: 'rejected' }); // cannot be scheduled any more
    const s3 = await makeEligibleStudent(app);
    const ap3 = await applyTo(app, s3, a.drive.id);
    await request(app).post(`${B}/applications/${ap3.body.application.id}/status`).set(auth(officer)).send({ status: 'screening' });
    const other = await screenedApplication(app, officer, { company: { name: 'ElsewhereCo' } });
    const ghost = '00000000-0000-4000-8000-000000000999';

    expect((await bulk(a.drive.id, { applicationIds: [a.applicationId], ...valid() }, a.student as any)).status).toBe(403);
    const r = await bulk(a.drive.id, {
      applicationIds: [a.applicationId, ap2.body.application.id, ap3.body.application.id, other.applicationId, ghost, a.applicationId], ...valid(),
    });
    expect(r.status).toBe(200);
    expect(r.body.scheduled).toBe(2);
    expect(r.body.failed).toHaveLength(3); // duplicate id is processed once
    const byId = Object.fromEntries(r.body.failed.map((f: any) => [f.applicationId, f.reason]));
    expect(byId[ap2.body.application.id]).toMatch(/Cannot move an application from rejected to interview/);
    expect(byId[other.applicationId]).toMatch(/does not belong to this drive/);
    expect(byId[ghost]).toMatch(/not found/i);
    for (const id of [a.applicationId, ap3.body.application.id]) {
      const d = await request(app).get(`${B}/applications/${id}`).set(auth(officer));
      expect(d.body.application.status).toBe('interview');
      expect(d.body.application.schedule.venueOrLink).toBe('https://meet.example.com/abc-def');
      expect(await sr(id)).toHaveLength(1);
    }
    expect((await request(app).get(`${B}/notifications`).set(auth(s3))).body.items.filter((x: any) => x.type === 'schedule')).toHaveLength(1);
    expect((await request(app).get(`${B}/applications/${other.applicationId}`).set(auth(officer))).body.application.status).toBe('screening');
  });

  it('validates input: empty, over 200, non-uuid, bad schedule fields, unknown drive and tenant', async () => {
    const a = await screenedApplication(app, officer);
    expect((await bulk(a.drive.id, { applicationIds: [], ...valid() })).status).toBe(400);
    expect((await bulk(a.drive.id, { ...valid() })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const big = await bulk(a.drive.id, { applicationIds: many, ...valid() });
    expect(big.status).toBe(400);
    expect(big.body.error.fields.applicationIds).toMatch(/at most 200/);
    const nonUuid = await bulk(a.drive.id, { applicationIds: ['abc'], ...valid() });
    expect(nonUuid.status).toBe(400);
    expect(Object.keys(nonUuid.body.error.fields)[0]).toMatch(/^applicationIds/);
    const past = await bulk(a.drive.id, { applicationIds: [a.applicationId], ...valid({ scheduledAt: inHours(-2).toISOString() }) });
    expect(past.status).toBe(400);
    expect(past.body.error.fields.scheduledAt).toBeTruthy();
    expect((await bulk(a.drive.id, { applicationIds: [a.applicationId], ...valid({ venueOrLink: 'http://x.example.com' }) })).body.error.fields.venueOrLink).toBeTruthy();
    expect((await bulk('00000000-0000-4000-8000-000000000999', { applicationIds: [a.applicationId], ...valid() })).status).toBe(404);
    const t2 = await makeOtherTenant('b');
    expect((await bulk(a.drive.id, { applicationIds: [a.applicationId], ...valid() }, t2.officer)).status).toBe(404);
    // exactly 200 is accepted (all fail as unknown, none scheduled)
    const max = await bulk(a.drive.id, { applicationIds: many.slice(0, 200), ...valid() });
    expect(max.status).toBe(200);
    expect(max.body.scheduled).toBe(0);
    expect(max.body.failed).toHaveLength(200);
  });
});
