import { randomUUID } from 'node:crypto';
import { pool, resetDb } from './helpers';

export const T1 = '00000000-0000-4000-8000-000000000001';

export async function resetOps() {
  await resetDb();
  await pool.query(`TRUNCATE tenant_settings, placement_policies, policy_versions, eligibility_evaluations, restrictions, cohorts, announcements, announcement_templates,
    companies, company_interactions, student_documents, calendar_tokens RESTART IDENTITY CASCADE`);
}

let n = 0;
export async function mkStudent(o: { tenantId?: string; name?: string; dept?: string; batch?: number; cgpa?: number; backlogs?: number; verified?: boolean; reg?: string } = {}) {
  n += 1;
  const id = randomUUID();
  const tenantId = o.tenantId ?? T1;
  const phone = `98${String(10000000 + n * 37).slice(0, 8)}`;
  await pool.query(`INSERT INTO users (id, tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,$2,'student',$3,$4,$4,$5,'x')`,
    [id, tenantId, o.name ?? `Student ${n}`, `s${n}-${id.slice(0, 5)}@example.com`, phone]);
  const acad: any = { department: o.dept ?? 'Computer Science', program: 'B.Tech', batchYear: o.batch ?? 2026, cgpa: o.cgpa ?? 8, cgpaScale: 10, activeBacklogs: o.backlogs ?? 0, gapYears: 0, tenthPercent: 90, twelfthPercent: 90 };
  const ver: any = {};
  if (o.verified !== false) { for (const k of Object.keys(acad)) ver[`academics.${k}`] = 'verified'; ver['identity.registrationNumber'] = 'verified'; }
  await pool.query(`INSERT INTO profiles (user_id, tenant_id, data, verification) VALUES ($1,$2,$3,$4)`,
    [id, tenantId, JSON.stringify({ identity: { registrationNumber: o.reg ?? `REG${1000 + n}` }, academics: acad, contact: { city: 'Pune', state: 'MH' }, skills: ['SQL'] }), JSON.stringify(ver)]);
  return id;
}

export async function mkDrive(createdBy: string | null, o: { company?: string; role?: string; fixed?: number; variable?: number; bonus?: number; status?: 'open' | 'closed' | 'draft'; rules?: any; kind?: string; deadlineHours?: number; tenantId?: string } = {}) {
  const status = o.status ?? 'open';
  const id = randomUUID();
  const hours = o.deadlineHours ?? (status === 'closed' ? -48 : 72);
  await pool.query(
    `INSERT INTO drives (id, tenant_id, created_by, status, company, role, work_mode, locations, ctc, deadline, jd, rounds, contact, rules, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,'hybrid','["Pune"]',$7,$8,'A long enough job description for tests.','[{"name":"Interview"}]','{"name":"Off"}',$9,$10)`,
    [id, o.tenantId ?? T1, createdBy, status, JSON.stringify({ name: o.company ?? 'Acme', industry: 'Software', verified: true }), o.role ?? 'Engineer',
      JSON.stringify({ fixedLpa: o.fixed ?? 10, variableLpa: o.variable ?? 0, bonusLpa: o.bonus ?? 0, kind: o.kind ?? 'annual', breakdownProvided: true }),
      new Date(Date.now() + hours * 3600_000), JSON.stringify(o.rules ?? { minCgpa: 5 }), status === 'draft' ? null : new Date(Date.now() - 96 * 3600_000)]);
  return id;
}

/** Inserts an application with the given status path (events appended in order). Last element is the current status. */
export async function mkApp(driveId: string, userId: string, path: string[], tenantId = T1) {
  const id = randomUUID();
  const status = path[path.length - 1];
  await pool.query(
    `INSERT INTO applications (id, tenant_id, drive_id, user_id, reference, status, idempotency_key, snapshot, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,gen_random_uuid(),'{}', now() - interval '60 hours')`, [id, tenantId, driveId, userId, `PL-T-${id.slice(0, 8)}`, status]);
  for (const s of path) await pool.query(`INSERT INTO application_events (application_id, status) VALUES ($1,$2)`, [id, s]);
  return id;
}
