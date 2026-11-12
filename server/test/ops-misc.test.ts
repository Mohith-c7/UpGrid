import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, fakePush, makeApp, makeEligibleStudent, makeOtherTenant, pool, register, sent } from './helpers';
import { mkApp, mkDrive, mkStudent, resetOps, T1 } from './opsHelpers';
import { resolveCohort } from '../src/policy/cohorts';
import { runDueAnnouncements, setAnnouncementMailer } from '../src/ops/announcements';
import { migrate } from '../src/migrator';
import { buildIcs } from '../src/ops/calendar';
import { maskMeta, recordAudit } from '../src/policy/audit';
import { normalizeName } from '../src/routes/opsCompanies';

const app = makeApp();
const B = '/api/v1';
let officer: Awaited<ReturnType<typeof register>>;
let other: Awaited<ReturnType<typeof makeOtherTenant>>;

beforeAll(async () => {
  await resetOps();
  officer = await register(app, 'officer');
  other = await makeOtherTenant('om');
});
/** The calendar test replaces the real module tables with stand-ins; put the real schema back so later files see it. */
async function restoreModuleTables() {
  await pool.query('DROP TABLE IF EXISTS assessments, offers, attendance_sessions CASCADE');
  await pool.query('DELETE FROM schema_migrations');
  await migrate(pool);
}
afterAll(async () => { await restoreModuleTables(); await resetOps(); await pool.end(); });

