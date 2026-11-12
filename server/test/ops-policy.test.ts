import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTo, auth, baseDrive, createOpenDrive, makeApp, makeEligibleStudent, pool, register } from './helpers';
import { resetOps, T1 } from './opsHelpers';
import { buildConditionContext, composeExtra, evaluateConditions, validateConditions, Cond } from '../src/policy/conditions';
import { evaluateEligibility } from '../src/eligibility';
import { evaluateWithPolicy, driveCtxFromRow, offerInfoFromLpas } from '../src/policy/engine';
import { validatePolicy, POLICY_TEMPLATES } from '../src/policy/schema';
import { getActivePolicy } from '../src/policy/store';

const app = makeApp();
const B = '/api/v1';

describe('condition evaluator matrix (pure)', () => {
  const ctx = { cgpa: 7.5, department: 'Computer Science', activeBacklogs: 0, skills: ['SQL', 'React'], batchYear: 2026, hasAcceptedOffer: false };
  const ev = (c: Cond, x: Record<string, unknown> = ctx) => evaluateConditions(c, x).result;
  const leaf = (field: string, op: string, value?: unknown) => ({ field, op, value }) as Cond;

  it('numeric operators', () => {
    expect(ev(leaf('cgpa', 'gte', 7.5))).toBe('true');
    expect(ev(leaf('cgpa', 'gt', 7.5))).toBe('false');
    expect(ev(leaf('cgpa', 'lt', 8))).toBe('true');
    expect(ev(leaf('cgpa', 'lte', 7.4))).toBe('false');
    expect(ev(leaf('cgpa', 'eq', 7.5))).toBe('true');
    expect(ev(leaf('cgpa', 'neq', 7.5))).toBe('false');
    expect(ev(leaf('cgpa', 'between', [7, 8]))).toBe('true');
    expect(ev(leaf('cgpa', 'between', [7.5, 7.5]))).toBe('true'); // inclusive
    expect(ev(leaf('cgpa', 'between', [8, 9]))).toBe('false');
    expect(ev(leaf('batchYear', 'in', [2025, 2026]))).toBe('true');
    expect(ev(leaf('batchYear', 'nin', [2026]))).toBe('false');
  });
  it('string, list and boolean operators are case-insensitive where text', () => {
    expect(ev(leaf('department', 'eq', 'computer science'))).toBe('true');
    expect(ev(leaf('department', 'in', ['Mechanical', ' COMPUTER SCIENCE']))).toBe('true');
    expect(ev(leaf('department', 'nin', ['Mechanical']))).toBe('true');
    expect(ev(leaf('department', 'contains', 'science'))).toBe('true');
    expect(ev(leaf('skills', 'contains', 'sql'))).toBe('true');
    expect(ev(leaf('skills', 'contains', 'Go'))).toBe('false');
    expect(ev(leaf('hasAcceptedOffer', 'eq', false))).toBe('true');
    expect(ev(leaf('hasAcceptedOffer', 'neq', false))).toBe('false');
  });
  it('missing data is unknown, exists / notExists are definite', () => {
    expect(ev(leaf('tenthPercent', 'gte', 60))).toBe('unknown');
    expect(ev(leaf('tenthPercent', 'exists'))).toBe('false');
    expect(ev(leaf('tenthPercent', 'notExists'))).toBe('true');
    expect(ev(leaf('cgpa', 'exists'))).toBe('true');
    expect(ev(leaf('skills', 'exists'), { ...ctx, skills: undefined })).toBe('false');
    expect(ev(leaf('department', 'eq', 'x'), { department: '' })).toBe('unknown');
  });
  it('AND / OR / NOT follow three-valued logic', () => {
    const T = leaf('cgpa', 'gte', 7), F = leaf('cgpa', 'gte', 9), U = leaf('tenthPercent', 'gte', 60);
    expect(ev({ all: [T, T] })).toBe('true');
    expect(ev({ all: [T, F] })).toBe('false');
    expect(ev({ all: [T, U] })).toBe('unknown');
    expect(ev({ all: [F, U] })).toBe('false'); // a definite false beats unknown
    expect(ev({ any: [F, F] })).toBe('false');
    expect(ev({ any: [F, T] })).toBe('true');
    expect(ev({ any: [F, U] })).toBe('unknown');
    expect(ev({ any: [T, U] })).toBe('true'); // a definite true beats unknown
    expect(ev({ not: T })).toBe('false');
    expect(ev({ not: F })).toBe('true');
    expect(ev({ not: U })).toBe('unknown');
    expect(ev({ all: [T, { any: [F, { not: F }] }, { not: { all: [F, U] } }] })).toBe('true');
  });
  it('validation: structure, fields, operators, value types, depth and size limits', () => {
    expect(validateConditions({ all: [leaf('cgpa', 'gte', 7)] }).valid).toBe(true);
    const bad = (c: unknown) => validateConditions(c).errors.map((e) => e.message).join('|');
    expect(bad({})).toMatch(/exactly one/);
    expect(bad({ all: [] })).toMatch(/non-empty/);
    expect(bad({ all: [1] })).toMatch(/object/);
    expect(bad(leaf('nope', 'eq', 1))).toMatch(/Unknown field/);
    expect(bad(leaf('cgpa', 'like', 1))).toMatch(/Unknown operator/);
    expect(bad(leaf('cgpa', 'gte', 'x'))).toMatch(/number/);
    expect(bad(leaf('cgpa', 'between', [9, 7]))).toMatch(/low/);
    expect(bad(leaf('department', 'gt', 1))).toMatch(/numeric/);
    expect(bad(leaf('cgpa', 'exists', 1))).toMatch(/no value/);
    expect(bad({ field: 'cgpa', op: 'eq', value: 1, extra: 1 })).toMatch(/Unknown key/);
    let deep: Cond = leaf('cgpa', 'gte', 1);
    for (let i = 0; i < 8; i++) deep = { not: deep };
    expect(bad(deep)).toMatch(/deeper/);
    expect(bad({ all: Array.from({ length: 60 }, () => leaf('cgpa', 'gte', 1)) })).toMatch(/At most 50/);
  });
  it('composeExtra leaves the base result untouched without extra and merges statuses with it', () => {
    const base = evaluateEligibility({ minCgpa: 7 }, { academics: { cgpa: 8, cgpaScale: 10 } });
    expect(composeExtra(base, undefined, {})).toBe(base);
    expect(composeExtra(base, {}, {})).toBe(base);
    const c = buildConditionContext({ academics: { cgpa: 8, cgpaScale: 10, department: 'ECE' } });
    expect(composeExtra(base, leaf('department', 'eq', 'ECE'), c).status).toBe('eligible');
    const no = composeExtra(base, leaf('department', 'eq', 'CSE'), c);
    expect(no.status).toBe('not_eligible');
    expect(no.reason).toMatch(/Department/);
    expect(no.reasons.at(-1)).toMatchObject({ criterion: 'custom', met: false });
    const pend = composeExtra(base, leaf('city', 'eq', 'Pune'), c);
    expect(pend.status).toBe('pending');
    const failedBase = evaluateEligibility({ minCgpa: 9 }, { academics: { cgpa: 8, cgpaScale: 10 } });
    expect(composeExtra(failedBase, leaf('department', 'eq', 'ECE'), c).status).toBe('not_eligible');
    // a stored malformed tree never blocks students
    expect(composeExtra(base, { bogus: true }, c)).toBe(base);
  });
  it('normalises CGPA to the 10 scale in the context', () => {
    expect(buildConditionContext({ academics: { cgpa: 3.2, cgpaScale: 4 } }).cgpa).toBe(8);
  });
});

