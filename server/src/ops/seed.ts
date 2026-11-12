/** Demo data for the operations module (analytics, policy, restrictions, cohorts, CRM). All names are fictional. Called from seed.ts inside its transaction. */
import type { PoolClient } from 'pg';
import { POLICY_TEMPLATES, policySchema } from '../policy/schema';
import { activateVersion } from '../policy/store';

const BRANCHES: [string, string, number][] = [['Computer Science', 'CSE', 9], ['Electronics', 'ECE', 6], ['Mechanical', 'ME', 5], ['Information Technology', 'IT', 5]];
const PATHS: Record<string, string[]> = {
  applied: ['submitted'],
  screened: ['submitted', 'screening'],
  interviewed: ['submitted', 'screening', 'interview'],
  selected: ['submitted', 'screening', 'interview', 'selected'],
  offered: ['submitted', 'screening', 'interview', 'selected', 'offer_issued'],
  accepted: ['submitted', 'screening', 'interview', 'selected', 'offer_issued', 'offer_accepted'],
  declined: ['submitted', 'screening', 'selected', 'offer_issued', 'offer_declined'],
  joined: ['submitted', 'screening', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'joined'],
  rejected: ['submitted', 'screening', 'rejected'],
};

export async function seedOpsDemo(c: PoolClient, o: { tenantId: string; officerId: string; passwordHash: string; driveIds: Record<string, string>; studentIds: Record<string, string> }) {
  const t = o.tenantId;
  for (const tbl of ['announcement_templates', 'restrictions', 'cohorts', 'companies', 'student_documents', 'calendar_tokens', 'eligibility_evaluations', 'placement_policies']) {
    await c.query(`DELETE FROM ${tbl} WHERE tenant_id=$1`, [t]);
  }
  await c.query('DELETE FROM tenant_settings WHERE tenant_id=$1', [t]);

  // ---- demo cohort of extra students across branches (clearly fictional)
  const extra: { id: string; dept: string; batch: number; i: number }[] = [];
  let n = 0;
  for (const [dept, code, count] of BRANCHES) {
    for (let k = 0; k < count; k++) {
      n += 1;
      const batch = k % 5 === 4 ? 2025 : 2026;
      const cgpa = Math.round((6.2 + ((n * 37) % 33) / 10) * 10) / 10;
      const email = `demo.${code.toLowerCase()}${String(k + 1).padStart(2, '0')}@students.demo`;
      const u = (await c.query(
        `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash, email_verified_at) VALUES ($1,'student',$2,$3,$3,$4,$5, now()) RETURNING id`,
        [t, `Demo ${code} Student ${k + 1}`, email, `97${String(20000100 + n * 13).slice(0, 8)}`, o.passwordHash])).rows[0].id as string;
      const acad = { university: 'Demo University', department: dept, program: 'B.Tech', batchYear: batch, semester: 7, cgpa, cgpaScale: 10, tenthPercent: 70 + (n % 25), twelfthPercent: 68 + (n % 27), activeBacklogs: n % 11 === 0 ? 1 : 0, gapYears: 0 };
      const ver: Record<string, string> = { 'identity.registrationNumber': 'verified' };
      for (const key of Object.keys(acad)) ver[`academics.${key}`] = n % 7 === 0 ? 'unverified' : 'verified';
      await c.query('INSERT INTO profiles (user_id, tenant_id, data, verification) VALUES ($1,$2,$3,$4)', [u, t,
        JSON.stringify({ identity: { registrationNumber: `${code}${batch % 100}D${String(k + 1).padStart(3, '0')}` }, academics: acad, contact: { city: 'Pune', state: 'Maharashtra' }, skills: ['Communication'] }), JSON.stringify(ver)]);
      await c.query(`INSERT INTO user_consents (tenant_id, user_id, policy_version) VALUES ($1,$2,'v1')`, [t, u]);
      extra.push({ id: u, dept, batch, i: n });
    }
  }

  // ---- applications spread across drives and outcomes
  const driveNames = ['Kestrel Systems', 'Zephyra Cloud', 'Quillbridge Finance', 'Lumora Health Tech', 'Pebblestone Labs'].filter((d) => o.driveIds[d]);
  const outcome = ['applied', 'screened', 'interviewed', 'selected', 'offered', 'accepted', 'declined', 'joined', 'rejected', 'accepted', 'screened', 'rejected'];
  let ref = 0;
  const accepted = new Set<string>(); // one accepted offer per student (matches the one-offer policy)
  for (const s of extra) {
    const apps = 1 + (s.i % 3);
    for (let a = 0; a < apps; a++) {
      const drive = driveNames[(s.i + a * 2) % driveNames.length];
      let key = outcome[(s.i * 5 + a * 3) % outcome.length];
      if (['accepted', 'joined'].includes(key)) { if (accepted.has(s.id)) key = 'rejected'; else accepted.add(s.id); }
      const path = PATHS[key];
      const when = new Date(Date.now() - (14 - (s.i % 10)) * 24 * 3600_000);
      const app = (await c.query(
        `INSERT INTO applications (tenant_id, drive_id, user_id, reference, status, idempotency_key, snapshot, submitted_at)
         VALUES ($1,$2,$3,$4,$5,gen_random_uuid(),$6,$7) RETURNING id`,
        [t, o.driveIds[drive], s.id, `PL-OPS-${String(++ref).padStart(4, '0')}`, path[path.length - 1], JSON.stringify({ student: { department: s.dept, batchYear: s.batch }, eligibility: 'eligible' }), when])).rows[0].id;
      for (let e = 0; e < path.length; e++) {
        await c.query('INSERT INTO application_events (application_id, status, actor_id, actor_role, created_at) VALUES ($1,$2,$3,$4,$5)',
          [app, path[e], e === 0 ? s.id : o.officerId, e === 0 ? 'student' : 'officer', new Date(when.getTime() + e * 6 * 3600_000)]);
      }
    }
  }

  // ---- policy: one-offer with a 1.5x upgrade, active
  const tpl = POLICY_TEMPLATES.find((x) => x.id === 'upgrade-1-5x')!;
  const policy = policySchema.parse({ ...tpl.policy, defaults: { minCgpa: 6, maxActiveBacklogs: null } });
  const p = (await c.query(`INSERT INTO placement_policies (tenant_id, name, description, created_by) VALUES ($1,'Placement policy 2026','One offer per student; a 1.5x higher package may be pursued.',$2) RETURNING id`, [t, o.officerId])).rows[0];
  const v = (await c.query(`INSERT INTO policy_versions (tenant_id, policy_id, version, status, policy, note, created_by, approved_by, approved_at) VALUES ($1,$2,1,'approved',$3,'Seeded demo policy',$4,$4,now()) RETURNING id`, [t, p.id, JSON.stringify(policy), o.officerId])).rows[0];
  await activateVersion(c as any, t, v.id, o.officerId);
  await c.query(`INSERT INTO audit_events (tenant_id, actor_id, action, entity_type, entity_id, meta) VALUES ($1,$2,'policy.activate','policy_version',$3,'{"version":1,"seed":true}')`, [t, o.officerId, v.id]);

  // ---- restrictions: one waiting for a second officer's approval, one active time-bound company restriction
  const diya = o.studentIds['diya.patel@students.demo'];
  if (diya) {
    await c.query(
      `INSERT INTO restrictions (tenant_id, scope, scope_value, student_id, reason, student_message, evidence_notes, status, requested_by)
       VALUES ($1,'student',$2::text,$2::uuid,'No-show at the Quillbridge interview on 2 Nov','Your applications are on hold while the placement cell reviews a missed interview.','Interview log, email 3 Nov','pending_approval',$3)`, [t, diya, o.officerId]);
  }
  await c.query(
    `INSERT INTO restrictions (tenant_id, scope, scope_value, reason, student_message, status, starts_at, ends_at, requested_by, approved_by, approved_at)
     VALUES ($1,'company','Verdant Grid Energy','Company asked for a pause while it revises the role','Applications to Verdant Grid Energy are paused until the company confirms its updated role.','active', now() - interval '1 day', now() + interval '14 days', $2, $2, now())`, [t, o.officerId]);

  // ---- cohorts
  await c.query(`INSERT INTO cohorts (tenant_id, name, description, kind, filter, created_by) VALUES
    ($1,'Final-year CSE and IT','Computer Science and IT, batch 2026','dynamic',$2,$4),
    ($1,'Unplaced, CGPA 7+','Not yet placed, CGPA at least 7','dynamic',$3,$4)`,
    [t, JSON.stringify({ departments: ['Computer Science', 'Information Technology'], batches: [2026] }), JSON.stringify({ placement: 'unplaced', minCgpa: 7 }), o.officerId]);

  // ---- companies (CRM) linked to the demo drives
  const crm: [string, string, string, string, string, boolean, string[]][] = [
    ['Kestrel Systems', 'https://kestrel.example.com', 'Enterprise software', 'Pune', 'hiring', true, ['software', 'repeat']],
    ['Zephyra Cloud', 'https://zephyra.example.com', 'Cloud infrastructure', 'Bengaluru', 'hiring', true, ['software', 'high-ctc']],
    ['Quillbridge Finance', 'https://quillbridge.example.com', 'Financial services', 'Mumbai', 'mou', true, ['finance']],
    ['Lumora Health Tech', 'https://lumora.example.com', 'Health technology', 'Mumbai', 'interested', false, ['health']],
    ['Verdant Grid Energy', 'https://verdantgrid.example.com', 'Renewable energy', 'Nagpur', 'contacted', false, ['core']],
    ['Orbitrail Logistics', 'https://orbitrail.example.com', 'Logistics', 'Hyderabad', 'prospect', false, []],
    ['Pebblestone Labs', 'https://pebblestone.example.com', 'Developer tools', 'Remote', 'hiring', true, ['startup']],
  ];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [name, site, industry, hq, stage, verified, tags] of crm) {
    const comp = (await c.query(
      `INSERT INTO companies (tenant_id, name, name_key, website, website_host, industry, hq, contacts, notes, tags, verified, stage, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Demo record (fictional company).',$9,$10,$11,$12) RETURNING id`,
      [t, name, norm(name), site, new URL(site).hostname, industry, hq, JSON.stringify([{ name: 'Demo Contact', role: 'Campus lead', email: `campus@${new URL(site).hostname}` }]), tags, verified, stage, o.officerId])).rows[0];
    if (o.driveIds[name]) await c.query('UPDATE drives SET company_id=$1 WHERE id=$2', [comp.id, o.driveIds[name]]);
    await c.query(`INSERT INTO company_interactions (tenant_id, company_id, type, occurred_at, summary, follow_up_at, created_by) VALUES ($1,$2,'meeting', now() - interval '10 days', 'Campus hiring plan discussed (demo).', $3, $4)`,
      [t, comp.id, stage === 'hiring' ? null : new Date(Date.now() + 5 * 24 * 3600_000), o.officerId]);
  }

  await c.query(`INSERT INTO announcement_templates (tenant_id, name, title, body, created_by) VALUES ($1,'Deadline reminder','Application deadline today','Applications for this drive close today. Please review your details and apply before the deadline.',$2)`, [t, o.officerId]);
  await c.query(`INSERT INTO tenant_settings (tenant_id, settings) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings`,
    [t, JSON.stringify({ publicStatsEnabled: true, publicStatsMinGroup: 5, restrictionApproval: 'required', policyApproval: 'not_required' })]);
}
