import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTo, auth, createOpenDrive, makeApp, makeEligibleStudent, makeOtherTenant, pool, register } from './helpers';
import { resetOps } from './opsHelpers';
import { effectiveRestrictionStatus, getActiveRestrictions, restrictedReason, RestrictionRow } from '../src/policy/restrictions';

const app = makeApp();
const B = '/api/v1';
const NOW = new Date('2026-11-07T10:00:00Z');
const R = (o: Partial<RestrictionRow> = {}): RestrictionRow => ({
  id: 'r1', scope: 'tenant', scopeValue: null, studentId: null, studentMessage: 'Placements are paused for your batch', status: 'active',
  startsAt: '2026-11-01T00:00:00Z', endsAt: null, exemptStudentIds: [], ...o,
});

describe('getActiveRestrictions (pure)', () => {
  const stu = { id: 's1', department: 'Computer Science', batchYear: 2026 };
  const drive = { id: 'd1', companyName: 'Acme Demo Co', companyId: 'c1' };
  const hit = (r: RestrictionRow, s: any = stu, d: any = drive) => getActiveRestrictions(s, d, [r], NOW).length === 1;

  it('matches by scope', () => {
    expect(hit(R({ scope: 'tenant' }))).toBe(true);
    expect(hit(R({ scope: 'student', scopeValue: 's1' }))).toBe(true);
    expect(hit(R({ scope: 'student', scopeValue: 's2' }))).toBe(false);
    expect(hit(R({ scope: 'department', scopeValue: 'computer science' }))).toBe(true);
    expect(hit(R({ scope: 'department', scopeValue: 'Electronics' }))).toBe(false);
    expect(hit(R({ scope: 'batch', scopeValue: '2026' }))).toBe(true);
    expect(hit(R({ scope: 'batch', scopeValue: '2025' }))).toBe(false);
    expect(hit(R({ scope: 'company', scopeValue: 'ACME demo co' }))).toBe(true);
    expect(hit(R({ scope: 'company', scopeValue: 'c1' }))).toBe(true);
    expect(hit(R({ scope: 'company', scopeValue: 'Other' }))).toBe(false);
    expect(hit(R({ scope: 'drive', scopeValue: 'd1' }))).toBe(true);
    expect(hit(R({ scope: 'drive', scopeValue: 'd2' }))).toBe(false);
  });
  it('company / drive scope can be narrowed to one student', () => {
    expect(hit(R({ scope: 'company', scopeValue: 'Acme Demo Co', studentId: 's1' }))).toBe(true);
    expect(hit(R({ scope: 'company', scopeValue: 'Acme Demo Co', studentId: 's2' }))).toBe(false);
    expect(hit(R({ scope: 'drive', scopeValue: 'd1', studentId: 's2' }))).toBe(false);
  });
  it('respects status, start, expiry and exemptions', () => {
    expect(hit(R({ status: 'pending_approval' }))).toBe(false);
    expect(hit(R({ status: 'lifted' }))).toBe(false);
    expect(hit(R({ status: 'rejected' }))).toBe(false);
    expect(hit(R({ startsAt: '2026-11-08T00:00:00Z' }))).toBe(false);
    expect(hit(R({ endsAt: '2026-11-07T10:00:00Z' }))).toBe(false); // ends exactly now => expired
    expect(hit(R({ endsAt: '2026-11-07T10:00:01Z' }))).toBe(true);
    expect(hit(R({ exemptStudentIds: ['s1'] }))).toBe(false);
    expect(effectiveRestrictionStatus(R({ endsAt: '2026-11-02T00:00:00Z' }), NOW)).toBe('expired');
    expect(effectiveRestrictionStatus(R({ startsAt: '2027-01-01T00:00:00Z' }), NOW)).toBe('upcoming');
  });
  it('without a drive, drive-specific scopes are still listed; missing student data never matches dept/batch', () => {
    expect(getActiveRestrictions(stu, null, [R({ scope: 'drive', scopeValue: 'dx' })], NOW).length).toBe(1);
    expect(hit(R({ scope: 'department', scopeValue: 'Computer Science' }), { id: 's1' })).toBe(false);
    expect(hit(R({ scope: 'batch', scopeValue: '2026' }), { id: 's1' })).toBe(false);
  });
  it('builds a respectful message with the appeal path', () => {
    const m = restrictedReason({ id: 'abc', studentMessage: 'Your account is on hold pending a document check.' });
    expect(m.message).toBe('Your account is on hold pending a document check. You can appeal from Profile > Restrictions.');
    expect(m.appealPath).toBe('/my/restrictions/abc/appeal');
  });
});

