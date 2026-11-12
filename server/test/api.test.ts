import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/context';
import {
  applyTo, auth, baseDrive, cfg, createOpenDrive, makeApp, makeEligibleStudent, pool, register, resetDb, goodAcademics,
} from './helpers';

let app: Express;
let officer: Awaited<ReturnType<typeof register>>;
const B = '/api/v1';

beforeAll(async () => {
  await resetDb();
  app = makeApp();
  officer = await register(app, 'officer');
});
afterAll(async () => {
  await pool.end();
});

describe('health and errors', () => {
  it('health and time', async () => {
    expect((await request(app).get(`${B}/health`)).body.status).toBe('ok');
    const t = await request(app).get(`${B}/time`);
    expect(Math.abs(Date.parse(t.body.now) - Date.now())).toBeLessThan(5000);
  });
  it('unknown route 404 uses error envelope; bad JSON 400; no stack leak', async () => {
    const a = await request(app).get(`${B}/nope`).set(auth(officer));
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe('NOT_FOUND');
    const b = await request(app).post(`${B}/auth/login`).set('content-type', 'application/json').send('{bad');
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(b.body)).not.toMatch(/at .*\.ts|node_modules/);
  });
  it('malformed uuid does not 500', async () => {
    const r = await request(app).get(`${B}/drives/not-a-uuid`).set(auth(officer));
    expect(r.status).toBe(400);
  });
  it('rate limits auth routes', async () => {
    const limited = makeApp({ authMax: 3, globalMax: 1000 });
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await request(limited).post(`${B}/auth/login`).send({ email: 'a@b.com', password: 'x' })).status;
    expect(last).toBe(429);
  });
});

