import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, makeOtherTenant, pool, register } from './helpers';
import { mkApp, mkDrive, mkStudent, resetOps } from './opsHelpers';
import { csvSafe } from '../src/csv';

const app = makeApp();
const B = '/api/v1';
let officer: Awaited<ReturnType<typeof register>>;
let ids: Record<string, string> = {};
let driveA = '', driveB = '', driveC = '';

beforeAll(async () => {
  await resetOps();
  officer = await register(app, 'officer');
  const s = async (k: string, o: any) => { ids[k] = await mkStudent({ name: k, ...o }); };
  for (const k of ['s1', 's2', 's3', 's4', 's5', 's6']) await s(k, { dept: 'Computer Science', batch: 2026 });
  for (const k of ['e1', 'e2', 'e3']) await s(k, { dept: 'Electronics', batch: 2026 });
  for (const k of ['c1', 'c2']) await s(k, { dept: 'Computer Science', batch: 2025 });
  driveA = await mkDrive(officer.id, { company: 'Kestrel', fixed: 11, variable: 1, rules: {} });
  driveB = await mkDrive(officer.id, { company: 'Zephyra', fixed: 18, variable: 1, bonus: 1, status: 'closed', rules: {} });
  driveC = await mkDrive(officer.id, { company: 'Orbitrail', fixed: 25000, kind: 'stipend_monthly', rules: {} });
  const acc = ['submitted', 'screening', 'selected', 'offer_issued', 'offer_accepted'];
  await mkApp(driveA, ids.s1, acc);
  await mkApp(driveA, ids.s2, ['submitted', 'screening', 'selected']);
  await mkApp(driveA, ids.s3, ['submitted', 'screening', 'selected', 'offer_issued', 'offer_declined']);
  await mkApp(driveB, ids.s4, ['submitted', 'screening', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'joined']);
  await mkApp(driveA, ids.s5, ['submitted']);
  await mkApp(driveB, ids.s5, ['submitted', 'screening', 'rejected']);
  await mkApp(driveA, ids.s6, ['submitted', 'withdrawn']);
  await mkApp(driveA, ids.e1, acc);
  await mkApp(driveB, ids.c1, acc);
  await mkApp(driveC, ids.s1, ['submitted']);
});
afterAll(async () => { await resetOps(); await pool.end(); });