describe('policy schema and engine (pure)', () => {
  it('validates, normalises and warns', () => {
    const ok = validatePolicy({ oneOffer: { enabled: true } });
    expect(ok.valid).toBe(true);
    expect(ok.normalized!.upgrade.multiplier).toBe(1.5);
    expect(validatePolicy({ tiers: { enabled: true, dreamMinLpa: 20, superDreamMinLpa: 10 } }).errors[0].path).toBe('tiers.superDreamMinLpa');
    expect(validatePolicy({ bogus: 1 }).valid).toBe(false);
    expect(validatePolicy({ upgrade: { enabled: true, multiplier: 9 } }).valid).toBe(false);
    expect(validatePolicy({ upgrade: { enabled: true } }).warnings[0]).toMatch(/one-offer/);
    expect(POLICY_TEMPLATES.map((t) => t.id)).toEqual(['one-offer', 'dream-super-dream', 'upgrade-1-5x', 'upgrade-2x', 'cgpa-backlog-defaults']);
    for (const t of POLICY_TEMPLATES) expect(validatePolicy(t.policy).valid).toBe(true);
  });
  const drive = (lpa: number, rules: any = {}) => driveCtxFromRow({ id: 'd', rules, ctc: { fixedLpa: lpa, kind: 'annual' }, company: { name: 'X' } });
  const stud = (lpas: number[], acad: any = { cgpa: 8, cgpaScale: 10 }) => ({ id: 's', academics: acad, verification: {}, offers: offerInfoFromLpas(lpas) });
  it('one-offer, upgrade multiplier, tiers and defaults', () => {
    const oneOffer = validatePolicy({ oneOffer: { enabled: true } }).normalized!;
    expect(evaluateWithPolicy(oneOffer, drive(30), stud([])).status).toBe('eligible');
    const blocked = evaluateWithPolicy(oneOffer, drive(30), stud([10]));
    expect(blocked.status).toBe('not_eligible');
    expect(blocked.reasons.at(-1)).toMatchObject({ criterion: 'policy', met: false });
    const up = validatePolicy({ oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 1.5 } }).normalized!;
    expect(evaluateWithPolicy(up, drive(15), stud([10])).status).toBe('eligible');
    expect(evaluateWithPolicy(up, drive(14.9), stud([10])).status).toBe('not_eligible');
    const tiers = validatePolicy({ oneOffer: { enabled: true }, tiers: { enabled: true, dreamMinLpa: 10, superDreamMinLpa: 20 } }).normalized!;
    expect(evaluateWithPolicy(tiers, drive(12), stud([6])).status).toBe('eligible'); // regular -> dream
    expect(evaluateWithPolicy(tiers, drive(12), stud([11])).status).toBe('not_eligible'); // dream -> dream
    expect(evaluateWithPolicy(tiers, drive(25), stud([11])).status).toBe('eligible'); // dream -> super dream
    expect(evaluateWithPolicy(null, drive(1), stud([99])).status).toBe('eligible');
    const defs = validatePolicy({ defaults: { minCgpa: 8.5 } }).normalized!;
    expect(evaluateWithPolicy(defs, drive(10), stud([])).status).toBe('not_eligible');
    expect(evaluateWithPolicy(defs, drive(10, { minCgpa: 7 }), stud([])).status).toBe('eligible'); // drive's own limit wins
    const ver = validatePolicy({ requireVerifiedAcademics: true }).normalized!;
    expect(evaluateWithPolicy(ver, drive(10, { minCgpa: 7 }), stud([])).status).toBe('pending');
  });
  it('stipend drives are exempt from the one-offer rule', () => {
    const p = validatePolicy({ oneOffer: { enabled: true } }).normalized!;
    const d = driveCtxFromRow({ id: 'd', rules: {}, ctc: { fixedLpa: 20000, kind: 'stipend_monthly' }, company: {} });
    expect(evaluateWithPolicy(p, d, stud([10])).status).toBe('eligible');
  });
});