describe('registration and auth', () => {
  const body = (o: Record<string, unknown> = {}) => ({ name: 'Asha Rao', email: 'asha.rao@example.com', phone: '9876501234', password: 'Passw0rd1', role: 'student', acceptTerms: true, ...o });

  it('registers a student and returns tokens', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body());
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ name: 'Asha Rao', email: 'asha.rao@example.com', phone: '9876501234', role: 'student', phoneDisplay: '+91 98765 01234' });
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|passwordHash|"password"\s*:/i);
    expect(r.body.user).toMatchObject({ emailVerified: false, authProvider: 'password', hasPassword: true });
  });

  it('rejects gmial.com typo with the suggestion', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ email: 'someone123@gmial.com', phone: '9876501235' }));
    expect(r.status).toBe(400);
    expect(r.body.error.fields.email).toBe('Did you mean gmail.com?');
  });
  it('rejects bad phone variants with field errors', async () => {
    for (const phone of ['987650123', '98765012345', '9999999999', '98765abc12', '5876501234']) {
      const r = await request(app).post(`${B}/auth/register`).send(body({ email: `p${randomUUID().slice(0, 6)}@example.com`, phone }));
      expect(r.status, phone).toBe(400);
      expect(r.body.error.fields.phone).toBe('Enter a valid 10-digit mobile number starting with 6–9');
    }
  });
  it('accepts +91 / 0-prefixed phone and stores 10 digits', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ email: 'plus91@example.com', phone: '+91 98765-01236' }));
    expect(r.status).toBe(201);
    expect(r.body.user.phone).toBe('9876501236');
    const z = await request(app).post(`${B}/auth/register`).send(body({ email: 'zero0@example.com', phone: '09876501237' }));
    expect(z.status).toBe(201);
    expect(z.body.user.phone).toBe('9876501237');
  });
  it('rejects weak password and bad name', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ email: 'weak@example.com', phone: '9876501238', password: 'password', name: 'X1' }));
    expect(r.status).toBe(400);
    expect(r.body.error.fields.password).toMatch(/number/);
    expect(r.body.error.fields.name).toBeTruthy();
  });
  it('duplicate email -> 409 (gmail dots/plus/googlemail count as the same)', async () => {
    const first = await request(app).post(`${B}/auth/register`).send(body({ email: 'john.smith@gmail.com', phone: '9876501240' }));
    expect(first.status).toBe(201);
    const same = await request(app).post(`${B}/auth/register`).send(body({ email: 'John.Smith@gmail.com', phone: '9876501241' }));
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('EMAIL_TAKEN');
    const variant = await request(app).post(`${B}/auth/register`).send(body({ email: 'johnsmith+x@googlemail.com', phone: '9876501242' }));
    expect(variant.status).toBe(409);
  });
  it('duplicate phone -> 409', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ email: 'other.person@example.com', phone: '+91 98765 01234' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PHONE_TAKEN');
    expect(r.body.error.fields.phone).toBeTruthy();
  });
  it('officer needs the invite code', async () => {
    const r = await request(app).post(`${B}/auth/register`).send(body({ email: 'off1@example.com', phone: '9876501250', role: 'officer' }));
    expect(r.status).toBe(403);
    const bad = await request(app).post(`${B}/auth/register`).send(body({ email: 'off1@example.com', phone: '9876501250', role: 'officer', inviteCode: 'nope' }));
    expect(bad.status).toBe(403);
    const ok = await request(app).post(`${B}/auth/register`).send(body({ email: 'off1@example.com', phone: '9876501250', role: 'officer', inviteCode: 'TEST-INVITE' }));
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe('officer');
  });
  it('login success/failure, /me, refresh rotation and reuse detection, logout', async () => {
    const bad = await request(app).post(`${B}/auth/login`).send({ email: 'asha.rao@example.com', password: 'wrongpass1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const ok = await request(app).post(`${B}/auth/login`).send({ email: 'ASHA.RAO@example.com', password: 'Passw0rd1' });
    expect(ok.status).toBe(200);
    const me = await request(app).get(`${B}/me`).set('Authorization', `Bearer ${ok.body.accessToken}`);
    expect(me.body.user.email).toBe('asha.rao@example.com');

    const r1 = await request(app).post(`${B}/auth/refresh`).send({ refreshToken: ok.body.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(ok.body.refreshToken);
    const stored = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id=$1', [ok.body.user.id]);
    expect(stored.rows.every((x) => x.token_hash !== ok.body.refreshToken && x.token_hash.length === 64)).toBe(true);
    // old token reuse -> 401 and whole family revoked
    const reuse = await request(app).post(`${B}/auth/refresh`).send({ refreshToken: ok.body.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app).post(`${B}/auth/refresh`).send({ refreshToken: r1.body.refreshToken });
    expect(afterReuse.status).toBe(401);

    const l2 = await request(app).post(`${B}/auth/login`).send({ email: 'asha.rao@example.com', password: 'Passw0rd1' });
    await request(app).post(`${B}/auth/logout`).send({ refreshToken: l2.body.refreshToken });
    expect((await request(app).post(`${B}/auth/refresh`).send({ refreshToken: l2.body.refreshToken })).status).toBe(401);
  });
  it('requires auth and rejects tampered / expired tokens', async () => {
    expect((await request(app).get(`${B}/me`)).status).toBe(401);
    expect((await request(app).get(`${B}/me`).set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });
  it('change password and soft delete', async () => {
    const s = await register(app, 'student', { password: 'Passw0rdX' });
    const wrong = await request(app).post(`${B}/me/change-password`).set(auth(s)).send({ currentPassword: 'nope1234', newPassword: 'NewPassw0rd' });
    expect(wrong.status).toBe(400);
    const weak = await request(app).post(`${B}/me/change-password`).set(auth(s)).send({ currentPassword: 'Passw0rdX', newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post(`${B}/me/change-password`).set(auth(s)).send({ currentPassword: 'Passw0rdX', newPassword: 'NewPassw0rd' });
    expect(ok.status).toBe(200);
    expect((await request(app).post(`${B}/auth/login`).send({ email: s.email, password: 'NewPassw0rd' })).status).toBe(200);
    expect((await request(app).delete(`${B}/me`).set(auth(s))).status).toBe(200);
    expect((await request(app).get(`${B}/me`).set(auth(s))).status).toBe(401);
    expect((await request(app).post(`${B}/auth/login`).send({ email: s.email, password: 'NewPassw0rd' })).status).toBe(401);
  });
});

describe('profile', () => {
  it('completion grows, verification flags are managed server-side', async () => {
    const s = await register(app, 'student');
    const p0 = await request(app).get(`${B}/profile`).set(auth(s));
    expect(p0.body.completion.percent).toBe(8); // only the mobile number (given at sign-up) is done
    expect(p0.body.completion.items.find((i: any) => i.key === 'phone')).toMatchObject({ label: 'Mobile number', done: true });
    expect(p0.body.completion.nextStep).toBeTruthy();
    const put = await request(app).put(`${B}/profile`).set(auth(s)).send({
      identity: { registrationNumber: 'cse22b0001' }, academics: goodAcademics, contact: { city: 'Pune', state: 'MH' },
      links: { linkedin: 'https://www.linkedin.com/in/x' }, skills: ['SQL', 'SQL', 'TS'],
    });
    expect(put.status).toBe(200);
    expect(put.body.identity.registrationNumber).toBe('CSE22B0001');
    expect(put.body.skills).toEqual(['SQL', 'TS']);
    expect(put.body.verification['academics.cgpa']).toBe('unverified');
    expect(put.body.verification['contact.city']).toBe('student_confirmed');
    expect(put.body.completion.percent).toBeGreaterThan(50);
    expect(put.body.completion.items.every((i: any) => 'key' in i && 'label' in i && 'done' in i && 'why' in i)).toBe(true);
  });
  it('validates fields and rejects unknown keys', async () => {
    const s = await register(app, 'student');
    const r = await request(app).put(`${B}/profile`).set(auth(s)).send({
      academics: { cgpa: 10.5, tenthPercent: 101, activeBacklogs: 2.5, batchYear: 2010 }, links: { linkedin: 'https://evil.com/x', github: 'http://github.com/x' },
    });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields)).toEqual(expect.arrayContaining(['academics.cgpa', 'academics.tenthPercent', 'academics.activeBacklogs', 'academics.batchYear', 'links.linkedin', 'links.github']));
    expect((await request(app).put(`${B}/profile`).set(auth(s)).send({ verification: { x: 'verified' } })).status).toBe(400);
    const scale = await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 4.5, cgpaScale: 4 } });
    expect(scale.status).toBe(400);
  });
  it('officer verifies; editing a verified field resets it', async () => {
    const s = await makeEligibleStudent(app);
    const v = await request(app).post(`${B}/students/${s.id}/verify`).set(auth(officer)).send({ fields: ['academics.cgpa', 'academics.department'] });
    expect(v.status).toBe(200);
    let p = await request(app).get(`${B}/profile`).set(auth(s));
    expect(p.body.verification['academics.cgpa']).toBe('verified');
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 8.2 } }); // unchanged keeps verified
    p = await request(app).get(`${B}/profile`).set(auth(s));
    expect(p.body.verification['academics.cgpa']).toBe('verified');
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 8.9 } });
    p = await request(app).get(`${B}/profile`).set(auth(s));
    expect(p.body.verification['academics.cgpa']).toBe('unverified');
    expect(p.body.verification['academics.department']).toBe('verified');
    expect((await request(app).post(`${B}/students/${s.id}/verify`).set(auth(officer)).send({ fields: ['academics.bogus'] })).status).toBe(400);
    expect((await request(app).post(`${B}/students/${s.id}/verify`).set(auth(s)).send({ fields: ['academics.cgpa'] })).status).toBe(403);
  });
  it('resumes: https only, max 5, one default', async () => {
    const s = await register(app, 'student');
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'x', url: 'http://a.com/cv' })).status).toBe(400);
    const first = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'A', url: 'https://a.com/1.pdf' });
    expect(first.body.resume.isDefault).toBe(true);
    const second = await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'B', url: 'https://a.com/2.pdf', isDefault: true });
    expect(second.body.resume.isDefault).toBe(true);
    for (let i = 3; i <= 5; i++) await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: `R${i}`, url: `https://a.com/${i}.pdf` });
    expect((await request(app).post(`${B}/profile/resumes`).set(auth(s)).send({ label: 'R6', url: 'https://a.com/6.pdf' })).status).toBe(409);
    const list = await request(app).get(`${B}/profile/resumes`).set(auth(s));
    expect(list.body.items.filter((x: any) => x.isDefault)).toHaveLength(1);
    expect(list.body.items[0].id).toBe(second.body.resume.id);
    const del = await request(app).delete(`${B}/profile/resumes/${second.body.resume.id}`).set(auth(s));
    expect(del.status).toBe(200);
    const after = await request(app).get(`${B}/profile/resumes`).set(auth(s));
    expect(after.body.items.filter((x: any) => x.isDefault)).toHaveLength(1);
  });
  it('officers cannot use student profile routes', async () => {
    expect((await request(app).get(`${B}/profile`).set(auth(officer))).status).toBe(403);
  });
});

