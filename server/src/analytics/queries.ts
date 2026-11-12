/** Placement analytics: aggregate SQL over students / applications / events, with a little JS for eligibility (rules are JSON). */
import { z } from 'zod';
import type { Db } from '../db';
import { completenessGaps } from '../drives';
import { evaluateEligibility } from '../eligibility';
import { ApiError } from '../errors';
import { computeCompletion } from '../profile';
import { pendingVerificationFields } from '../routes/officer';

export const filterSchema = z.object({
  batch: z.coerce.number().int().min(2020).max(2040).optional(),
  department: z.string().trim().min(1).max(80).optional(),
  from: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date').optional(),
  to: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date').optional(),
});
export interface Filters { batch?: number; department?: string; from?: Date; to?: Date }

export function parseFilters(q: unknown): Filters {
  const r = filterSchema.safeParse(q ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] ||= i.message;
    throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
  }
  const f: Filters = {};
  if (r.data.batch) f.batch = r.data.batch;
  if (r.data.department) f.department = r.data.department;
  if (r.data.from) f.from = new Date(r.data.from);
  if (r.data.to) {
    const t = new Date(r.data.to);
    // a bare date means "through the end of that day"
    f.to = /^\d{4}-\d{2}-\d{2}$/.test(r.data.to) ? new Date(t.getTime() + 24 * 3600_000) : t;
  }
  if (f.from && f.to && f.from >= f.to) throw new ApiError(400, 'VALIDATION_ERROR', '`from` must be before `to`', { from: 'Must be before to' });
  return f;
}
export const filtersOut = (f: Filters) => ({
  batch: f.batch ?? null, department: f.department ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null,
});

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const r2 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

/** SQL pieces: `st` CTE (filtered students) and `ap` CTE (their applications in the date range, with events reached). */
function base(tenantId: string, f: Filters, driveId?: string) {
  const p: unknown[] = [tenantId];
  let sw = `u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`;
  if (f.batch) { p.push(String(f.batch)); sw += ` AND p.data->'academics'->>'batchYear' = $${p.length}`; }
  if (f.department) { p.push(f.department.toLowerCase()); sw += ` AND lower(p.data->'academics'->>'department') = $${p.length}`; }
  let aw = `a.tenant_id=$1`;
  if (f.from) { p.push(f.from); aw += ` AND a.submitted_at >= $${p.length}`; }
  if (f.to) { p.push(f.to); aw += ` AND a.submitted_at < $${p.length}`; }
  if (driveId) { p.push(driveId); aw += ` AND a.drive_id=$${p.length}`; }
  const cte = `
    st AS (SELECT u.id, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE ${sw}),
    ap AS (
      SELECT a.id, a.user_id, a.drive_id, a.status, a.submitted_at,
             COALESCE((SELECT array_agg(DISTINCT e.status) FROM application_events e WHERE e.application_id=a.id), '{}') AS sts
        FROM applications a JOIN st ON st.id=a.user_id WHERE ${aw})`;
  return { cte, params: p };
}

const TOTAL_LPA = `CASE WHEN COALESCE(d.ctc->>'kind','annual')='annual' AND (d.ctc->>'fixedLpa') IS NOT NULL
   THEN COALESCE((d.ctc->>'fixedLpa')::numeric,0)+COALESCE((d.ctc->>'variableLpa')::numeric,0)+COALESCE((d.ctc->>'bonusLpa')::numeric,0) END`;

async function studentRows(db: Db, tenantId: string, f: Filters) {
  const b = base(tenantId, f);
  const r = await db.query(
    `WITH ${b.cte} SELECT st.id, st.data, st.verification, (SELECT count(*)::int FROM resumes r WHERE r.user_id=st.id) AS resumes FROM st`, b.params);
  return r.rows as { id: string; data: any; verification: any; resumes: number }[];
}