describe('analytics KPIs on fixtures', () => {
  it('dashboard reports selection, offers, acceptance and joining separately', async () => {
    const r = await request(app).get(`${B}/analytics/dashboard`).set(auth(officer));
    expect(r.status).toBe(200);
    const k = r.body.kpis;
    expect(k.students).toBe(11);
    expect(k.applications).toBe(9);
    expect(k.selected).toEqual({ applications: 6, students: 6 });
    expect(k.offers).toEqual({ applications: 5, students: 5 });
    expect(k.accepted).toEqual({ applications: 4, students: 4 });
    expect(k.joined).toEqual({ applications: 1, students: 1 });
    expect(k.drivesOpen).toBe(2);
    expect(k.drivesClosed).toBe(1);
    expect(k.verifiedPct).toBe(100);
    expect(k.eligibleVsApplied.eligibleSlots).toBe(33); // 3 published drives x 11 students (empty rules)
    expect(k.eligibleVsApplied.appliedSlots).toBe(9);
  });

  it('placement statistics: placed %, CTC highest/average/median, branch + batch tables, bands', async () => {
    const r = await request(app).get(`${B}/analytics/placement`).set(auth(officer));
    expect(r.body.totals).toMatchObject({ students: 11, placedStudents: 4, offeredStudents: 5, offersIssued: 5, offersPerStudent: 1 });
    expect(r.body.totals.placedPct).toBe(36.4);
    expect(r.body.ctc).toEqual({ highestLpa: 20, averageLpa: 16, medianLpa: 16, count: 4 });
    const cse = r.body.byBranch.find((b: any) => b.department === 'Computer Science');
    expect(cse).toMatchObject({ students: 8, placed: 3, highestLpa: 20 });
    const ece = r.body.byBranch.find((b: any) => b.department === 'Electronics');
    expect(ece).toMatchObject({ students: 3, placed: 1, avgLpa: 12 });
    expect(r.body.byBatch.find((b: any) => b.batchYear === 2025)).toMatchObject({ students: 2, placed: 1 });
    expect(r.body.byCompany.find((c: any) => c.company === 'Zephyra').hires).toBe(2);
    expect(r.body.ctcBands.find((b: any) => b.label === '12-20').count).toBe(2);
    expect(r.body.ctcBands.find((b: any) => b.label === '20+').count).toBe(2);
  });

  it('filters by batch, department and date range; rejects bad filters', async () => {
    const b = await request(app).get(`${B}/analytics/placement?batch=2026`).set(auth(officer));
    expect(b.body.totals).toMatchObject({ students: 9, placedStudents: 3 });
    expect(b.body.totals.placedPct).toBe(33.3);
    const d = await request(app).get(`${B}/analytics/placement?department=electronics`).set(auth(officer));
    expect(d.body.totals).toMatchObject({ students: 3, placedStudents: 1 });
    const future = await request(app).get(`${B}/analytics/dashboard?from=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`).set(auth(officer));
    expect(future.body.kpis.applications).toBe(0);
    expect((await request(app).get(`${B}/analytics/dashboard?from=nonsense`).set(auth(officer))).status).toBe(400);
    expect((await request(app).get(`${B}/analytics/dashboard?batch=1999`).set(auth(officer))).status).toBe(400);
  });

  it('funnel overall and per drive', async () => {
    const a = await request(app).get(`${B}/analytics/funnel?driveId=${driveA}`).set(auth(officer));
    const m = Object.fromEntries(a.body.stages.map((s: any) => [s.key, s.count]));
    expect(m).toMatchObject({ applied: 6, screening: 4, selected: 4, offer_issued: 3, offer_accepted: 2, joined: 0 });
    expect(a.body.withdrawn).toBe(1);
    const all = await request(app).get(`${B}/analytics/funnel`).set(auth(officer));
    expect(all.body.stages[0].count).toBe(10);
    expect((await request(app).get(`${B}/analytics/funnel?driveId=bad`).set(auth(officer))).status).toBe(400);
  });

  it('drive table: completeness, deadline-miss estimate, time-to-apply median', async () => {
    const r = await request(app).get(`${B}/analytics/drives`).set(auth(officer));
    const closed = r.body.items.find((d: any) => d.id === driveB);
    expect(closed.eligibleCount).toBe(11);
    expect(closed.applied).toBe(3);
    expect(closed.deadlineMissEstimate).toBe(8);
    const open = r.body.items.find((d: any) => d.id === driveA);
    expect(open.deadlineMissEstimate).toBe(0);
    expect(open.completenessScore).toBeGreaterThan(0);
    expect(open.medianHoursToApply).toBeGreaterThan(30); // published 96h ago, applied 60h ago => 36h
  });

  it('reminder stats and officer workload', async () => {
    await pool.query(`INSERT INTO scheduled_reminders (tenant_id, drive_id, user_id, kind, fire_at, status) VALUES ($1,$2,$3,'t60',now(),'sent'), ($1,$2,$4,'t60',now(),'skipped')`,
      ['00000000-0000-4000-8000-000000000001', driveA, ids.s1, ids.s2]);
    const r = await request(app).get(`${B}/analytics/reminders`).set(auth(officer));
    const t60 = r.body.byKind.find((k: any) => k.kind === 't60');
    expect(t60).toMatchObject({ sent: 1, skipped: 1, total: 2 });
    expect(r.body.deliveryRatePct).toBe(50);
    const w = await request(app).get(`${B}/analytics/workload`).set(auth(officer));
    expect(w.body.officers.length).toBe(1);
    expect(w.body.unassigned.applicationsAwaitingScreening).toBe(2); // s5@A and s1@C are still `submitted`; s6 withdrew
  });

  it('export is CSV with BOM and injection-safe; JSON variant; report pack', async () => {
    await pool.query(`UPDATE users SET name='=HYPERLINK("x")' WHERE id=$1`, [ids.s2]);
    await pool.query(`UPDATE drives SET company = company || '{"name":"+SUM(1)"}' WHERE id=$1`, [driveC]);
    const csv = await request(app).get(`${B}/analytics/export?dataset=drives&format=csv`).set(auth(officer));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain("'+SUM(1)");
    expect(csv.text).not.toMatch(/(^|,)\+SUM/);
    const j = await request(app).get(`${B}/analytics/export?dataset=branches&format=json`).set(auth(officer));
    expect(j.body.rows.length).toBe(2);
    const stu = await request(app).get(`${B}/analytics/export?dataset=students`).set(auth(officer));
    expect(stu.text).not.toContain('@example.com');
    expect((await request(app).get(`${B}/analytics/export?dataset=nope`).set(auth(officer))).status).toBe(400);
    const pack = await request(app).get(`${B}/analytics/report-pack`).set(auth(officer));
    expect(Object.keys(pack.body)).toEqual(expect.arrayContaining(['meta', 'dashboard', 'placement', 'funnel', 'drives', 'reminders']));
    const audit = await request(app).get(`${B}/audit?action=analytics.*`).set(auth(officer));
    expect(audit.body.items.length).toBeGreaterThanOrEqual(3);
    expect(csvSafe('=1+1')).toBe("'=1+1");
  });
});