describe('drives: CRUD, publish gate, eligibility', () => {
  it('students cannot create drives; unauthenticated 401', async () => {
    const s = await register(app, 'student');
    expect((await request(app).post(`${B}/drives`).set(auth(s)).send(baseDrive())).status).toBe(403);
    expect((await request(app).post(`${B}/drives`).send(baseDrive())).status).toBe(401);
    expect((await request(app).get(`${B}/drives`)).status).toBe(401);
  });
  it('publish gate lists missing items (422) and rejects past deadline', async () => {
    const d = await request(app).post(`${B}/drives`).set(auth(officer)).send({ company: { name: 'Draft Co' }, role: 'Analyst' });
    expect(d.status).toBe(201);
    expect(d.body.drive.status).toBe('draft');
    const pub = await request(app).post(`${B}/drives/${d.body.drive.id}/publish`).set(auth(officer));
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('DRIVE_INCOMPLETE');
    expect(Object.keys(pub.body.error.fields)).toEqual(expect.arrayContaining(['workMode', 'locations', 'ctc.fixedLpa', 'deadline', 'jd', 'rounds', 'contact', 'rules']));
    const upd = await request(app).put(`${B}/drives/${d.body.drive.id}`).set(auth(officer)).send(baseDrive({ company: { name: 'Draft Co' }, deadline: new Date(Date.now() - 60000).toISOString() }));
    expect(upd.status).toBe(200);
    const pub2 = await request(app).post(`${B}/drives/${d.body.drive.id}/publish`).set(auth(officer));
    expect(pub2.status).toBe(422);
    expect(pub2.body.error.fields.deadline).toMatch(/future/);
  });
  it('drive validation errors are 400 with fields', async () => {
    const r = await request(app).post(`${B}/drives`).set(auth(officer)).send({ workMode: 'moon', questions: [{ label: 'Pick', type: 'single_select', options: ['a'] }], contact: { email: 'x@gmial.com' } });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.workMode).toBeTruthy();
    expect(r.body.error.fields['contact.email']).toBe('Did you mean gmail.com?');
    expect(Object.keys(r.body.error.fields).some((k) => k.startsWith('questions'))).toBe(true);
  });
  it('drafts are hidden from students; open drives show eligibility reasons', async () => {
    const draft = await request(app).post(`${B}/drives`).set(auth(officer)).send(baseDrive({ company: { name: 'HiddenCo' } }));
    const s = await makeEligibleStudent(app, { cgpa: 6.5 });
    expect((await request(app).get(`${B}/drives/${draft.body.drive.id}`).set(auth(s))).status).toBe(404);
    const list0 = await request(app).get(`${B}/drives`).set(auth(s));
    expect(list0.body.items.find((i: any) => i.id === draft.body.drive.id)).toBeUndefined();

    const open = await createOpenDrive(app, officer, { company: { name: 'EligCo', verified: true }, rules: { minCgpa: 7, maxActiveBacklogs: 0, allowedDepartments: ['Computer Science'], allowedBatches: [2026] } });
    const detail = await request(app).get(`${B}/drives/${open.id}`).set(auth(s));
    expect(detail.status).toBe(200);
    expect(detail.body.drive.eligibility.status).toBe('not_eligible');
    expect(detail.body.drive.eligibility.reason).toMatch(/Minimum CGPA 7 required, yours is 6.5/);
    const cg = detail.body.drive.eligibilityReasons.find((x: any) => x.criterion === 'cgpa');
    expect(cg).toMatchObject({ required: 7, actual: 6.5, met: false, source: 'profile', verification: 'unverified' });
    const dep = detail.body.drive.eligibilityReasons.find((x: any) => x.criterion === 'department');
    expect(dep.met).toBe(true);
    expect(detail.body.drive.dataSharedPreview.length).toBeGreaterThan(3);
    // list shape
    const item = (await request(app).get(`${B}/drives?q=EligCo`).set(auth(s))).body.items[0];
    expect(Object.keys(item)).toEqual(expect.arrayContaining(['id', 'company', 'role', 'workMode', 'locations', 'ctc', 'deadline', 'status', 'eligibility', 'saved', 'applied']));
    expect(item.company).toMatchObject({ name: 'EligCo', verified: true });
    expect(item.ctc).toMatchObject({ fixedLpa: 10, kind: 'annual' });
  });
  it('eligibility: pending when data missing, filters work', async () => {
    const s = await register(app, 'student');
    const open = await createOpenDrive(app, officer, { company: { name: 'PendingCo' }, rules: { minCgpa: 7 } });
    const it1 = (await request(app).get(`${B}/drives/${open.id}`).set(auth(s))).body.drive;
    expect(it1.eligibility.status).toBe('pending');
    const f = await request(app).get(`${B}/drives?eligibility=pending&q=PendingCo`).set(auth(s));
    expect(f.body.items).toHaveLength(1);
    expect((await request(app).get(`${B}/drives?eligibility=eligible&q=PendingCo`).set(auth(s))).body.items).toHaveLength(0);
    expect((await request(app).get(`${B}/drives?limit=0`).set(auth(s))).status).toBe(400);
  });
  it('save/unsave, status filter, closing status, pagination', async () => {
    const s = await makeEligibleStudent(app);
    const soon = await createOpenDrive(app, officer, { company: { name: 'SoonCo' }, deadline: new Date(Date.now() + 3 * 3600_000).toISOString() });
    expect((await request(app).get(`${B}/drives/${soon.id}`).set(auth(s))).body.drive.status).toBe('closing');
    await request(app).put(`${B}/drives/${soon.id}/save`).set(auth(s));
    const saved = await request(app).get(`${B}/drives?saved=1`).set(auth(s));
    expect(saved.body.items.map((i: any) => i.id)).toEqual([soon.id]);
    expect(saved.body.items[0].saved).toBe(true);
    await request(app).delete(`${B}/drives/${soon.id}/save`).set(auth(s));
    expect((await request(app).get(`${B}/drives?saved=1`).set(auth(s))).body.items).toHaveLength(0);
    const p1 = await request(app).get(`${B}/drives?limit=2`).set(auth(s));
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await request(app).get(`${B}/drives?limit=2&cursor=${p1.body.nextCursor}`).set(auth(s));
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect((await request(app).get(`${B}/drives?cursor=garbage`).set(auth(s))).status).toBe(400);
    expect((await request(app).get(`${B}/drives?status=closing`).set(auth(s))).body.items.every((i: any) => i.status === 'closing')).toBe(true);
  });
  it('close, duplicate, eligible-count, applicants', async () => {
    const e = await makeEligibleStudent(app);
    const ne = await makeEligibleStudent(app, { cgpa: 5 });
    await register(app, 'student'); // pending
    const d = await createOpenDrive(app, officer, { company: { name: 'CountCo' } });
    const ec = await request(app).get(`${B}/drives/${d.id}/eligible-count`).set(auth(officer));
    expect(ec.status).toBe(200);
    expect(ec.body.eligible).toBeGreaterThanOrEqual(1);
    expect(ec.body.notEligible).toBeGreaterThanOrEqual(1);
    expect(ec.body.pending).toBeGreaterThanOrEqual(1);
    expect(ec.body.perReason.cgpa.failed).toBeGreaterThanOrEqual(1);
    expect((await applyTo(app, e, d.id)).status).toBe(201);
    const apps = await request(app).get(`${B}/drives/${d.id}/applicants`).set(auth(officer));
    expect(apps.body.items).toHaveLength(1);
    expect(apps.body.items[0].student.id).toBe(e.id);
    expect((await request(app).get(`${B}/drives/${d.id}/applicants`).set(auth(ne))).status).toBe(403);
    const dup = await request(app).post(`${B}/drives/${d.id}/duplicate`).set(auth(officer));
    expect(dup.status).toBe(201);
    expect(dup.body.drive.status).toBe('draft');
    expect(dup.body.drive.deadline).toBeNull();
    const closed = await request(app).post(`${B}/drives/${d.id}/close`).set(auth(officer));
    expect(closed.body.drive.status).toBe('closed');
    expect((await request(app).put(`${B}/drives/${d.id}`).set(auth(officer)).send({ role: 'x' })).status).toBe(409);
    const late = await applyTo(app, ne, d.id);
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('DEADLINE_PASSED');
  });
});