// ------------------------------------------------------------------------------------------------ dashboard
export async function dashboard(db: Db, tenantId: string, f: Filters) {
  const studs = await studentRows(db, tenantId, f);
  let complete = 0, completionSum = 0, verified = 0;
  for (const s of studs) {
    const c = computeCompletion(s.data || {}, s.resumes);
    completionSum += c.percent;
    if (c.percent === 100) complete++;
    if (Object.keys(s.data?.academics || {}).length > 0 && pendingVerificationFields(s.data || {}, s.verification || {}).length === 0) verified++;
  }
  const b = base(tenantId, f);
  const k = (await db.query(
    `WITH ${b.cte}
     SELECT count(*) FILTER (WHERE status<>'withdrawn')::int AS applications,
       count(*) FILTER (WHERE 'selected' = ANY(sts))::int AS sel_a, count(DISTINCT user_id) FILTER (WHERE 'selected' = ANY(sts))::int AS sel_s,
       count(*) FILTER (WHERE 'offer_issued' = ANY(sts))::int AS off_a, count(DISTINCT user_id) FILTER (WHERE 'offer_issued' = ANY(sts))::int AS off_s,
       count(*) FILTER (WHERE 'offer_accepted' = ANY(sts))::int AS acc_a, count(DISTINCT user_id) FILTER (WHERE 'offer_accepted' = ANY(sts))::int AS acc_s,
       count(*) FILTER (WHERE 'joined' = ANY(sts))::int AS join_a, count(DISTINCT user_id) FILTER (WHERE 'joined' = ANY(sts))::int AS join_s
       FROM ap`, b.params)).rows[0];
  const dr = (await db.query(
    `SELECT count(*) FILTER (WHERE status='open' AND deadline > now())::int AS open,
            count(*) FILTER (WHERE status='closed' OR (status='open' AND deadline <= now()))::int AS closed,
            count(*) FILTER (WHERE status='draft')::int AS draft FROM drives WHERE tenant_id=$1`, [tenantId])).rows[0];
  const ev = await eligibleVsApplied(db, tenantId, f, studs);
  return {
    filters: filtersOut(f),
    kpis: {
      students: studs.length, profileCompletePct: pct(complete, studs.length), avgProfileCompletionPct: studs.length ? Math.round((completionSum / studs.length) * 10) / 10 : null,
      verifiedPct: pct(verified, studs.length),
      drivesOpen: dr.open, drivesClosed: dr.closed, drivesDraft: dr.draft,
      applications: k.applications,
      eligibleVsApplied: ev,
      selected: { applications: k.sel_a, students: k.sel_s },
      offers: { applications: k.off_a, students: k.off_s },
      accepted: { applications: k.acc_a, students: k.acc_s },
      joined: { applications: k.join_a, students: k.join_s },
    },
    generatedAt: new Date().toISOString(),
  };
}

async function publishedDrives(db: Db, tenantId: string) {
  return (await db.query(`SELECT * FROM drives WHERE tenant_id=$1 AND status IN ('open','closed') ORDER BY created_at`, [tenantId])).rows;
}

async function eligibleVsApplied(db: Db, tenantId: string, f: Filters, studs: { id: string; data: any; verification: any }[]) {
  const drives = await publishedDrives(db, tenantId);
  const elig = eligibleSets(drives, studs);
  const b = base(tenantId, f);
  const pairs = (await db.query(`WITH ${b.cte} SELECT drive_id, user_id FROM ap WHERE status<>'withdrawn'`, b.params)).rows;
  let eligibleSlots = 0, appliedSlots = 0;
  for (const d of drives) eligibleSlots += elig.get(d.id)!.size;
  for (const p of pairs) if (elig.get(p.drive_id)?.has(p.user_id)) appliedSlots++;
  return { eligibleSlots, appliedSlots, appliedOfEligiblePct: pct(appliedSlots, eligibleSlots) };
}

/** drive id -> set of student ids whose status is `eligible` (pure rules, no policy/restriction overlay). */
export function eligibleSets(drives: any[], studs: { id: string; data: any; verification: any }[]) {
  const m = new Map<string, Set<string>>();
  for (const d of drives) {
    const s = new Set<string>();
    for (const st of studs) {
      if (evaluateEligibility(d.rules, { academics: st.data?.academics, verification: st.verification }).status === 'eligible') s.add(st.id);
    }
    m.set(d.id, s);
  }
  return m;
}