describe('policy API: versioning, approval, rollback, simulation, apply', () => {
  let officer: Awaited<ReturnType<typeof register>>;
  let officer2: Awaited<ReturnType<typeof register>>;
  beforeAll(async () => {
    await resetOps();
    officer = await register(app, 'officer');
    officer2 = await register(app, 'officer');
  });
  afterAll(async () => { await resetOps(); await pool.end(); });

  let policyId = '', v1 = '', v2 = '';
  it('validate-draft reports problems with paths and never 4xx', async () => {
    const bad = await request(app).post(`${B}/policy/validate-draft`).set(auth(officer)).send({ policy: { oneOffer: { enabled: 'yes' }, extra: 1 } });
    expect(bad.status).toBe(200);
    expect(bad.body.valid).toBe(false);
    expect(bad.body.errors.map((e: any) => e.path)).toEqual(expect.arrayContaining(['oneOffer.enabled']));
    const good = await request(app).post(`${B}/policy/validate-draft`).set(auth(officer)).send({ policy: { oneOffer: { enabled: true } } });
    expect(good.body).toMatchObject({ valid: true, errors: [] });
    const cond = await request(app).post(`${B}/policy/validate-conditions`).set(auth(officer)).send({ conditions: { field: 'zzz', op: 'eq', value: 1 } });
    expect(cond.body.valid).toBe(false);
  });

  it('creates from a template, edits a draft, activates, writes tenant_settings.policy', async () => {
    const t = await request(app).get(`${B}/policy/templates`).set(auth(officer));
    expect(t.body.items.length).toBe(5);
    const c = await request(app).post(`${B}/policy/policies`).set(auth(officer)).send({ name: 'Placement policy 2026', templateId: 'one-offer' });
    expect(c.status).toBe(201);
    policyId = c.body.policy.id; v1 = c.body.version.id;
    expect(c.body.version).toMatchObject({ version: 1, status: 'draft' });
    expect((await request(app).post(`${B}/policy/policies`).set(auth(officer)).send({ name: 'placement POLICY 2026' })).status).toBe(409); // unique per tenant
    expect((await request(app).post(`${B}/policy/policies`).set(auth(officer)).send({ name: 'Bad', policy: { nope: 1 } })).status).toBe(400);
    const put = await request(app).put(`${B}/policy/versions/${v1}`).set(auth(officer)).send({ note: 'initial', policy: { oneOffer: { enabled: true }, defaults: { minCgpa: 6 } } });
    expect(put.status).toBe(200);
    expect(put.body.version.policy.defaults.minCgpa).toBe(6);
    expect((await request(app).get(`${B}/policy/active`).set(auth(officer))).body.policy).toBeNull();
    const act = await request(app).post(`${B}/policy/versions/${v1}/activate`).set(auth(officer)).send({});
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ active: true, version: { status: 'active' } });
    const ts = await pool.query('SELECT policy FROM tenant_settings WHERE tenant_id=$1', [T1]);
    expect(ts.rows[0].policy).toMatchObject({ oneOffer: { enabled: true }, defaults: { minCgpa: 6 }, _meta: { versionId: v1, version: 1 } });
    expect((await getActivePolicy(pool, T1))!.version.id).toBe(v1);
    expect((await request(app).put(`${B}/policy/versions/${v1}`).set(auth(officer)).send({ note: 'x' })).body.error.code).toBe('VERSION_NOT_DRAFT');
  });

  it('a new version supersedes the active one; rollback restores the earlier content as a new version', async () => {
    const n = await request(app).post(`${B}/policy/policies/${policyId}/versions`).set(auth(officer)).send({ policy: { oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 2 } }, note: 'allow 2x' });
    expect(n.status).toBe(201);
    v2 = n.body.version.id;
    expect(n.body.version.version).toBe(2);
    await request(app).post(`${B}/policy/versions/${v2}/activate`).set(auth(officer)).send({});
    const detail = await request(app).get(`${B}/policy/policies/${policyId}`).set(auth(officer));
    expect(detail.body.versions.map((v: any) => [v.version, v.status])).toEqual([[2, 'active'], [1, 'superseded']]);
    expect((await pool.query('SELECT policy FROM tenant_settings')).rows[0].policy.upgrade.multiplier).toBe(2);
    const rb = await request(app).post(`${B}/policy/policies/${policyId}/rollback`).set(auth(officer)).send({ toVersionId: v1 });
    expect(rb.status).toBe(201);
    expect(rb.body.version).toMatchObject({ version: 3, status: 'active', rollbackOf: v1 });
    expect(rb.body.version.policy.upgrade.enabled).toBe(false);
    const ts = (await pool.query('SELECT policy FROM tenant_settings')).rows[0].policy;
    expect(ts.upgrade.enabled).toBe(false);
    expect(ts._meta.version).toBe(3);
    const after = await request(app).get(`${B}/policy/policies/${policyId}`).set(auth(officer));
    expect(after.body.versions.map((v: any) => v.status)).toEqual(['active', 'superseded', 'superseded']);
    // a never-activated draft is not a rollback target
    const d = await request(app).post(`${B}/policy/policies/${policyId}/versions`).set(auth(officer)).send({});
    expect((await request(app).post(`${B}/policy/policies/${policyId}/rollback`).set(auth(officer)).send({ toVersionId: d.body.version.id })).body.error.code).toBe('NOT_ROLLBACKABLE');
  });

  it('clone creates an independent policy; approval rules respect the tenant setting', async () => {
    const cl = await request(app).post(`${B}/policy/policies/${policyId}/clone`).set(auth(officer)).send({ name: 'Copy of policy' });
    expect(cl.status).toBe(201);
    expect(cl.body.version).toMatchObject({ version: 1, status: 'draft' });
    await request(app).put(`${B}/ops/settings`).set(auth(officer)).send({ policyApproval: 'required' });
    const vid = cl.body.version.id;
    expect((await request(app).post(`${B}/policy/versions/${vid}/activate`).set(auth(officer)).send({})).body.error.code).toBe('APPROVAL_REQUIRED');
    expect((await request(app).post(`${B}/policy/versions/${vid}/approve`).set(auth(officer)).send({})).body.error.code).toBe('SELF_APPROVAL');
    expect((await request(app).post(`${B}/policy/versions/${vid}/approve`).set(auth(officer2)).send({})).status).toBe(200);
    expect((await request(app).post(`${B}/policy/versions/${vid}/activate`).set(auth(officer)).send({})).body.active).toBe(true);
    await request(app).put(`${B}/ops/settings`).set(auth(officer)).send({ policyApproval: 'not_required' });
    const a = await request(app).get(`${B}/audit?action=policy.*`).set(auth(officer));
    expect(a.body.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(['policy.create', 'policy.activate', 'policy.rollback', 'policy.clone', 'policy.approve']));
  });

  it('a future effective date schedules the version instead of activating it', async () => {
    const p = await request(app).post(`${B}/policy/policies`).set(auth(officer)).send({ name: 'Future policy', policy: { notes: 'later' } });
    const upd = await request(app).put(`${B}/policy/versions/${p.body.version.id}`).set(auth(officer)).send({ effectiveFrom: new Date(Date.now() + 86400000).toISOString() });
    expect(upd.status).toBe(200);
    const act = await request(app).post(`${B}/policy/versions/${p.body.version.id}/activate`).set(auth(officer)).send({});
    expect(act.body).toMatchObject({ active: false, version: { status: 'scheduled' } });
    expect((await getActivePolicy(pool, T1))!.policy.notes).not.toBe('later');
    const later = await getActivePolicy(pool, T1, new Date(Date.now() + 2 * 86400000));
    expect(later!.policy.notes).toBe('later');
    expect((await pool.query(`SELECT status FROM policy_versions WHERE id=$1`, [p.body.version.id])).rows[0].status).toBe('active');
    // put the one-offer policy back for the following tests
    const back = await request(app).post(`${B}/policy/policies/${policyId}/rollback`).set(auth(officer)).send({ toVersionId: v1 });
    expect(back.status).toBe(201);
    expect((await getActivePolicy(pool, T1))!.policy.oneOffer.enabled).toBe(true);
  });

  it('simulation: counts, per-reason, samples and diff vs the current policy, without writing', async () => {
    const holder = await makeEligibleStudent(app);
    const other = await makeEligibleStudent(app);
    const d1 = await createOpenDrive(app, officer, { ctc: { fixedLpa: 10, kind: 'annual', breakdownProvided: true } });
    const ap = await applyTo(app, holder, d1.id);
    expect(ap.status).toBe(201);
    const id = ap.body.application.id;
    for (const status of ['screening', 'selected', 'offer_issued']) await request(app).post(`${B}/applications/${id}/status`).set(auth(officer)).send({ status });
    expect((await request(app).post(`${B}/applications/${id}/respond`).set(auth(holder)).send({ decision: 'accept' })).status).toBe(200);
    const d2 = await createOpenDrive(app, officer, { ctc: { fixedLpa: 12, kind: 'annual', breakdownProvided: true } });
    const before = (await pool.query('SELECT count(*)::int n FROM policy_versions')).rows[0].n;
    // current = one-offer (holder blocked on d2). Draft = one-offer + 1.1x upgrade => holder allowed (12 >= 1.1*10)
    const sim = await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({ driveId: d2.id, draft: { oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 1.1 } } });
    expect(sim.status).toBe(200);
    expect(sim.body.current).toMatchObject({ notEligible: 1, eligible: 1 + 0 });
    expect(sim.body.candidate).toMatchObject({ notEligible: 0 });
    expect(sim.body.diff.newlyEligible).toBe(1);
    expect(sim.body.samples.newlyEligible[0].studentId).toBe(holder.id);
    // stricter draft: default min 10th % of 95 (drives that set their own limits keep them) => students at 90% become ineligible
    const strict = await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({ driveId: d2.id, draft: { defaults: { min10th: 95 } } });
    expect(strict.body.diff.newlyIneligible).toBeGreaterThanOrEqual(1);
    expect(strict.body.perReason.find((r: any) => r.criterion === 'tenthPercent').failed).toBeGreaterThanOrEqual(2);
    expect(strict.body.samples.newlyIneligible.length).toBeGreaterThan(0);
    // by saved version, no driveId => all open drives
    const all = await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({ versionId: v2 });
    expect(all.body.drives).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM policy_versions')).rows[0].n).toBe(before);
    expect((await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({})).status).toBe(400);
    expect((await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({ draft: { oneOffer: { enabled: true } }, versionId: v1 })).status).toBe(400);
    expect((await request(app).post(`${B}/policy/simulate`).set(auth(officer)).send({ draft: { x: 1 } })).status).toBe(400);
    expect(other.id).toBeTruthy();
  });

  it('apply honours the active policy, records the evaluation, and never rewrites earlier applications', async () => {
    const s = await makeEligibleStudent(app);
    const cheap = await createOpenDrive(app, officer, { ctc: { fixedLpa: 10, kind: 'annual', breakdownProvided: true } });
    const rich = await createOpenDrive(app, officer, { ctc: { fixedLpa: 16, kind: 'annual', breakdownProvided: true } });
    const open = await createOpenDrive(app, officer, { ctc: { fixedLpa: 9, kind: 'annual', breakdownProvided: true } });
    const pendingApp = await applyTo(app, s, open.id); // applied while no accepted offer yet
    expect(pendingApp.status).toBe(201);
    const oldVersion = (await pool.query('SELECT snapshot FROM applications WHERE id=$1', [pendingApp.body.application.id])).rows[0].snapshot.policy.versionId;
    const first = await applyTo(app, s, cheap.id);
    const id = first.body.application.id;
    for (const status of ['screening', 'selected', 'offer_issued']) await request(app).post(`${B}/applications/${id}/status`).set(auth(officer)).send({ status });
    await request(app).post(`${B}/applications/${id}/respond`).set(auth(s)).send({ decision: 'accept' });

    const blocked = await applyTo(app, s, rich.id);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('NOT_ELIGIBLE');
    expect(blocked.body.error.message).toMatch(/accepted offer/);
    const prev = await request(app).post(`${B}/drives/${rich.id}/application/preview`).set(auth(s));
    expect(prev.body.canApply).toBe(false);
    const ev = await request(app).get(`${B}/policy/evaluations?studentId=${s.id}&driveId=${rich.id}`).set(auth(officer));
    expect(ev.body.items[0]).toMatchObject({ status: 'not_eligible', studentId: s.id, driveId: rich.id });
    expect(ev.body.items[0].policyVersionId).toBeTruthy();

    // switch to a 1.5x upgrade policy: 16 >= 1.5 * 10
    const p = await request(app).post(`${B}/policy/policies`).set(auth(officer)).send({ name: 'Upgrade 1.5x', templateId: 'upgrade-1-5x' });
    await request(app).post(`${B}/policy/versions/${p.body.version.id}/activate`).set(auth(officer)).send({});
    const ok = await applyTo(app, s, rich.id);
    expect(ok.status).toBe(201);
    const snap = (await pool.query('SELECT snapshot, status FROM applications WHERE id=$1', [ok.body.application.id])).rows[0];
    expect(snap.snapshot.policy.versionId).toBe(p.body.version.id);
    // the older application keeps its original snapshot and status after the policy changed twice
    const old = (await pool.query('SELECT snapshot, status FROM applications WHERE id=$1', [pendingApp.body.application.id])).rows[0];
    expect(old.status).toBe('submitted');
    expect(old.snapshot.policy.versionId).toBe(oldVersion);
    expect(old.snapshot.policy.versionId).not.toBe(p.body.version.id);
  });

  it('drive extra conditions are validated on save and enforced on apply', async () => {
    const dept = 'Electronics';
    const badDrive = await request(app).post(`${B}/drives`).set(auth(officer)).send(baseDrive({ rules: { minCgpa: 6, extra: { field: 'nope', op: 'eq', value: 1 } } }));
    expect(badDrive.status).toBe(400);
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { rules: { minCgpa: 6, extra: { any: [{ field: 'department', op: 'eq', value: dept }, { all: [{ field: 'cgpa', op: 'gte', value: 9 }, { not: { field: 'activeBacklogs', op: 'gt', value: 0 } }] }] } } });
    const r = await applyTo(app, s, d.id);
    expect(r.status).toBe(422); // Computer Science, cgpa 8.2 -> extra fails
    expect(r.body.error.code).toBe('NOT_ELIGIBLE');
    const list = await request(app).get(`${B}/drives/${d.id}`).set(auth(s));
    expect(list.body.drive.eligibility.status).toBe('not_eligible');
    const s2 = await makeEligibleStudent(app, { department: dept });
    expect((await applyTo(app, s2, d.id)).status).toBe(201);
  });

  it('students and anonymous users cannot reach policy endpoints', async () => {
    const st = await register(app, 'student');
    expect((await request(app).get(`${B}/policy/active`).set(auth(st))).status).toBe(403);
    expect((await request(app).post(`${B}/policy/simulate`).set(auth(st)).send({})).status).toBe(403);
    expect((await request(app).get(`${B}/policy/templates`)).status).toBe(401);
  });
});