describe('apply flow', () => {
  const questions = [
    { id: 'why', label: 'Why us?', type: 'long_text', required: true, maxLength: 50 },
    { id: 'rel', label: 'Relocate?', type: 'yes_no', required: true },
    { id: 'city', label: 'City', type: 'short_text', required: false, saveToProfileKey: 'contact.city' },
    { id: 'decl', label: 'I confirm', type: 'declaration', required: true },
  ];

  it('preview then happy path, replay with same key, different key 409', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'ApplyCo' }, questions });
    const pv = await request(app).post(`${B}/drives/${d.id}/application/preview`).set(auth(s));
    expect(pv.status).toBe(200);
    expect(pv.body.canApply).toBe(true);
    expect(pv.body.mapped.find((m: any) => m.key === 'cgpa')).toMatchObject({ value: 8.2, source: 'profile', verification: 'unverified', sharedWith: 'ApplyCo' });
    expect(pv.body.questionsToAsk).toHaveLength(4);
    expect(pv.body.resumes).toHaveLength(1);
    expect(Date.parse(pv.body.serverNow)).toBeGreaterThan(0);
    expect(pv.body.deadline).toBe(d.deadline);

    const key = randomUUID();
    const answers = { why: 'Great mission', rel: true, city: 'Mumbai', decl: true };
    const a1 = await request(app).post(`${B}/drives/${d.id}/apply`).set(auth(s)).send({ idempotencyKey: key, resumeId: s.resumeId, answers, declarationsAccepted: true, saveToProfile: ['contact.city'] });
    expect(a1.status).toBe(201);
    expect(a1.body.application).toMatchObject({ id: expect.any(String), reference: expect.stringMatching(/^PL-\d{4}-[0-9A-F]{8}$/), submittedAt: expect.any(String) });
    const a2 = await request(app).post(`${B}/drives/${d.id}/apply`).set(auth(s)).send({ idempotencyKey: key, resumeId: s.resumeId, answers, declarationsAccepted: true });
    expect(a2.status).toBe(200);
    expect(a2.body.application).toEqual(a1.body.application);
    const a3 = await applyTo(app, s, d.id, { answers });
    expect(a3.status).toBe(409);
    expect(a3.body.error.code).toBe('ALREADY_APPLIED');
    const count = await pool.query('SELECT count(*)::int n FROM applications WHERE drive_id=$1 AND user_id=$2', [d.id, s.id]);
    expect(count.rows[0].n).toBe(1);

    // saved to profile
    expect((await request(app).get(`${B}/profile`).set(auth(s))).body.contact.city).toBe('Mumbai');
    // preview now blocked
    const pv2 = await request(app).post(`${B}/drives/${d.id}/application/preview`).set(auth(s));
    expect(pv2.body.canApply).toBe(false);
    expect(pv2.body.blockedReason).toMatch(/already applied/);
    const dd = await request(app).get(`${B}/drives/${d.id}`).set(auth(s));
    expect(dd.body.drive.applied).toBe(true);
    // timeline
    const det = await request(app).get(`${B}/applications/${a1.body.application.id}`).set(auth(s));
    expect(det.body.application.events).toHaveLength(1);
    expect(det.body.application.events[0].status).toBe('submitted');
    const list = await request(app).get(`${B}/applications`).set(auth(s));
    expect(list.body.items[0]).toMatchObject({ reference: a1.body.application.reference, status: 'submitted' });
    expect(list.body.items[0].drive.company.name).toBe('ApplyCo');
  });

  it('concurrent double submit with the same key yields a single application', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'RaceCo' } });
    const key = randomUUID();
    const body = { idempotencyKey: key, resumeId: s.resumeId, answers: {}, declarationsAccepted: true };
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(app).post(`${B}/drives/${d.id}/apply`).set(auth(s)).send(body)));
    expect(rs.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(rs.map((r) => r.body.application.reference)).size).toBe(1);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('past deadline (server time) -> 422 DEADLINE_PASSED', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'LateCo' } });
    await pool.query(`UPDATE drives SET deadline = now() - interval '1 minute' WHERE id=$1`, [d.id]);
    const r = await applyTo(app, s, d.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('DEADLINE_PASSED');
    const pv = await request(app).post(`${B}/drives/${d.id}/application/preview`).set(auth(s));
    expect(pv.body.canApply).toBe(false);
  });

  it('ineligible and pending -> 422 NOT_ELIGIBLE', async () => {
    const low = await makeEligibleStudent(app, { cgpa: 5.5 });
    const empty = await register(app, 'student');
    const rs = await request(app).post(`${B}/profile/resumes`).set(auth(empty)).send({ label: 'x', url: 'https://example.com/x.pdf' });
    const d = await createOpenDrive(app, officer, { company: { name: 'StrictCo' } });
    const r = await applyTo(app, low, d.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NOT_ELIGIBLE');
    expect(r.body.error.message).toMatch(/CGPA/);
    const r2 = await applyTo(app, { ...empty, resumeId: rs.body.resume.id }, d.id);
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('missing/invalid required answers -> 400 with fields', async () => {
    const s = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'AnswersCo' }, questions });
    const r = await applyTo(app, s, d.id, { answers: { why: 'x'.repeat(60), city: 5 } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.fields).toMatchObject({
      'answers.why': expect.stringMatching(/at most 50/), 'answers.rel': 'This answer is required', 'answers.decl': expect.any(String), 'answers.city': expect.any(String),
    });
    expect((await applyTo(app, s, d.id, { declarationsAccepted: false })).status).toBe(400);
    expect((await applyTo(app, s, d.id, { idempotencyKey: 'not-uuid' })).status).toBe(400);
    expect((await applyTo(app, s, d.id, { resumeId: randomUUID(), answers: { why: 'ok', rel: false, decl: true } })).status).toBe(400);
    // nothing was created
    expect((await pool.query('SELECT count(*)::int n FROM applications WHERE drive_id=$1', [d.id])).rows[0].n).toBe(0);
    const ok = await applyTo(app, s, d.id, { answers: { why: 'ok', rel: false, decl: true } });
    expect(ok.status).toBe(201);
  });

  it('answer types: select, multi-select, url, date, number', async () => {
    const s = await makeEligibleStudent(app);
    const qs = [
      { id: 's', label: 'S', type: 'single_select', required: true, options: ['a', 'b'] },
      { id: 'm', label: 'M', type: 'multi_select', required: true, options: ['x', 'y', 'z'] },
      { id: 'u', label: 'U', type: 'url', required: true },
      { id: 'd', label: 'D', type: 'date', required: true },
      { id: 'n', label: 'N', type: 'number', required: true },
    ];
    const d = await createOpenDrive(app, officer, { company: { name: 'TypesCo' }, questions: qs });
    const bad = await applyTo(app, s, d.id, { answers: { s: 'c', m: ['x', 'q'], u: 'http://x.com', d: '2026-02-30', n: 'five' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['answers.d', 'answers.m', 'answers.n', 'answers.s', 'answers.u']);
    const ok = await applyTo(app, s, d.id, { answers: { s: 'a', m: ['x', 'z'], u: 'https://x.com/p', d: '2026-02-20', n: 5 } });
    expect(ok.status).toBe(201);
  });

  it('withdraw before screening, officer transitions, events are append-only', async () => {
    const s = await makeEligibleStudent(app);
    const s2 = await makeEligibleStudent(app);
    const d = await createOpenDrive(app, officer, { company: { name: 'FlowCo' } });
    const a = (await applyTo(app, s, d.id)).body.application;
    const b = (await applyTo(app, s2, d.id)).body.application;

    // student cannot touch other's application nor officer status route
    expect((await request(app).post(`${B}/applications/${a.id}/withdraw`).set(auth(s2))).status).toBe(404);
    expect((await request(app).post(`${B}/applications/${a.id}/status`).set(auth(s)).send({ status: 'screening' })).status).toBe(403);
    expect((await request(app).get(`${B}/applications/${a.id}`).set(auth(s2))).status).toBe(404);

    // officer moves b along
    const bad = await request(app).post(`${B}/applications/${b.id}/status`).set(auth(officer)).send({ status: 'offer_issued' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
    expect((await request(app).post(`${B}/applications/${b.id}/status`).set(auth(officer)).send({ status: 'weird' })).status).toBe(400);
    for (const st of ['screening', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'joined']) {
      const r = await request(app).post(`${B}/applications/${b.id}/status`).set(auth(officer)).send({ status: st, note: `to ${st}` });
      expect(r.status, st).toBe(200);
    }
    expect((await request(app).post(`${B}/applications/${b.id}/status`).set(auth(officer)).send({ status: 'rejected' })).status).toBe(422);
    const tl = await request(app).get(`${B}/applications/${b.id}`).set(auth(s2));
    expect(tl.body.application.status).toBe('joined');
    expect(tl.body.application.events.map((e: any) => e.status)).toEqual(['submitted', 'screening', 'interview', 'selected', 'offer_issued', 'offer_accepted', 'joined']);
    const notes = await request(app).get(`${B}/notifications`).set(auth(s2));
    expect(notes.body.items.some((n: any) => n.type === 'application_status')).toBe(true);
    await expect(pool.query(`UPDATE application_events SET note='tamper' WHERE application_id=$1`, [b.id])).rejects.toThrow(/append-only/);

    // withdraw a (still submitted) -> allowed; afterwards can re-apply
    const w = await request(app).post(`${B}/applications/${a.id}/withdraw`).set(auth(s));
    expect(w.status).toBe(200);
    expect((await request(app).post(`${B}/applications/${a.id}/withdraw`).set(auth(s))).status).toBe(422);
    const again = await applyTo(app, s, d.id);
    expect(again.status).toBe(201);
    // after screening, withdraw is refused
    await request(app).post(`${B}/applications/${again.body.application.id}/status`).set(auth(officer)).send({ status: 'screening' });
    const wr = await request(app).post(`${B}/applications/${again.body.application.id}/withdraw`).set(auth(s));
    expect(wr.status).toBe(422);
  });
});

describe('officer-only routes and tenant scoping', () => {
  it('student gets 403, no token 401 on every officer endpoint', async () => {
    const s = await register(app, 'student');
    const d = await createOpenDrive(app, officer, { company: { name: 'GuardCo' } });
    const reqs: [string, string][] = [
      ['get', `${B}/students`], ['get', `${B}/students/${s.id}`], ['post', `${B}/students/${s.id}/verify`], ['get', `${B}/officer/dashboard`],
      ['post', `${B}/announcements`], ['post', `${B}/drives`], ['put', `${B}/drives/${d.id}`], ['post', `${B}/drives/${d.id}/publish`],
      ['post', `${B}/drives/${d.id}/close`], ['post', `${B}/drives/${d.id}/duplicate`], ['get', `${B}/drives/${d.id}/eligible-count`], ['get', `${B}/drives/${d.id}/applicants`],
      ['post', `${B}/applications/${randomUUID()}/status`],
    ];
    for (const [m, url] of reqs) {
      const r1 = await (request(app) as any)[m](url).set(auth(s)).send({});
      expect(r1.status, `${m} ${url} student`).toBe(403);
      const r2 = await (request(app) as any)[m](url).send({});
      expect(r2.status, `${m} ${url} anon`).toBe(401);
    }
  });

  it('students/dashboard/announcements work for officers', async () => {
    const s = await makeEligibleStudent(app);
    const list = await request(app).get(`${B}/students?q=${encodeURIComponent('Test')}&branch=Computer%20Science&batch=2026&verified=false`).set(auth(officer));
    expect(list.status).toBe(200);
    expect(list.body.items.some((x: any) => x.id === s.id)).toBe(true);
    const detail = await request(app).get(`${B}/students/${s.id}`).set(auth(officer));
    expect(detail.body.academics.cgpa).toBe(8.2);
    expect(detail.body.pendingVerificationFields).toContain('academics.cgpa');
    const dash = await request(app).get(`${B}/officer/dashboard`).set(auth(officer));
    expect(dash.body).toMatchObject({ openDrives: expect.any(Number), closingToday: expect.any(Number), applicationsToday: expect.any(Number), pendingVerifications: expect.any(Number), upcoming: expect.any(Array) });
    expect(dash.body.pendingVerifications).toBeGreaterThanOrEqual(1);

    const d = await createOpenDrive(app, officer, { company: { name: 'AnnounceCo' } });
    const bad = await request(app).post(`${B}/announcements`).set(auth(officer)).send({ title: '', body: 'x' });
    expect(bad.status).toBe(400);
    const before = (await request(app).get(`${B}/notifications/unread-count`).set(auth(s))).body.count;
    const ann = await request(app).post(`${B}/announcements`).set(auth(officer)).send({ title: 'Venue changed', body: 'Room 4', driveId: d.id });
    expect(ann.status).toBe(201);
    expect(ann.body.announcement.recipients).toBeGreaterThanOrEqual(1);
    const after = (await request(app).get(`${B}/notifications/unread-count`).set(auth(s))).body.count;
    expect(after).toBe(before + 1);
    expect((await request(app).get(`${B}/announcements`).set(auth(s))).body.items[0].title).toBe('Venue changed');
    expect((await request(app).get(`${B}/announcements`).set(auth(officer))).body.items.length).toBeGreaterThan(0);
    // mark read
    const ids = (await request(app).get(`${B}/notifications`).set(auth(s))).body.items.slice(0, 1).map((n: any) => n.id);
    expect((await request(app).post(`${B}/notifications/read`).set(auth(s)).send({ ids })).body.updated).toBe(1);
    await request(app).post(`${B}/notifications/read`).set(auth(s)).send({ all: true });
    expect((await request(app).get(`${B}/notifications/unread-count`).set(auth(s))).body.count).toBe(0);
    expect((await request(app).post(`${B}/notifications/read`).set(auth(s)).send({})).status).toBe(400);
  });

  it('tenant scoping: other-tenant data is invisible and untouchable', async () => {
    const T2 = '00000000-0000-4000-8000-0000000000b2';
    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Other Uni') ON CONFLICT DO NOTHING`, [T2]);
    const mk = async (role: string, tag: string, phone: string) => {
      const u = (await pool.query(
        `INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,$2,$3,$4,$4,$5,'x') RETURNING id, tenant_id, role`,
        [T2, role, `T2 ${tag}`, `${tag}@other.edu`, phone])).rows[0];
      return { id: u.id as string, token: signAccessToken(cfg, u) };
    };
    const off2 = await mk('officer', 'off', '9000011111');
    const stu2 = await mk('student', 'stu', '9000022222');
    await pool.query('INSERT INTO profiles (user_id, tenant_id) VALUES ($1,$2)', [stu2.id, T2]);
    const d2 = (await pool.query(
      `INSERT INTO drives (tenant_id, created_by, status, company, role, deadline, rules, work_mode, locations, ctc, jd, rounds, contact)
       VALUES ($1,$2,'open','{"name":"OtherTenantCo"}','Dev', now()+interval '2 days','{}','onsite','["X"]','{"fixedLpa":5}','a long enough job description here','[{"name":"r"}]','{"name":"n"}') RETURNING id`,
      [T2, off2.id])).rows[0];

    const s1 = await makeEligibleStudent(app);
    const h2 = { Authorization: `Bearer ${off2.token}` };
    // tenant-1 users cannot see tenant-2 drive
    expect((await request(app).get(`${B}/drives/${d2.id}`).set(auth(s1))).status).toBe(404);
    expect((await request(app).get(`${B}/drives/${d2.id}`).set(auth(officer))).status).toBe(404);
    expect((await request(app).get(`${B}/drives?q=OtherTenantCo`).set(auth(s1))).body.items).toHaveLength(0);
    expect((await request(app).post(`${B}/drives/${d2.id}/close`).set(auth(officer))).status).toBe(404);
    expect((await request(app).put(`${B}/drives/${d2.id}`).set(auth(officer)).send({ role: 'hax' })).status).toBe(404);
    expect((await request(app).get(`${B}/drives/${d2.id}/applicants`).set(auth(officer))).status).toBe(404);
    expect((await applyTo(app, s1, d2.id)).status).toBe(404);
    expect((await request(app).post(`${B}/drives/${d2.id}/application/preview`).set(auth(s1))).status).toBe(404);
    // tenant-2 officer cannot see tenant-1 students or drives
    expect((await request(app).get(`${B}/students/${s1.id}`).set(h2)).status).toBe(404);
    expect((await request(app).get(`${B}/students`).set(h2)).body.items.map((x: any) => x.id)).toEqual([stu2.id]);
    const list2 = await request(app).get(`${B}/drives`).set(h2);
    expect(list2.body.items.map((x: any) => x.company.name)).toEqual(['OtherTenantCo']);
    expect((await request(app).post(`${B}/students/${s1.id}/verify`).set(h2).send({ fields: ['academics.cgpa'] })).status).toBe(404);
    // announcements don't cross tenants
    await request(app).post(`${B}/announcements`).set(h2).send({ title: 'T2 only', body: 'hi' });
    const n1 = await request(app).get(`${B}/notifications`).set(auth(s1));
    expect(n1.body.items.some((n: any) => n.title === 'T2 only')).toBe(false);
    // dashboard counts are scoped
    expect((await request(app).get(`${B}/officer/dashboard`).set(h2)).body.openDrives).toBe(1);
  });
});

describe('notification settings and devices', () => {
  it('reminder settings defaults, validation, merge, reset', async () => {
    const s = await register(app, 'student');
    const d = await request(app).get(`${B}/reminder-settings`).set(auth(s));
    expect(d.body).toEqual({ t60: true, t30: true, t15: true, push: true, inApp: true, email: true, quietHours: { enabled: false, start: '22:00', end: '07:00' } });
    const u = await request(app).put(`${B}/reminder-settings`).set(auth(s)).send({ t30: false, quietHours: { enabled: true, start: '23:00' } });
    expect(u.body).toMatchObject({ t30: false, t60: true, quietHours: { enabled: true, start: '23:00', end: '07:00' } });
    expect((await request(app).put(`${B}/reminder-settings`).set(auth(s)).send({ quietHours: { start: '25:00' } })).status).toBe(400);
    expect((await request(app).put(`${B}/reminder-settings`).set(auth(s)).send({ nope: true })).status).toBe(400);
    const r = await request(app).post(`${B}/reminder-settings/reset`).set(auth(s));
    expect(r.body.t30).toBe(true);
    expect((await request(app).get(`${B}/reminder-settings`).set(auth(s))).body.quietHours.enabled).toBe(false);
  });
  it('devices register and unregister', async () => {
    const s = await register(app, 'student');
    expect((await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'bogus', platform: 'android' })).status).toBe(400);
    expect((await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'ExponentPushToken[abc123]', platform: 'android' })).status).toBe(201);
    expect((await request(app).post(`${B}/devices`).set(auth(s)).send({ expoPushToken: 'ExponentPushToken[abc123]', platform: 'android' })).status).toBe(201);
    expect((await pool.query('SELECT count(*)::int n FROM devices WHERE user_id=$1', [s.id])).rows[0].n).toBe(1);
    expect((await request(app).delete(`${B}/devices`).set(auth(s))).status).toBe(200);
    expect((await pool.query('SELECT count(*)::int n FROM devices WHERE user_id=$1', [s.id])).rows[0].n).toBe(0);
  });
});