// ------------------------------------------------------------------------------------------------ placement statistics
export async function placement(db: Db, tenantId: string, f: Filters) {
  const b = base(tenantId, f);
  const common = `WITH ${b.cte},
    placed AS (
      SELECT ap.user_id, max(${TOTAL_LPA}) AS lpa FROM ap JOIN drives d ON d.id=ap.drive_id
       WHERE 'offer_accepted' = ANY(ap.sts) GROUP BY ap.user_id)`;
  const totals = (await db.query(
    `${common}
     SELECT (SELECT count(*) FROM st)::int AS students,
            (SELECT count(*) FROM placed)::int AS placed,
            (SELECT count(DISTINCT user_id) FROM ap WHERE 'offer_issued' = ANY(sts))::int AS offered,
            (SELECT count(*) FROM ap WHERE 'offer_issued' = ANY(sts))::int AS offers,
            max(lpa) AS hi, avg(lpa) AS av, percentile_cont(0.5) WITHIN GROUP (ORDER BY lpa) AS med, count(lpa)::int AS n
       FROM placed`, b.params)).rows[0];
  const byBranch = (await db.query(
    `${common}
     SELECT COALESCE(min(st.data->'academics'->>'department'),'Unknown') AS department, count(*)::int AS students,
            count(placed.user_id)::int AS placed, avg(placed.lpa) AS avg_lpa, max(placed.lpa) AS hi
       FROM st LEFT JOIN placed ON placed.user_id=st.id
      GROUP BY lower(COALESCE(st.data->'academics'->>'department','unknown')) ORDER BY 2 DESC, 1`, b.params)).rows;
  const byBatch = (await db.query(
    `${common}
     SELECT (st.data->'academics'->>'batchYear') AS batch, count(*)::int AS students,
            count(placed.user_id)::int AS placed, avg(placed.lpa) AS avg_lpa, max(placed.lpa) AS hi
       FROM st LEFT JOIN placed ON placed.user_id=st.id GROUP BY 1 ORDER BY 1`, b.params)).rows;
  const byCompany = (await db.query(
    `WITH ${b.cte}
     SELECT d.company->>'name' AS company, count(*)::int AS hires, avg(${TOTAL_LPA}) AS avg_lpa, max(${TOTAL_LPA}) AS hi
       FROM ap JOIN drives d ON d.id=ap.drive_id WHERE 'offer_accepted' = ANY(ap.sts)
      GROUP BY 1 ORDER BY 2 DESC, 1`, b.params)).rows;
  const bands = (await db.query(
    `${common}
     SELECT count(*) FILTER (WHERE lpa < 5)::int b0, count(*) FILTER (WHERE lpa >= 5 AND lpa < 8)::int b1,
            count(*) FILTER (WHERE lpa >= 8 AND lpa < 12)::int b2, count(*) FILTER (WHERE lpa >= 12 AND lpa < 20)::int b3,
            count(*) FILTER (WHERE lpa >= 20)::int b4 FROM placed WHERE lpa IS NOT NULL`, b.params)).rows[0];
  const ranges = [[0, 5, '0-5'], [5, 8, '5-8'], [8, 12, '8-12'], [12, 20, '12-20'], [20, null, '20+']] as const;
  return {
    filters: filtersOut(f),
    totals: {
      students: totals.students, placedStudents: totals.placed, placedPct: pct(totals.placed, totals.students),
      offeredStudents: totals.offered, offersIssued: totals.offers, offersPerStudent: totals.offered ? Math.round((totals.offers / totals.offered) * 100) / 100 : null,
    },
    ctc: { highestLpa: r2(totals.hi), averageLpa: r2(totals.av), medianLpa: r2(totals.med), count: totals.n },
    byBranch: byBranch.map((x) => ({ department: x.department, students: x.students, placed: x.placed, placedPct: pct(x.placed, x.students), avgLpa: r2(x.avg_lpa), highestLpa: r2(x.hi) })),
    byBatch: byBatch.map((x) => ({ batchYear: x.batch ? Number(x.batch) : null, students: x.students, placed: x.placed, placedPct: pct(x.placed, x.students), avgLpa: r2(x.avg_lpa), highestLpa: r2(x.hi) })),
    byCompany: byCompany.map((x) => ({ company: x.company, hires: x.hires, avgLpa: r2(x.avg_lpa), highestLpa: r2(x.hi) })),
    ctcBands: ranges.map(([lo, hi, label], i) => ({ label, minLpa: lo, maxLpa: hi, count: bands[`b${i}`] })),
  };
}