describe('restrictions API', () => {
  let o1: Awaited<ReturnType<typeof register>>, o2: Awaited<ReturnType<typeof register>>;
  let s1: Awaited<ReturnType<typeof makeEligibleStudent>>, s2: Awaited<ReturnType<typeof makeEligibleStudent>>;
  let drive: { id: string };
  beforeAll(async () => {
    await resetOps();
    o1 = await register(app, 'officer'); o2 = await register(app, 'officer');
    s1 = await makeEligibleStudent(app); s2 = await makeEligibleStudent(app);
    drive = await createOpenDrive(app, o1);
  });
  afterAll(async () => { await resetOps(); await pool.end(); });

  let rid = '';
  const body = (over: any = {}) => ({ scope: 'student', studentId: s1.id, reason: 'Missed two scheduled interviews without notice', studentMessage: 'Your applications are paused after missed interviews', evidenceNotes: 'Emails 3 Nov, 5 Nov', ...over });

  it('validates scope targets and time windows', async () => {
    const post = (b: any) => request(app).post(`${B}/restrictions`).set(auth(o1)).send(b);
    expect((await post(body({ studentId: undefined }))).status).toBe(400);
    expect((await post(body({ scope: 'tenant' }))).status).toBe(400);
    expect((await post(body({ scope: 'batch', studentId: undefined, scopeValue: '1999' }))).status).toBe(400);
    expect((await post(body({ scope: 'drive', studentId: undefined, scopeValue: 'nope' }))).status).toBe(400);
    expect((await post(body({ endsAt: new Date(Date.now() - 1000).toISOString() }))).status).toBe(400);
    expect((await post(body({ startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }))).status).toBe(400);
    expect((await post(body({ studentMessage: 'no' }))).status).toBe(400);
    expect((await post(body({ bogus: 1 }))).status).toBe(400);
    expect((await post(body({ studentId: '00000000-0000-4000-8000-0000000000ff' }))).status).toBe(404);
  });

  it('request -> pending; self-approval blocked; a different officer approves; student cannot act', async () => {
    const c = await request(app).post(`${B}/restrictions`).set(auth(o1)).send(body());
    expect(c.status).toBe(201);
    rid = c.body.restriction.id;
    expect(c.body.restriction).toMatchObject({ status: 'pending_approval', effectiveStatus: 'pending_approval', requestedBy: o1.id });
    // not enforced yet
    expect((await applyTo(app, s1, drive.id)).status).not.toBe(422);
    await pool.query('DELETE FROM applications'); // undo that successful apply for the later checks
    const self = await request(app).post(`${B}/restrictions/${rid}/approve`).set(auth(o1)).send({});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');
    expect((await request(app).post(`${B}/restrictions/${rid}/approve`).set(auth(s1)).send({})).status).toBe(403);
    const ok = await request(app).post(`${B}/restrictions/${rid}/approve`).set(auth(o2)).send({ note: 'Evidence checked' });
    expect(ok.status).toBe(200);
    expect(ok.body.restriction).toMatchObject({ status: 'active', approvedBy: o2.id });
    expect((await request(app).post(`${B}/restrictions/${rid}/approve`).set(auth(o2)).send({})).body.error.code).toBe('NOT_PENDING');
    const note = await pool.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='restriction'`, [s1.id]);
    expect(note.rowCount).toBe(1);
  });

  it('apply is blocked with 422 RESTRICTED, lists and preview show the restriction; other students are unaffected', async () => {
    const r = await applyTo(app, s1, drive.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('RESTRICTED');
    expect(r.body.error.message).toMatch(/paused after missed interviews\. You can appeal/);
    expect(r.body.error.fields).toMatchObject({ restrictionId: rid, appealPath: `/my/restrictions/${rid}/appeal` });
    const list = await request(app).get(`${B}/drives`).set(auth(s1));
    expect(list.body.items[0].eligibility.status).toBe('restricted');
    const det = await request(app).get(`${B}/drives/${drive.id}`).set(auth(s1));
    expect(det.body.drive.eligibility.status).toBe('restricted');
    const prev = await request(app).post(`${B}/drives/${drive.id}/application/preview`).set(auth(s1));
    expect(prev.body).toMatchObject({ canApply: false });
    expect(prev.body.blockedReason).toMatch(/appeal/);
    const other = await request(app).get(`${B}/drives/${drive.id}`).set(auth(s2));
    expect(other.body.drive.eligibility.status).toBe('eligible');
    expect((await applyTo(app, s2, drive.id)).status).toBe(201);
  });

  it('student sees only the respectful message (no evidence), can appeal once, officer overturns', async () => {
    const mine = await request(app).get(`${B}/my/restrictions`).set(auth(s1));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ id: rid, canAppeal: true, appeal: null, appealPath: `/my/restrictions/${rid}/appeal` });
    expect(JSON.stringify(mine.body)).not.toMatch(/Emails 3 Nov|Missed two scheduled/);
    expect((await request(app).get(`${B}/my/restrictions`).set(auth(s2))).body.items).toHaveLength(0);
    expect((await request(app).post(`${B}/my/restrictions/${rid}/appeal`).set(auth(s2)).send({ message: 'It is not mine to appeal at all' })).status).toBe(404);
    expect((await request(app).post(`${B}/my/restrictions/${rid}/appeal`).set(auth(s1)).send({ message: 'short' })).status).toBe(400);
    const ap = await request(app).post(`${B}/my/restrictions/${rid}/appeal`).set(auth(s1)).send({ message: 'I was in hospital on those days and have the papers.' });
    expect(ap.status).toBe(201);
    expect((await request(app).post(`${B}/my/restrictions/${rid}/appeal`).set(auth(s1)).send({ message: 'Sending the same appeal again please.' })).body.error.code).toBe('APPEAL_EXISTS');
    const pending = await request(app).get(`${B}/restrictions/appeals?status=pending`).set(auth(o1));
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0]).toMatchObject({ studentId: s1.id, restrictionId: rid });
    const decide = await request(app).post(`${B}/restrictions/appeals/${ap.body.appeal.id}/decide`).set(auth(o1)).send({ decision: 'overturn', note: 'Medical records verified' });
    expect(decide.body.appeal.status).toBe('overturned');
    expect((await request(app).post(`${B}/restrictions/appeals/${ap.body.appeal.id}/decide`).set(auth(o1)).send({ decision: 'uphold', note: 'changed my mind' })).body.error.code).toBe('APPEAL_DECIDED');
    expect((await applyTo(app, s1, drive.id)).status).toBe(201);
    expect((await request(app).get(`${B}/my/restrictions`).set(auth(s1))).body.items).toHaveLength(0);
    const hist = await request(app).get(`${B}/restrictions/${rid}`).set(auth(o1));
    expect(hist.body.history.map((h: any) => h.type)).toEqual(['requested', 'approved', 'appeal_filed', 'appeal_overturned']);
    expect(hist.body.restriction.exemptStudentIds).toEqual([s1.id]);
  });

  it('upheld appeals keep the restriction; lifting ends it; time-bound restrictions expire', async () => {
    const s3 = await makeEligibleStudent(app);
    const d3 = await createOpenDrive(app, o1);
    const c = await request(app).post(`${B}/restrictions`).set(auth(o1)).send(body({ studentId: s3.id, endsAt: new Date(Date.now() + 3600_000).toISOString() }));
    await request(app).post(`${B}/restrictions/${c.body.restriction.id}/approve`).set(auth(o2)).send({});
    expect((await applyTo(app, s3, d3.id)).body.error.code).toBe('RESTRICTED');
    const ap = await request(app).post(`${B}/my/restrictions/${c.body.restriction.id}/appeal`).set(auth(s3)).send({ message: 'Please reconsider this restriction.' });
    await request(app).post(`${B}/restrictions/appeals/${ap.body.appeal.id}/decide`).set(auth(o1)).send({ decision: 'uphold', note: 'Policy applies as written' });
    expect((await applyTo(app, s3, d3.id)).body.error.code).toBe('RESTRICTED');
    const mine = await request(app).get(`${B}/my/restrictions`).set(auth(s3));
    expect(mine.body.items[0]).toMatchObject({ canAppeal: true, appeal: { status: 'upheld' } });
    // expiry: push ends_at into the past
    await pool.query(`UPDATE restrictions SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' WHERE id=$1`, [c.body.restriction.id]);
    const list = await request(app).get(`${B}/restrictions?status=expired`).set(auth(o1));
    expect(list.body.items.map((x: any) => x.id)).toContain(c.body.restriction.id);
    expect((await applyTo(app, s3, d3.id)).status).toBe(201);
    // lift
    const s4 = await makeEligibleStudent(app);
    const c4 = await request(app).post(`${B}/restrictions`).set(auth(o1)).send(body({ studentId: s4.id }));
    expect((await request(app).post(`${B}/restrictions/${c4.body.restriction.id}/lift`).set(auth(o1)).send({ reason: 'Not active yet' })).body.error.code).toBe('NOT_ACTIVE');
    await request(app).post(`${B}/restrictions/${c4.body.restriction.id}/approve`).set(auth(o2)).send({});
    expect((await applyTo(app, s4, d3.id)).body.error.code).toBe('RESTRICTED');
    const lift = await request(app).post(`${B}/restrictions/${c4.body.restriction.id}/lift`).set(auth(o2)).send({ reason: 'Resolved with the student' });
    expect(lift.body.restriction.status).toBe('lifted');
    expect((await applyTo(app, s4, d3.id)).status).toBe(201);
  });

  it('company, drive, department, batch and tenant scopes restrict broader groups; pending edits and rejection work', async () => {
    const s5 = await makeEligibleStudent(app, { department: 'Mechanical', batchYear: 2027 });
    const dA = await createOpenDrive(app, o1, { company: { name: 'Blocked Co', verified: true }, rules: { minCgpa: 5 } });
    const dB = await createOpenDrive(app, o1, { company: { name: 'Fine Co', verified: true }, rules: { minCgpa: 5 } });
    const act = async (b: any) => {
      const c = await request(app).post(`${B}/restrictions`).set(auth(o1)).send(b);
      expect(c.status).toBe(201);
      await request(app).post(`${B}/restrictions/${c.body.restriction.id}/approve`).set(auth(o2)).send({});
      return c.body.restriction.id as string;
    };
    const msg = { reason: 'Company asked us to pause visits', studentMessage: 'Applications to this company are paused' };
    const comp = await act({ scope: 'company', scopeValue: 'blocked co', ...msg });
    expect((await applyTo(app, s5, dA.id)).body.error.code).toBe('RESTRICTED');
    const dm = await request(app).get(`${B}/drives/${dB.id}`).set(auth(s5));
    expect(dm.body.drive.eligibility.status).toBe('eligible');
    await request(app).post(`${B}/restrictions/${comp}/lift`).set(auth(o1)).send({ reason: 'Resolved' });

    const dep = await act({ scope: 'department', scopeValue: 'mechanical', ...msg });
    expect((await applyTo(app, s5, dB.id)).body.error.code).toBe('RESTRICTED');
    await request(app).post(`${B}/restrictions/${dep}/lift`).set(auth(o1)).send({ reason: 'Resolved' });
    const bat = await act({ scope: 'batch', scopeValue: '2027', ...msg });
    expect((await applyTo(app, s5, dB.id)).body.error.code).toBe('RESTRICTED');
    await request(app).post(`${B}/restrictions/${bat}/lift`).set(auth(o1)).send({ reason: 'Resolved' });
    const drv = await act({ scope: 'drive', scopeValue: dB.id, ...msg });
    expect((await applyTo(app, s5, dB.id)).body.error.code).toBe('RESTRICTED');
    expect((await applyTo(app, s5, dA.id)).status).toBe(201);
    await request(app).post(`${B}/restrictions/${drv}/lift`).set(auth(o1)).send({ reason: 'Resolved' });
    // tenant-wide freeze
    const frz = await act({ scope: 'tenant', ...msg, studentMessage: 'Placement activity is frozen for maintenance' });
    expect((await applyTo(app, s5, dB.id)).body.error.code).toBe('RESTRICTED');
    await request(app).post(`${B}/restrictions/${frz}/lift`).set(auth(o1)).send({ reason: 'Done' });
    expect((await applyTo(app, s5, dB.id)).status).toBe(201);

    const p = await request(app).post(`${B}/restrictions`).set(auth(o1)).send({ scope: 'tenant', ...msg });
    const edit = await request(app).put(`${B}/restrictions/${p.body.restriction.id}`).set(auth(o1)).send({ studentMessage: 'Updated message for students' });
    expect(edit.body.restriction.studentMessage).toBe('Updated message for students');
    const rej = await request(app).post(`${B}/restrictions/${p.body.restriction.id}/reject`).set(auth(o2)).send({ note: 'Not justified' });
    expect(rej.body.restriction.status).toBe('rejected');
    expect((await request(app).put(`${B}/restrictions/${p.body.restriction.id}`).set(auth(o1)).send({ reason: 'edit after reject' })).body.error.code).toBe('NOT_PENDING');
  });

  it('tenant setting not_required activates immediately; tenant isolation; audit trail', async () => {
    await request(app).put(`${B}/ops/settings`).set(auth(o1)).send({ restrictionApproval: 'not_required' });
    const s6 = await makeEligibleStudent(app);
    const c = await request(app).post(`${B}/restrictions`).set(auth(o1)).send(body({ studentId: s6.id }));
    expect(c.body.restriction.status).toBe('active');
    await request(app).put(`${B}/ops/settings`).set(auth(o1)).send({ restrictionApproval: 'required' });
    const other = await makeOtherTenant('rs');
    expect((await request(app).get(`${B}/restrictions/${c.body.restriction.id}`).set(auth(other.officer))).status).toBe(404);
    expect((await request(app).get(`${B}/restrictions`).set(auth(other.officer))).body.items).toHaveLength(0);
    expect((await request(app).post(`${B}/restrictions/${c.body.restriction.id}/approve`).set(auth(other.officer)).send({})).status).toBe(404);
    expect((await request(app).get(`${B}/my/restrictions`).set(auth(other.student))).body.items).toHaveLength(0);
    expect((await request(app).post(`${B}/restrictions`).set(auth(other.officer)).send(body({ studentId: s6.id }))).status).toBe(404);
    const audit = await request(app).get(`${B}/audit?action=restriction.*`).set(auth(o1));
    expect(audit.body.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(['restriction.create', 'restriction.approve', 'restriction.lift', 'restriction.reject']));
    const appealAudit = await request(app).get(`${B}/audit?action=appeal.*`).set(auth(o1));
    expect(appealAudit.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('permissions', async () => {
    expect((await request(app).get(`${B}/restrictions`).set(auth(s1))).status).toBe(403);
    expect((await request(app).post(`${B}/restrictions`).set(auth(s1)).send(body())).status).toBe(403);
    expect((await request(app).get(`${B}/my/restrictions`).set(auth(o1))).status).toBe(403);
    expect((await request(app).get(`${B}/my/restrictions`)).status).toBe(401);
  });
});