describe('public stats and small-group suppression', () => {
  it('is off by default, then suppresses groups smaller than k and hides CTC when too few placed', async () => {
    const stu = await register(app, 'student');
    expect((await request(app).get(`${B}/stats/public`).set(auth(stu))).body).toEqual({ enabled: false });
    expect((await request(app).put(`${B}/ops/settings`).set(auth(officer)).send({ publicStatsEnabled: true, publicStatsMinGroup: 3 })).status).toBe(400);
    expect((await request(app).put(`${B}/ops/settings`).set(auth(officer)).send({ publicStatsEnabled: true })).status).toBe(200);
    const r = await request(app).get(`${B}/stats/public`).set(auth(stu));
    expect(r.body.enabled).toBe(true);
    expect(r.body.minGroupSize).toBe(5);
    expect(r.body.byBranch.map((b: any) => b.department)).toEqual(['Computer Science']);
    expect(r.body.byBatch.map((b: any) => b.batchYear)).toEqual([2026]);
    expect(r.body.suppressedGroups).toBe(4); // ECE, batch 2025, plus the "Unknown" department and batch groups of the one blank-profile student registered above
    expect(r.body.ctc).toBeNull(); // only 4 placed (< 5)
    expect(JSON.stringify(r.body)).not.toMatch(/name|email|@/i);
    await mkApp(driveA, ids.s6, ['submitted', 'screening', 'selected', 'offer_issued', 'offer_accepted']);
    const r2 = await request(app).get(`${B}/stats/public`).set(auth(stu));
    expect(r2.body.ctc).toMatchObject({ highestLpa: 20 });
  });
});

describe('permissions and tenant scoping', () => {
  it('students cannot read officer analytics; anonymous is 401', async () => {
    const stu = await register(app, 'student');
    for (const p of ['dashboard', 'placement', 'funnel', 'drives', 'reminders', 'workload', 'report-pack']) {
      expect((await request(app).get(`${B}/analytics/${p}`).set(auth(stu))).status).toBe(403);
    }
    expect((await request(app).get(`${B}/analytics/dashboard`)).status).toBe(401);
    expect((await request(app).get(`${B}/ops/settings`).set(auth(stu))).status).toBe(403);
  });
  it("another tenant's officer sees only their own data", async () => {
    const other = await makeOtherTenant('an');
    const r = await request(app).get(`${B}/analytics/dashboard`).set(auth(other.officer));
    expect(r.body.kpis.students).toBe(1);
    expect(r.body.kpis.applications).toBe(0);
    const p = await request(app).get(`${B}/analytics/placement`).set(auth(other.officer));
    expect(p.body.totals.placedStudents).toBe(0);
    const f = await request(app).get(`${B}/analytics/funnel?driveId=${driveA}`).set(auth(other.officer));
    expect(f.body.stages[0].count).toBe(0);
  });
});