// ------------------------------------------------------------------------------------------------ funnel
const STAGES: [string, string][] = [
  ['applied', 'Applied'], ['screening', 'Screening'], ['assessment', 'Assessment'], ['interview', 'Interview'], ['selected', 'Selected'],
  ['offer_issued', 'Offer issued'], ['offer_accepted', 'Offer accepted'], ['joined', 'Joined'],
];
export async function funnel(db: Db, tenantId: string, f: Filters, driveId?: string) {
  const b = base(tenantId, f, driveId);
  const r = (await db.query(
    `WITH ${b.cte}
     SELECT count(*)::int AS applied,
       count(*) FILTER (WHERE 'screening' = ANY(sts))::int AS screening, count(*) FILTER (WHERE 'assessment' = ANY(sts))::int AS assessment,
       count(*) FILTER (WHERE 'interview' = ANY(sts))::int AS interview, count(*) FILTER (WHERE 'selected' = ANY(sts))::int AS selected,
       count(*) FILTER (WHERE 'offer_issued' = ANY(sts))::int AS offer_issued, count(*) FILTER (WHERE 'offer_accepted' = ANY(sts))::int AS offer_accepted,
       count(*) FILTER (WHERE 'joined' = ANY(sts))::int AS joined,
       count(*) FILTER (WHERE status='rejected')::int AS rejected, count(*) FILTER (WHERE status='withdrawn')::int AS withdrawn FROM ap`, b.params)).rows[0];
  return {
    driveId: driveId ?? null,
    stages: STAGES.map(([key, label]) => ({ key, label, count: r[key], pctOfApplied: pct(r[key], r.applied) })),
    rejected: r.rejected, withdrawn: r.withdrawn,
  };
}

// ------------------------------------------------------------------------------------------------ per drive
export async function driveTable(db: Db, tenantId: string, f: Filters) {
  const drives = await publishedDrives(db, tenantId);
  const studs = await studentRows(db, tenantId, f);
  const elig = eligibleSets(drives, studs);
  const b = base(tenantId, f);
  const agg = (await db.query(
    `WITH ${b.cte}
     SELECT ap.drive_id, count(*) FILTER (WHERE ap.status<>'withdrawn')::int AS applied,
       count(*) FILTER (WHERE 'selected' = ANY(sts))::int AS selected, count(*) FILTER (WHERE 'offer_issued' = ANY(sts))::int AS offers,
       count(*) FILTER (WHERE 'offer_accepted' = ANY(sts))::int AS accepted, count(*) FILTER (WHERE 'joined' = ANY(sts))::int AS joined,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ap.submitted_at - d.published_at))/3600)
         FILTER (WHERE d.published_at IS NOT NULL AND ap.submitted_at >= d.published_at) AS med_h
       FROM ap JOIN drives d ON d.id=ap.drive_id GROUP BY ap.drive_id`, b.params)).rows;
  const byDrive = new Map(agg.map((x) => [x.drive_id, x]));
  const applicants = (await db.query(`WITH ${b.cte} SELECT drive_id, user_id FROM ap WHERE status<>'withdrawn'`, b.params)).rows;
  const appliedBy = new Map<string, Set<string>>();
  for (const a of applicants) { if (!appliedBy.has(a.drive_id)) appliedBy.set(a.drive_id, new Set()); appliedBy.get(a.drive_id)!.add(a.user_id); }
  const now = Date.now();
  return drives.map((d) => {
    const a = byDrive.get(d.id);
    const eligible = elig.get(d.id)!;
    const applied = a?.applied ?? 0;
    const gaps = Object.keys(completenessGaps(d, new Date(d.published_at || d.created_at)));
    const passed = d.status === 'closed' || (d.deadline && new Date(d.deadline).getTime() <= now);
    let appliedOfEligible = 0, miss = 0;
    for (const id of eligible) { if (appliedBy.get(d.id)?.has(id)) appliedOfEligible++; else if (passed) miss++; }
    return {
      id: d.id, company: d.company?.name || '', role: d.role, status: passed ? 'closed' : 'open',
      deadline: d.deadline ? new Date(d.deadline).toISOString() : null, publishedAt: d.published_at ? new Date(d.published_at).toISOString() : null,
      completenessScore: Math.round(((10 - gaps.length) / 10) * 100), completenessGaps: gaps,
      eligibleCount: eligible.size, applied, appliedOfEligiblePct: pct(appliedOfEligible, eligible.size), deadlineMissEstimate: miss,
      medianHoursToApply: r2(a?.med_h), selected: a?.selected ?? 0, offers: a?.offers ?? 0, accepted: a?.accepted ?? 0, joined: a?.joined ?? 0,
    };
  });
}