describe('cohorts', () => {
  const ids: Record<string, string> = {};
  let driveId = '';
  beforeAll(async () => {
    ids.a = await mkStudent({ name: 'A', dept: 'Computer Science', batch: 2026, cgpa: 9, reg: 'CSE22A1' });
    ids.b = await mkStudent({ name: 'B', dept: 'Computer Science', batch: 2026, cgpa: 6.5, reg: 'CSE22A2' });
    ids.c = await mkStudent({ name: 'C', dept: 'Electronics', batch: 2026, cgpa: 8, reg: 'ECE22A1' });
    ids.d = await mkStudent({ name: 'D', dept: 'Computer Science', batch: 2025, cgpa: 8, backlogs: 2, verified: false, reg: 'CSE21A1' });
    driveId = await mkDrive(officer.id, { rules: {} });
    await mkApp(driveId, ids.a, ['submitted', 'screening', 'selected', 'offer_issued', 'offer_accepted']);
    await mkApp(driveId, ids.b, ['submitted']);
  });
  const create = (b: any) => request(app).post(`${B}/cohorts`).set(auth(officer)).send(b);
  const members = async (id: string) => (await request(app).get(`${B}/cohorts/${id}/members`).set(auth(officer))).body;

  it('dynamic filters resolve the right students and stay live', async () => {
    const c1 = await create({ name: 'CSE 2026', kind: 'dynamic', filter: { departments: ['computer science'], batches: [2026] } });
    expect(c1.status).toBe(201);
    expect(c1.body.cohort.memberCount).toBe(2);
    expect((await resolveCohort(pool, c1.body.cohort.id)).sort()).toEqual([ids.a, ids.b].sort());
    const hi = await create({ name: 'High CGPA', kind: 'dynamic', filter: { minCgpa: 8 } });
    expect((await members(hi.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['A', 'C', 'D']);
    const placed = await create({ name: 'Placed', kind: 'dynamic', filter: { placement: 'placed' } });
    expect((await members(placed.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['A']);
    const unplaced = await create({ name: 'Unplaced CSE', kind: 'dynamic', filter: { placement: 'unplaced', departments: ['Computer Science'] } });
    expect((await members(unplaced.body.cohort.id)).total).toBe(2); // CSE students B and D (A is placed)
    const napp = await create({ name: 'Not applied', kind: 'dynamic', filter: { notAppliedToDriveId: driveId } });
    expect((await members(napp.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['C', 'D']);
    const ver = await create({ name: 'Unverified', kind: 'dynamic', filter: { verified: false, maxActiveBacklogs: 2 } });
    expect((await members(ver.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['D']);
    const pre = await create({ name: 'ECE reg', kind: 'dynamic', filter: { registrationPrefix: 'ece' } });
    expect((await members(pre.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['C']);
    // live: a new matching student appears without editing the cohort
    await mkStudent({ name: 'E', dept: 'Computer Science', batch: 2026 });
    expect((await request(app).get(`${B}/cohorts/${c1.body.cohort.id}`).set(auth(officer))).body.cohort.memberCount).toBe(3);
  });
  it('fixed cohorts take explicit members and reject unknown / foreign students', async () => {
    const f = await create({ name: 'Hand picked', kind: 'fixed', studentIds: [ids.a, ids.c] });
    expect(f.body.cohort.memberCount).toBe(2);
    const add = await request(app).put(`${B}/cohorts/${f.body.cohort.id}/members`).set(auth(officer)).send({ add: [ids.d], remove: [ids.a] });
    expect((await members(f.body.cohort.id)).items.map((m: any) => m.name)).toEqual(['C', 'D']);
    expect(add.body.cohort.memberCount).toBe(2);
    expect((await create({ name: 'Foreign', kind: 'fixed', studentIds: [other.student.id] })).status).toBe(400);
    expect((await create({ name: 'Mixed', kind: 'fixed', filter: {} })).status).toBe(400);
    expect((await create({ name: 'Hand picked', kind: 'fixed', studentIds: [] })).status).toBe(409);
    const dyn = await create({ name: 'Dyn2', kind: 'dynamic', filter: {} });
    expect((await request(app).put(`${B}/cohorts/${dyn.body.cohort.id}/members`).set(auth(officer)).send({ add: [ids.a] })).body.error.code).toBe('COHORT_NOT_FIXED');
    expect(await resolveCohort(pool, f.body.cohort.id, other.tenantId)).toEqual([]); // wrong tenant
    expect(await resolveCohort(pool, '00000000-0000-4000-8000-0000000000aa')).toEqual([]);
  });
  it('preview, validation, tenant scoping and permissions', async () => {
    const pv = await request(app).post(`${B}/cohorts/preview`).set(auth(officer)).send({ kind: 'dynamic', filter: { batches: [2025] } });
    expect(pv.body.count).toBe(1);
    expect((await create({ name: 'Bad', kind: 'dynamic', filter: { minCgpa: 11 } })).status).toBe(400);
    expect((await create({ name: 'Bad2', kind: 'dynamic', filter: { whatever: 1 } })).status).toBe(400);
    const cid = (await request(app).get(`${B}/cohorts`).set(auth(officer))).body.items[0].id;
    expect((await request(app).get(`${B}/cohorts/${cid}`).set(auth(other.officer))).status).toBe(404);
    expect((await request(app).get(`${B}/cohorts`).set(auth(other.officer))).body.items).toEqual([]);
    expect((await request(app).get(`${B}/cohorts`).set(auth(other.student))).status).toBe(403);
    const upd = await request(app).put(`${B}/cohorts/${cid}`).set(auth(officer)).send({ name: 'Renamed cohort' });
    expect(upd.body.cohort.name).toBe('Renamed cohort');
    expect((await request(app).delete(`${B}/cohorts/${cid}`).set(auth(officer))).status).toBe(200);
  });
});

describe('announcements v2', () => {
  let stu1: Awaited<ReturnType<typeof makeEligibleStudent>>, stu2: Awaited<ReturnType<typeof makeEligibleStudent>>;
  const post = (b: any) => request(app).post(`${B}/announcements-v2`).set(auth(officer)).send(b);
  let N = 0; // students in the tenant
  beforeAll(async () => {
    stu1 = await makeEligibleStudent(app); stu2 = await makeEligibleStudent(app);
    N = (await pool.query(`SELECT count(*)::int n FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL`, [T1])).rows[0].n;
    await request(app).post(`${B}/devices`).set(auth(stu1)).send({ expoPushToken: 'ExponentPushToken[ops-test-1]', platform: 'android' });
  });

  it('sends now to all students (in-app + push), tracks delivery and read receipts', async () => {
    sent.length = 0;
    const r = await post({ title: 'Welcome', body: 'Placement season starts Monday', audience: { type: 'all' } });
    expect(r.status).toBe(201);
    expect(r.body.announcement).toMatchObject({ status: 'sent', delivered: N, read: 0 });
    expect(sent.flat().filter((m) => m.title === 'Welcome')).toHaveLength(1);
    const n = await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='announcement' AND data->>'announcementId'=$1`, [r.body.announcement.id]);
    expect(n.rows[0].n).toBe(r.body.announcement.delivered);
    const feed = await request(app).get(`${B}/announcements-v2/feed`).set(auth(stu1));
    expect(feed.body.items[0]).toMatchObject({ title: 'Welcome', read: false });
    expect((await request(app).post(`${B}/announcements-v2/${r.body.announcement.id}/read`).set(auth(stu1))).status).toBe(200);
    expect((await request(app).post(`${B}/announcements-v2/${r.body.announcement.id}/read`).set(auth(stu1))).status).toBe(200); // idempotent
    const det = await request(app).get(`${B}/announcements-v2/${r.body.announcement.id}`).set(auth(officer));
    expect(det.body.announcement).toMatchObject({ delivered: r.body.announcement.delivered, read: 1 });
    expect((await request(app).get(`${B}/announcements-v2/feed`).set(auth(stu1))).body.items[0].read).toBe(true);
    // the read-marked in-app notification too
    expect((await pool.query(`SELECT read_at FROM notifications WHERE user_id=$1 AND type='announcement'`, [stu1.id])).rows[0].read_at).not.toBeNull();
    expect((await request(app).post(`${B}/announcements-v2/${r.body.announcement.id}/read`).set(auth(other.student))).status).toBe(404);
  });

  it('scheduled announcements: edit/delete before send, worker delivers exactly once even when run concurrently', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await post({ title: 'Past', body: 'x', audience: { type: 'all' }, sendAt: new Date(Date.now() - 5000).toISOString() })).status).toBe(400);
    const s = await post({ title: 'Mock test Friday', body: 'Bring ID', audience: { type: 'all' }, sendAt: future, channels: { push: true, inApp: true, email: false } });
    expect(s.body.announcement.status).toBe('scheduled');
    const id = s.body.announcement.id;
    const upd = await request(app).put(`${B}/announcements-v2/${id}`).set(auth(officer)).send({ body: 'Bring ID and pen' });
    expect(upd.body.announcement.body).toBe('Bring ID and pen');
    expect((await request(app).get(`${B}/announcements-v2/${id}`).set(auth(officer))).body.announcement.audienceCount).toBe(N);
    const del = await post({ title: 'Delete me', body: 'x', audience: { type: 'all' }, sendAt: future });
    expect((await request(app).delete(`${B}/announcements-v2/${del.body.announcement.id}`).set(auth(officer))).status).toBe(200);
    expect((await request(app).get(`${B}/announcements-v2/${del.body.announcement.id}`).set(auth(officer))).status).toBe(404);
    // not due yet => worker does nothing
    expect(await runDueAnnouncements(pool, fakePush)).toBe(0);
    await pool.query(`UPDATE announcements SET send_at = now() - interval '1 minute' WHERE id=$1`, [id]);
    sent.length = 0;
    const runs = await Promise.all([runDueAnnouncements(pool, fakePush), runDueAnnouncements(pool, fakePush), runDueAnnouncements(pool, fakePush)]);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await runDueAnnouncements(pool, fakePush)).toBe(0);
    const d = await pool.query(`SELECT count(*)::int n FROM announcement_deliveries WHERE announcement_id=$1`, [id]);
    expect(d.rows[0].n).toBe(N);
    expect((await pool.query(`SELECT count(*)::int n FROM notifications WHERE data->>'announcementId'=$1`, [id])).rows[0].n).toBe(N);
    expect(sent.flat().filter((m) => m.title === 'Mock test Friday')).toHaveLength(1); // one device in total
    const after = await request(app).get(`${B}/announcements-v2/${id}`).set(auth(officer));
    expect(after.body.announcement).toMatchObject({ status: 'sent', recipients: N });
    expect((await request(app).put(`${B}/announcements-v2/${id}`).set(auth(officer)).send({ title: 'Too late' })).body.error.code).toBe('ALREADY_SENT');
    expect((await request(app).delete(`${B}/announcements-v2/${id}`).set(auth(officer))).body.error.code).toBe('ALREADY_SENT');
    expect((await request(app).post(`${B}/announcements-v2/${id}/send`).set(auth(officer))).status).toBe(200); // idempotent
    expect((await pool.query(`SELECT count(*)::int n FROM notifications WHERE data->>'announcementId'=$1`, [id])).rows[0].n).toBe(N);
  });

  it('audiences: cohort, drive participants, eligible-not-applied; pin and expiry; email hook', async () => {
    const d = await mkDrive(officer.id, { rules: {} });
    await mkApp(d, stu1.id, ['submitted']);
    const part = await post({ title: 'Participants', body: 'Round 1 tomorrow', audience: { type: 'drive_participants', driveId: d } });
    expect(part.body.announcement.delivered).toBe(1);
    const nap = await post({ title: 'Reminder', body: 'Apply soon', audience: { type: 'eligible_not_applied', driveId: d } });
    const napUsers = (await pool.query('SELECT user_id FROM announcement_deliveries WHERE announcement_id=$1', [nap.body.announcement.id])).rows.map((x) => x.user_id);
    expect(napUsers).toContain(stu2.id);
    expect(napUsers).not.toContain(stu1.id);
    const co = await request(app).post(`${B}/cohorts`).set(auth(officer)).send({ name: 'Ann cohort', kind: 'fixed', studentIds: [stu2.id] });
    const sc = await post({ title: 'Cohort msg', body: 'For you', audience: { type: 'cohort', cohortId: co.body.cohort.id }, pinned: true });
    expect(sc.body.announcement).toMatchObject({ delivered: 1, pinned: true });
    expect((await request(app).get(`${B}/announcements-v2/feed`).set(auth(stu2))).body.items[0].title).toBe('Cohort msg'); // pinned first
    // scheduled announcement that uses the cohort blocks its deletion
    await post({ title: 'Later', body: 'later', audience: { type: 'cohort', cohortId: co.body.cohort.id }, sendAt: new Date(Date.now() + 7200_000).toISOString() });
    expect((await request(app).delete(`${B}/cohorts/${co.body.cohort.id}`).set(auth(officer))).body.error.code).toBe('COHORT_IN_USE');
    expect((await post({ title: 'Bad', body: 'x', audience: { type: 'cohort', cohortId: '00000000-0000-4000-8000-0000000000aa' } })).status).toBe(400);
    expect((await post({ title: 'Bad', body: 'x', audience: { type: 'drive_participants', driveId: other.tenantId } })).status).toBe(400);
    // expiry hides from the feed
    await request(app).post(`${B}/announcements-v2/${sc.body.announcement.id}/pin`).set(auth(officer)).send({ pinned: false });
    await pool.query(`UPDATE announcements SET expires_at = now() - interval '1 second' WHERE id=$1`, [sc.body.announcement.id]);
    expect((await request(app).get(`${B}/announcements-v2/feed`).set(auth(stu2))).body.items.map((i: any) => i.title)).not.toContain('Cohort msg');
    // email hook
    const mails: any[] = [];
    setAnnouncementMailer(async (m) => { mails.push(m); });
    const em = await post({ title: 'Email me', body: 'by mail', audience: { type: 'all' }, channels: { inApp: true, push: false, email: true } });
    expect(mails.map((m) => m.subject)).toEqual(Array(N).fill('Email me'));
    expect((await pool.query(`SELECT count(*)::int n FROM announcement_deliveries WHERE announcement_id=$1 AND email_status='sent'`, [em.body.announcement.id])).rows[0].n).toBe(N);
    setAnnouncementMailer(null);
    const nm = await post({ title: 'No mailer', body: 'x', audience: { type: 'all' }, channels: { inApp: true, push: false, email: true } });
    expect((await pool.query(`SELECT count(*)::int n FROM announcement_deliveries WHERE announcement_id=$1 AND email_status='no_mailer'`, [nm.body.announcement.id])).rows[0].n).toBe(N);
  });

  it('templates, drafts, tenant scoping and permissions', async () => {
    const t = await request(app).post(`${B}/announcement-templates`).set(auth(officer)).send({ name: 'Deadline', title: 'Deadline today', body: 'Closes at 5 PM' });
    expect(t.status).toBe(201);
    expect((await request(app).get(`${B}/announcement-templates`).set(auth(officer))).body.items).toHaveLength(1);
    expect((await request(app).get(`${B}/announcement-templates`).set(auth(other.officer))).body.items).toHaveLength(0);
    const dr = await post({ title: 'Draft', body: 'wip', audience: { type: 'all' }, draft: true, templateId: t.body.template.id });
    expect(dr.body.announcement.status).toBe('draft');
    expect((await request(app).post(`${B}/announcements-v2/${dr.body.announcement.id}/send`).set(auth(officer))).body.announcement.status).toBe('sent');
    expect((await request(app).get(`${B}/announcements-v2/${dr.body.announcement.id}`).set(auth(other.officer))).status).toBe(404);
    expect((await post.call(null, { title: '', body: 'x', audience: { type: 'all' } })).status).toBe(400);
    expect((await request(app).post(`${B}/announcements-v2`).set(auth(stu1)).send({ title: 'x', body: 'y', audience: { type: 'all' } })).status).toBe(403);
    expect((await request(app).get(`${B}/announcements-v2/feed`).set(auth(officer))).status).toBe(403);
    expect((await request(app).get(`${B}/announcements-v2/feed`).set(auth(other.student))).body.items).toEqual([]);
  });
});

describe('calendar and ICS feed', () => {
  let stu: Awaited<ReturnType<typeof makeEligibleStudent>>;
  let driveId = '', appId = '';
  beforeAll(async () => {
    stu = await makeEligibleStudent(app);
    driveId = await mkDrive(officer.id, { company: 'Calendar, Inc;', role: 'Dev', rules: {}, deadlineHours: 30 });
    const other2 = await mkDrive(officer.id, { company: 'Elsewhere', rules: { minCgpa: 9.9 }, deadlineHours: 40 });
    void other2;
    appId = await mkApp(await mkDrive(officer.id, { company: 'Interviewers', rules: {}, deadlineHours: 90 }), stu.id, ['submitted', 'screening', 'interview']);
    await pool.query(`INSERT INTO application_schedules (tenant_id, application_id, type, scheduled_at, mode, venue_or_link) VALUES ($1,$2,'interview',now() + interval '2 days','online','https://meet.example.com/x')`, [T1, appId]);
  });
  const range = `from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86400_000).toISOString())}`;

  it('student sees own deadlines (eligible only) and interviews; officer sees drive closings and all interviews', async () => {
    const s = await request(app).get(`${B}/calendar?${range}`).set(auth(stu));
    expect(s.status).toBe(200);
    const kinds = s.body.items.map((e: any) => `${e.kind}:${e.title}`);
    expect(kinds.some((k: string) => k.startsWith('deadline:Apply by: Calendar, Inc;'))).toBe(true);
    expect(kinds.some((k: string) => k.includes('Elsewhere'))).toBe(false); // not eligible
    expect(s.body.items.some((e: any) => e.kind === 'interview' && e.applicationId === appId)).toBe(true);
    expect(s.body.items.map((e: any) => e.startsAt)).toEqual([...s.body.items.map((e: any) => e.startsAt)].sort());
    const o = await request(app).get(`${B}/calendar?${range}`).set(auth(officer));
    expect(o.body.items.some((e: any) => e.kind === 'drive_closing' && e.driveId === driveId)).toBe(true);
    expect(o.body.items.some((e: any) => e.kind === 'interview')).toBe(true);
    expect((await request(app).get(`${B}/calendar?${range}`).set(auth(other.officer))).body.items).toEqual([]);
    expect((await request(app).get(`${B}/calendar?from=2026-01-01&to=2027-12-31`).set(auth(stu))).status).toBe(400);
    expect((await request(app).get(`${B}/calendar?from=bad`).set(auth(stu))).status).toBe(400);
  });

  it('events from modules that are not merged are skipped; present ones are included (to_regclass + column probes)', async () => {
    await pool.query('DROP TABLE IF EXISTS assessments, offers, attendance_sessions CASCADE');
    const none = await request(app).get(`${B}/calendar?${range}`).set(auth(officer));
    expect(none.status).toBe(200);
    await pool.query(`CREATE TABLE assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, title text, starts_at timestamptz, ends_at timestamptz, status text)`);
    await pool.query(`INSERT INTO assessments (tenant_id, title, starts_at, ends_at, status) VALUES ($1,'Aptitude test', now() + interval '3 days', now() + interval '3 days 1 hour','published'), ($1,'Draft test', now() + interval '3 days', null, 'draft')`, [T1]);
    await pool.query(`CREATE TABLE attendance_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, name text, start_at timestamptz)`);
    await pool.query(`INSERT INTO attendance_sessions (tenant_id, name, start_at) VALUES ($1,'PPT session', now() + interval '1 day')`, [T1]);
    await pool.query(`CREATE TABLE offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, application_id uuid, expires_at timestamptz, status text)`);
    await pool.query(`INSERT INTO offers (tenant_id, application_id, expires_at, status) VALUES ($1,$2, now() + interval '4 days','issued'), ($1,$2, now() + interval '5 days','accepted')`, [T1, appId]);
    const s = await request(app).get(`${B}/calendar?${range}`).set(auth(stu));
    const k = s.body.items.map((e: any) => `${e.kind}:${e.title}`);
    expect(k).toContain('test:Test: Aptitude test');
    expect(k.filter((x: string) => x.startsWith('offer_expiry'))).toHaveLength(1);
    expect(k.some((x: string) => x.includes('Draft test'))).toBe(false);
    expect(k.some((x: string) => x.startsWith('attendance'))).toBe(false); // officer only
    const o = await request(app).get(`${B}/calendar?${range}`).set(auth(officer));
    expect(o.body.items.some((e: any) => e.kind === 'attendance' && e.title.includes('PPT session'))).toBe(true);
    // a table with an unexpected shape is skipped, never an error
    await pool.query('ALTER TABLE assessments DROP COLUMN starts_at');
    expect((await request(app).get(`${B}/calendar?${range}`).set(auth(stu))).status).toBe(200);
    await restoreModuleTables();
  });

  it('ICS feed: token shown once, valid ICS, rotation and revocation, own events only', async () => {
    expect((await request(app).get(`${B}/calendar.ics?token=abc`)).status).toBe(404);
    expect((await request(app).get(`${B}/calendar.ics`)).status).toBe(404);
    expect((await request(app).get(`${B}/calendar/feed-token`).set(auth(stu))).body.active).toBe(false);
    const t = await request(app).post(`${B}/calendar/feed-token`).set(auth(stu));
    expect(t.status).toBe(201);
    const token = t.body.token as string;
    expect(t.body.url).toContain(token);
    expect((await pool.query(`SELECT token_hash FROM calendar_tokens`)).rows.every((r) => r.token_hash !== token)).toBe(true); // only the hash is stored
    const ics = await request(app).get(`${B}/calendar.ics?token=${token}`);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain('SUMMARY:Apply by: Calendar\\, Inc\; - Dev');
    expect(ics.text).not.toContain('Elsewhere');
    // rotate => old token dies
    const t2 = await request(app).post(`${B}/calendar/feed-token`).set(auth(stu));
    expect((await request(app).get(`${B}/calendar.ics?token=${token}`)).status).toBe(404);
    expect((await request(app).get(`${B}/calendar.ics?token=${t2.body.token}`)).status).toBe(200);
    // revoke
    expect((await request(app).delete(`${B}/calendar/feed-token`).set(auth(stu))).status).toBe(200);
    expect((await request(app).get(`${B}/calendar.ics?token=${t2.body.token}`)).status).toBe(404);
    expect((await request(app).get(`${B}/calendar/feed-token`).set(auth(stu))).body.active).toBe(false);
  });
  it('buildIcs folds long lines and escapes text', () => {
    const ics = buildIcs([{ id: 'x1', kind: 'test', title: 'A'.repeat(200) + ', B; C\nD', startsAt: '2026-11-07T10:00:00.000Z', endsAt: null, driveId: null, applicationId: null, refId: 'x', detail: 'd', link: null }], new Date('2026-11-01T00:00:00Z'));
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics).toContain('DTSTART:20261107T100000Z');
    expect(ics).toContain('DTEND:20261107T110000Z');
    expect(ics.replace(/\r\n /g, '')).toContain('\\, B\; C\\nD');
  });
});

describe('company CRM', () => {
  let cid = '';
  const post = (b: any, as = officer) => request(app).post(`${B}/crm/companies`).set(auth(as)).send(b);
  it('creates, detects duplicates by normalised name and website host, allows force', async () => {
    expect(normalizeName('Acme Technologies Pvt. Ltd.')).toBe('acme');
    const c = await post({ name: 'Acme Technologies Pvt Ltd', website: 'https://www.acme.com', industry: 'Software', hq: 'Pune', tags: ['it', 'mass-recruiter'],
      contacts: [{ name: 'Riya Rao', role: 'HR', email: 'riya@acme.com', phone: '9876543210' }], notes: 'Met at career fair' });
    expect(c.status).toBe(201);
    cid = c.body.company.id;
    expect(c.body.company.stage).toBe('prospect');
    const d1 = await post({ name: 'ACME Inc' });
    expect(d1.status).toBe(409);
    expect(d1.body.error).toMatchObject({ code: 'DUPLICATE_COMPANY', fields: { existingId: cid } });
    expect((await post({ name: 'Totally different', website: 'https://acme.com/careers' })).body.error.code).toBe('DUPLICATE_COMPANY');
    const forced = await post({ name: 'ACME Inc', force: true });
    expect(forced.status).toBe(201);
    const dups = await request(app).get(`${B}/crm/companies/duplicates`).set(auth(officer));
    expect(dups.body.groups.length).toBeGreaterThanOrEqual(1);
    expect(dups.body.groups[0].companies.map((x: any) => x.id)).toContain(cid);
    expect((await post({ name: 'x' })).status).toBe(400);
    expect((await post({ name: 'Bad Site', website: 'http://insecure.com' })).status).toBe(400);
    expect((await post({ name: 'Bad Contact', contacts: [{ name: 'A', email: 'nope' }] })).status).toBe(400);
  });
  it('search, update, stage pipeline, interactions and follow-ups, drive links, export', async () => {
    expect((await request(app).get(`${B}/crm/companies?q=acme&stage=prospect`).set(auth(officer))).body.items.length).toBe(2);
    expect((await request(app).get(`${B}/crm/companies?tag=mass-recruiter`).set(auth(officer))).body.items.map((c: any) => c.id)).toEqual([cid]);
    for (const stage of ['contacted', 'interested', 'mou', 'hiring']) {
      expect((await request(app).post(`${B}/crm/companies/${cid}/stage`).set(auth(officer)).send({ stage })).body.company.stage).toBe(stage);
    }
    expect((await request(app).post(`${B}/crm/companies/${cid}/stage`).set(auth(officer)).send({ stage: 'nope' })).status).toBe(400);
    const when = new Date(Date.now() - 3600_000).toISOString();
    const fu = new Date(Date.now() + 2 * 86400_000).toISOString();
    const i = await request(app).post(`${B}/crm/companies/${cid}/interactions`).set(auth(officer)).send({ type: 'call', occurredAt: when, summary: 'Discussed hiring plan', followUpAt: fu });
    expect(i.status).toBe(201);
    expect((await request(app).post(`${B}/crm/companies/${cid}/interactions`).set(auth(officer)).send({ type: 'call', occurredAt: when, summary: 'bad followup', followUpAt: new Date(Date.now() - 86400_000 * 2).toISOString() })).status).toBe(400);
    const fups = await request(app).get(`${B}/crm/follow-ups?days=7`).set(auth(officer));
    expect(fups.body.items.map((x: any) => x.id)).toContain(i.body.interaction.id);
    await request(app).put(`${B}/crm/companies/${cid}/interactions/${i.body.interaction.id}`).set(auth(officer)).send({ followUpDone: true });
    expect((await request(app).get(`${B}/crm/follow-ups`).set(auth(officer))).body.items.map((x: any) => x.id)).not.toContain(i.body.interaction.id);
    const list = await request(app).get(`${B}/crm/companies?q=technologies`).set(auth(officer));
    expect(list.body.items[0]).toMatchObject({ id: cid, stage: 'hiring' });
    expect(list.body.items[0].lastInteractionAt).toBeTruthy();
    const d = await mkDrive(officer.id, { company: 'Acme Technologies', fixed: 12, variable: 2, status: 'closed' });
    const d2 = await mkDrive(officer.id, { company: 'Acme Technologies', fixed: 18, status: 'closed', role: 'SRE' });
    await request(app).post(`${B}/crm/companies/${cid}/drives`).set(auth(officer)).send({ driveId: d });
    await request(app).post(`${B}/crm/companies/${cid}/drives`).set(auth(officer)).send({ driveId: d2 });
    expect((await request(app).post(`${B}/crm/companies/${cid}/drives`).set(auth(officer)).send({ driveId: other.tenantId })).status).toBe(404);
    const det = await request(app).get(`${B}/crm/companies/${cid}`).set(auth(officer));
    expect(det.body.drives).toHaveLength(2);
    expect(det.body.company.driveCount).toBe(2);
    await request(app).put(`${B}/crm/companies/${cid}`).set(auth(officer)).send({ name: '=cmd|calc', verified: true, notes: 'updated' });
    const csv = await request(app).get(`${B}/crm/companies/export`).set(auth(officer));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain("'=cmd|calc");
    expect((await request(app).put(`${B}/crm/companies/${cid}`).set(auth(officer)).send({ name: 'ACME Inc' })).body.error.code).toBe('DUPLICATE_COMPANY');
  });
  it('student directory shows only verified or hiring companies, public fields, past visits and aggregate ranges', async () => {
    const stu = await register(app, 'student');
    await post({ name: 'Hidden Prospect', industry: 'Retail' });
    const dir = await request(app).get(`${B}/company-directory`).set(auth(stu));
    expect(dir.status).toBe(200);
    expect(dir.body.items.map((c: any) => c.name)).toEqual(['=cmd|calc']);
    const row = dir.body.items[0];
    expect(Object.keys(row).sort()).toEqual(['hq', 'id', 'industry', 'logoFileId', 'name', 'pastVisits', 'verified', 'website']);
    expect(row.pastVisits.count).toBe(2);
    expect(row.pastVisits.lastVisitAt).toBeTruthy();
    const det = await request(app).get(`${B}/company-directory/${row.id}`).set(auth(stu));
    expect(det.body.ctcRange).toEqual({ minLpa: 14, maxLpa: 18, drives: 2 });
    expect(det.body.roles.sort()).toEqual(['Engineer', 'SRE']);
    expect(JSON.stringify(det.body)).not.toMatch(/Riya|riya@|9876543210|Met at career fair|updated/);
    const hidden = (await request(app).get(`${B}/crm/companies?q=hidden`).set(auth(officer))).body.items[0].id;
    expect((await request(app).get(`${B}/company-directory/${hidden}`).set(auth(stu))).status).toBe(404);
    expect((await request(app).get(`${B}/company-directory?q=hidden`).set(auth(stu))).body.items).toEqual([]);
  });
  it('permissions and tenant scoping', async () => {
    const stu = await register(app, 'student');
    expect((await request(app).get(`${B}/crm/companies`).set(auth(stu))).status).toBe(403);
    expect((await post({ name: 'Nope Co' }, stu as any)).status).toBe(403);
    expect((await request(app).get(`${B}/crm/companies/${cid}`).set(auth(other.officer))).status).toBe(404);
    expect((await request(app).get(`${B}/crm/companies`).set(auth(other.officer))).body.items).toEqual([]);
    expect((await post({ name: 'Acme Technologies' }, other.officer)).status).toBe(201); // same name allowed in another tenant
    expect((await request(app).get(`${B}/company-directory`).set(auth(other.student))).body.items).toEqual([]);
    expect((await request(app).delete(`${B}/crm/companies/${cid}`).set(auth(other.officer))).status).toBe(404);
  });
});

describe('audit log', () => {
  it('masks sensitive fields (pure)', () => {
    expect(maskMeta({ password: 'x', nested: { apiToken: 'abc', email: 'riya@acme.com', phone: '9876543210', ok: 1 }, list: [{ secret: 1 }] })).toEqual({
      password: '***', nested: { apiToken: '***', email: 'r***@acme.com', phone: '98******10', ok: 1 }, list: [{ secret: '***' }],
    });
  });
  it('filters by actor, entity, action (exact and prefix), date and text, paginates, masks and exports', async () => {
    await pool.query('DELETE FROM audit_events');
    const o2 = await register(app, 'officer');
    const e = (actor: string, action: string, entityType: string, entityId: string, meta: any = {}, at?: string) =>
      pool.query(`INSERT INTO audit_events (tenant_id, actor_id, action, entity_type, entity_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()))`,
        [T1, actor, action, entityType, entityId, JSON.stringify(meta), at ?? null]);
    await e(officer.id, 'policy.activate', 'policy_version', 'pv1', { version: 2 }, '2026-10-01T10:00:00Z');
    await e(officer.id, 'offer.issue', 'application', 'app1', { studentEmail: 'x@y.com', email: 'riya@acme.com' }, '2026-10-02T10:00:00Z');
    await e(o2.id, 'invite.create', 'invite', 'inv1', { token: 'SECRET-TOKEN', phone: '9876543210' }, '2026-10-03T10:00:00Z');
    await e(o2.id, 'policy.rollback', 'policy_version', 'pv2', {}, '2026-10-04T10:00:00Z');
    await pool.query(`INSERT INTO audit_events (tenant_id, actor_id, action, meta) VALUES ($1,$2,'students.import','{"total":5}')`, [other.tenantId, other.officer.id]);
    await recordAudit(pool, { tenantId: T1, actorId: officer.id, action: 'override.eligibility', entityType: 'drive', entityId: 'd9', meta: { reason: 'dean approval', password: 'p' } });
    const get = (qs: string) => request(app).get(`${B}/audit?${qs}`).set(auth(officer));
    expect((await get('')).body.items).toHaveLength(5);
    expect((await get('')).body.items[0].action).toBe('override.eligibility'); // newest first
    expect((await get(`actorId=${o2.id}`)).body.items.map((i: any) => i.action).sort()).toEqual(['invite.create', 'policy.rollback']);
    expect((await get('action=policy.*')).body.items.map((i: any) => i.action).sort()).toEqual(['policy.activate', 'policy.rollback']);
    expect((await get('action=offer.issue')).body.items).toHaveLength(1);
    expect((await get('entityType=policy_version&entityId=pv2')).body.items).toHaveLength(1);
    expect((await get('from=2026-10-02&to=2026-10-03')).body.items.map((i: any) => i.action).sort()).toEqual(['invite.create', 'offer.issue']);
    expect((await get('q=dean')).body.items).toHaveLength(1);
    expect((await get('action=%25')).body.items).toHaveLength(0); // wildcards are escaped
    const inv = (await get('action=invite.create')).body.items[0];
    expect(inv.meta).toEqual({ token: '***', phone: '98******10' });
    expect(inv.actorName).toBe('Test User');
    const off = (await get('action=offer.issue')).body.items[0];
    expect(off.meta.email).toBe('r***@acme.com');
    expect(JSON.stringify((await get('')).body)).not.toMatch(/SECRET-TOKEN|riya@acme\.com|"password":"p"/);
    const p1 = await get('limit=2');
    expect(p1.body.items).toHaveLength(2);
    const p2 = await get(`limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.items[0].id).toBeLessThan(p1.body.items[1].id);
    expect((await get('limit=500')).status).toBe(400);
    expect((await get('actorId=nope')).status).toBe(400);
    const acts = await request(app).get(`${B}/audit/actions`).set(auth(officer));
    expect(acts.body.items).toEqual(expect.arrayContaining(['policy.activate', 'invite.create']));
    expect(acts.body.items).not.toContain('students.import'); // other tenant's
    const csv = await request(app).get(`${B}/audit/export?action=invite.*`).set(auth(officer));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('invite.create');
    expect(csv.text).not.toContain('SECRET-TOKEN');
    const js = await request(app).get(`${B}/audit/export?format=json&action=policy.*`).set(auth(officer));
    expect(js.body.rows).toHaveLength(2);
    expect((await request(app).get(`${B}/audit?action=audit.export`).set(auth(officer))).body.items.length).toBe(2);
  });
  it('is officer-only and tenant scoped', async () => {
    const stu = await register(app, 'student');
    expect((await request(app).get(`${B}/audit`).set(auth(stu))).status).toBe(403);
    expect((await request(app).get(`${B}/audit/export`).set(auth(stu))).status).toBe(403);
    const o = await request(app).get(`${B}/audit`).set(auth(other.officer));
    expect(o.body.items.map((i: any) => i.action)).toEqual(['students.import']);
  });
});

describe('document verification queue', () => {
  let stu: Awaited<ReturnType<typeof register>>;
  const ids: string[] = [];
  beforeAll(async () => { stu = await register(app, 'student'); });
  it('student submits documents; validation and files-module fallback', async () => {
    const post = (b: any) => request(app).post(`${B}/documents`).set(auth(stu)).send(b);
    for (const [docType, label] of [['marksheet', 'Semester 6 marksheet'], ['id_proof', 'College ID card'], ['resume', 'Resume 2026']]) {
      const r = await post({ docType, label, url: `https://example.com/${docType}.pdf` });
      expect(r.status).toBe(201);
      expect(r.body.document.status).toBe('pending');
      ids.push(r.body.document.id);
    }
    expect((await post({ docType: 'marksheet', label: 'Both', url: 'https://example.com/a.pdf', fileId: '00000000-0000-4000-8000-0000000000aa' })).status).toBe(400);
    expect((await post({ docType: 'marksheet', label: 'None' })).status).toBe(400);
    expect((await post({ docType: 'marksheet', label: 'Insecure', url: 'http://example.com/a.pdf' })).status).toBe(400);
    expect((await post({ docType: 'passport', label: 'Bad type', url: 'https://example.com/a.pdf' })).status).toBe(400);
    const f = await post({ docType: 'marksheet', label: 'Via files', fileId: '00000000-0000-4000-8000-0000000000aa' });
    expect(f.status).toBe(400); // no files module installed => clear message, no crash
    expect(f.body.error.fields.fileId).toBeTruthy();
    const mine = await request(app).get(`${B}/documents/mine`).set(auth(stu));
    expect(mine.body.items).toHaveLength(3);
    expect(mine.body.completion.percent).toBe(0);
  });
  it('officer queue, verify, reject with reason, bulk verify; notifications; profile verification feeds completion', async () => {
    const q = await request(app).get(`${B}/documents/queue`).set(auth(officer));
    expect(q.body.items).toHaveLength(3);
    expect(q.body.items[0].student).toMatchObject({ id: stu.id });
    expect((await request(app).get(`${B}/documents/queue?docType=resume`).set(auth(officer))).body.items).toHaveLength(1);
    const v = await request(app).post(`${B}/documents/${ids[0]}/verify`).set(auth(officer)).send({ note: 'Matches records' });
    expect(v.body.document).toMatchObject({ status: 'verified', reviewedBy: officer.id });
    expect((await pool.query(`SELECT verification FROM profiles WHERE user_id=$1`, [stu.id])).rows[0]?.verification?.['documents.marksheet']).toBe('verified');
    expect((await request(app).post(`${B}/documents/${ids[0]}/verify`).set(auth(officer)).send({})).body.error.code).toBe('NOT_PENDING');
    expect((await request(app).post(`${B}/documents/${ids[1]}/reject`).set(auth(officer)).send({})).status).toBe(400);
    const rj = await request(app).post(`${B}/documents/${ids[1]}/reject`).set(auth(officer)).send({ reason: 'Photo is blurry, please re-upload' });
    expect(rj.body.document).toMatchObject({ status: 'rejected', rejectReason: 'Photo is blurry, please re-upload' });
    const bulk = await request(app).post(`${B}/documents/bulk-verify`).set(auth(officer)).send({ ids: [ids[0], ids[1], ids[2], '00000000-0000-4000-8000-0000000000aa'] });
    expect(bulk.body.verified).toBe(1);
    expect(bulk.body.skipped).toHaveLength(3);
    const notes = await pool.query(`SELECT title FROM notifications WHERE user_id=$1 AND type='document' ORDER BY created_at`, [stu.id]);
    expect(notes.rows.map((r) => r.title)).toEqual(['Document verified', 'Document needs attention', 'Document verified']);
    const mine = await request(app).get(`${B}/documents/mine`).set(auth(stu));
    expect(mine.body.completion).toMatchObject({ percent: 67 });
    expect(mine.body.completion.verified.sort()).toEqual(['marksheet', 'resume']);
    expect((await request(app).delete(`${B}/documents/${ids[0]}`).set(auth(stu))).body.error.code).toBe('DOCUMENT_VERIFIED');
    expect((await request(app).delete(`${B}/documents/${ids[1]}`).set(auth(stu))).status).toBe(200);
    // re-submitted + rejected verified key is removed
    const again = await request(app).post(`${B}/documents`).set(auth(stu)).send({ docType: 'id_proof', label: 'ID again', url: 'https://example.com/id2.pdf' });
    await request(app).post(`${B}/documents/${again.body.document.id}/verify`).set(auth(officer)).send({});
    expect((await pool.query(`SELECT verification FROM profiles WHERE user_id=$1`, [stu.id])).rows[0].verification['documents.id_proof']).toBe('verified');
    const audit = await request(app).get(`${B}/audit?action=document.*`).set(auth(officer));
    expect(audit.body.items.map((i: any) => i.action)).toEqual(expect.arrayContaining(['document.verify', 'document.reject']));
  });
  it('permissions and tenant scoping', async () => {
    expect((await request(app).get(`${B}/documents/queue`).set(auth(stu))).status).toBe(403);
    expect((await request(app).post(`${B}/documents/${ids[0]}/verify`).set(auth(stu)).send({})).status).toBe(403);
    expect((await request(app).get(`${B}/documents/mine`).set(auth(officer))).status).toBe(403);
    expect((await request(app).get(`${B}/documents/queue`).set(auth(other.officer))).body.items).toEqual([]);
    expect((await request(app).post(`${B}/documents/${ids[2]}/reject`).set(auth(other.officer)).send({ reason: 'cross tenant attempt' })).status).toBe(404);
    expect((await request(app).delete(`${B}/documents/${ids[2]}`).set(auth(other.student))).status).toBe(404);
  });
});