// ------------------------------------------------------------------------------------------------ reminders, workload
export async function reminderStats(db: Db, tenantId: string, f: Filters) {
  const p: unknown[] = [tenantId];
  let w = 'tenant_id=$1';
  if (f.from) { p.push(f.from); w += ` AND fire_at >= $${p.length}`; }
  if (f.to) { p.push(f.to); w += ` AND fire_at < $${p.length}`; }
  const rows = (await db.query(`SELECT kind, status, count(*)::int n FROM scheduled_reminders WHERE ${w} GROUP BY 1,2`, p)).rows;
  const kinds = ['t60', 't30', 't15', 'sched60'];
  const byKind = kinds.map((kind) => {
    const g = (s: string) => rows.find((x) => x.kind === kind && x.status === s)?.n ?? 0;
    const o = { kind, pending: g('pending'), sent: g('sent'), cancelled: g('cancelled'), skipped: g('skipped'), total: 0 };
    o.total = o.pending + o.sent + o.cancelled + o.skipped;
    return o;
  });
  const sent = byKind.reduce((s, x) => s + x.sent, 0), skipped = byKind.reduce((s, x) => s + x.skipped, 0);
  const dev = (await db.query('SELECT count(*)::int n FROM devices WHERE tenant_id=$1', [tenantId])).rows[0].n;
  return { byKind, deliveryRatePct: pct(sent, sent + skipped), pushDevices: dev };
}

export async function workload(db: Db, tenantId: string) {
  const officers = (await db.query(
    `SELECT u.id, u.name,
       (SELECT count(*)::int FROM application_events e WHERE e.actor_id=u.id AND e.created_at > now() - interval '30 days') AS changes,
       (SELECT count(*)::int FROM drives d WHERE d.created_by=u.id AND d.tenant_id=$1) AS drives,
       (SELECT count(*)::int FROM student_documents sd WHERE sd.reviewed_by=u.id AND sd.reviewed_at > now() - interval '30 days') AS reviewed
       FROM users u WHERE u.tenant_id=$1 AND u.role='officer' AND u.deleted_at IS NULL ORDER BY u.name`, [tenantId])).rows;
  const un = (await db.query(
    `SELECT (SELECT count(*)::int FROM applications WHERE tenant_id=$1 AND status='submitted') AS awaiting,
            (SELECT count(*)::int FROM student_documents WHERE tenant_id=$1 AND status='pending') AS docs,
            (SELECT count(*)::int FROM tickets WHERE tenant_id=$1 AND status='open') AS tickets`, [tenantId])).rows[0];
  return {
    officers: officers.map((o) => ({ id: o.id, name: o.name, statusChanges30d: o.changes, drivesCreated: o.drives, documentsReviewed30d: o.reviewed })),
    unassigned: { applicationsAwaitingScreening: un.awaiting, documentsPending: un.docs, openTickets: un.tickets },
  };
}

// ------------------------------------------------------------------------------------------------ public (anonymised) stats
export async function publicStats(db: Db, tenantId: string, k: number) {
  const p = await placement(db, tenantId, {});
  const keep = <T extends { students: number }>(rows: T[]) => rows.filter((r) => r.students >= k);
  const branches = keep(p.byBranch), batches = keep(p.byBatch);
  const suppressed = (p.byBranch.length - branches.length) + (p.byBatch.length - batches.length);
  const enough = p.totals.placedStudents >= k && p.ctc.count >= k;
  return {
    enabled: true, minGroupSize: k,
    totals: { students: p.totals.students >= k ? p.totals.students : null, placedPct: p.totals.students >= k ? p.totals.placedPct : null },
    byBranch: branches.map((b) => ({ department: b.department, students: b.students, placedPct: b.placedPct })),
    byBatch: batches.map((b) => ({ batchYear: b.batchYear, students: b.students, placedPct: b.placedPct })),
    ctc: enough ? { averageLpa: p.ctc.averageLpa, medianLpa: p.ctc.medianLpa, highestLpa: p.ctc.highestLpa } : null,
    suppressedGroups: suppressed,
  };
}
