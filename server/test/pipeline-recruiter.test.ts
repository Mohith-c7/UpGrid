import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { canAccessCandidate, getSharedCandidate, SHARED_KEYS } from '../src/pipeline/access';
import { signAccessToken } from '../src/context';
import { cfg } from './helpers';
import {
  applyTo, audits, auth, B, createOpenDrive, makeApp, makeCandidate, makeEligibleStudent, makeRecruiter, makeRound, notifications, pool, register, resetPipelineDb, setup, addToRound,
} from './pipelineHelpers';

const app = makeApp();
beforeEach(resetPipelineDb);

describe('recruiter invites and registration', () => {
  it('officer invites by email; token is stored hashed and expires in 7 days', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const res = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'Jane.Rec@Example.com', name: 'Jane Rec' });
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ email: 'jane.rec@example.com', status: 'pending', driveId: drive.id });
    expect(res.body.inviteToken).toMatch(/^rinv_/);
    expect(res.body.emailSent).toBe(false);
    const row = (await pool.query('SELECT * FROM recruiter_invites WHERE id=$1', [res.body.invite.id])).rows[0];
    expect(JSON.stringify(row)).not.toContain(res.body.inviteToken);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect((await audits('recruiter.invite')).length).toBe(1);
  });

  it('only officers can invite', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const student = await register(app, 'student');
    for (const who of [student, recruiter]) {
      const r = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(who)).send({ email: 'x.person@example.com' });
      expect(r.status).toBe(403);
    }
    expect((await request(app).post(`${B}/drives/${drive.id}/recruiters`).send({ email: 'x.person@example.com' })).status).toBe(401);
    void officer;
  });

  it('validates the invite email (gmail typos, bad format)', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const typo = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'someone.hr@gmial.com' });
    expect(typo.status).toBe(400);
    expect(typo.body.error.fields.email).toBe('Did you mean gmail.com?');
    const bad = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);
    const badName = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'ok.person@example.com', name: '1' });
    expect(badName.status).toBe(400);
    expect(badName.body.error.fields.name).toBeTruthy();
    const badPerm = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'ok.person@example.com', permissions: { hack: true } });
    expect(badPerm.status).toBe(400);
  });

  it('refuses to invite an email that belongs to a student or officer', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const st = await register(app, 'student');
    const r = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: st.email });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_BELONGS_TO_OTHER_ROLE');
  });

  it('register-recruiter validates mobile, password, terms and the token', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const inv = (await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'hr.lead@example.com' })).body;
    const base = { inviteToken: inv.inviteToken, name: 'HR Lead', phone: '9876543210', password: 'Passw0rdX', acceptTerms: true };
    const post = (over: Record<string, unknown>) => request(app).post(`${B}/auth/register-recruiter`).send({ ...base, ...over });
    for (const phone of ['12345', '5876543210', '9999999999', '98765abc10', '1234567890']) {
      const r = await post({ phone });
      expect(r.status, phone).toBe(400);
      expect(r.body.error.fields.phone).toBe('Enter a valid 10-digit mobile number starting with 6–9');
    }
    expect((await post({ password: 'short' })).body.error.fields.password).toBeTruthy();
    expect((await post({ password: 'allletters' })).body.error.fields.password).toBeTruthy();
    expect((await post({ acceptTerms: false })).body.error.fields.acceptTerms).toBeTruthy();
    expect((await post({ name: 'X' })).body.error.fields.name).toBeTruthy();
    expect((await post({ email: 'attacker@example.com' })).status).toBe(201); // email in body is ignored: the invited address is used
    const me = await request(app).get(`${B}/me`).set('Authorization', `Bearer ${(await request(app).post(`${B}/auth/login`).send({ email: 'hr.lead@example.com', password: 'Passw0rdX' })).body.accessToken}`);
    expect(me.body.user).toMatchObject({ role: 'recruiter', email: 'hr.lead@example.com' });
  });

  it('accepts +91 / spaced mobile numbers, normalises them and consumes the invite once', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const inv = (await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'hr.two@example.com' })).body;
    const body = { inviteToken: inv.inviteToken, name: 'HR Two', phone: '+91 98765-43210', password: 'Passw0rdX', acceptTerms: true };
    const ok = await request(app).post(`${B}/auth/register-recruiter`).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({ role: 'recruiter', phone: '9876543210' });
    expect(ok.body.memberships).toHaveLength(1);
    expect((await pool.query(`SELECT 1 FROM user_consents WHERE user_id=$1`, [ok.body.user.id])).rowCount).toBe(1);
    const again = await request(app).post(`${B}/auth/register-recruiter`).send({ ...body, phone: '9876543211' });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('INVITE_INVALID');
    expect((await audits('recruiter.register')).length).toBe(1);
  });

  it('rejects unknown, expired and revoked tokens; duplicate phone is 409', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const mk = async (email: string) => (await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email })).body;
    const post = (t: string, phone = '9876543210') => request(app).post(`${B}/auth/register-recruiter`).send({ inviteToken: t, name: 'Some Body', phone, password: 'Passw0rdX', acceptTerms: true });
    expect((await post('rinv_' + 'x'.repeat(40))).body.error.code).toBe('INVITE_INVALID');
    const a = await mk('exp.one@example.com');
    await pool.query(`UPDATE recruiter_invites SET expires_at = now() - interval '1 minute' WHERE id=$1`, [a.invite.id]);
    const exp = await post(a.inviteToken);
    expect(exp.status).toBe(422);
    expect(exp.body.error.code).toBe('INVITE_EXPIRED');
    const b = await mk('rev.one@example.com');
    expect((await request(app).delete(`${B}/drives/${drive.id}/recruiter-invites/${b.invite.id}`).set(auth(officer))).body.ok).toBe(true);
    expect((await post(b.inviteToken)).status).toBe(404);
    const c1 = await mk('dup.one@example.com');
    expect((await post(c1.inviteToken)).status).toBe(201);
    const c2 = await mk('dup.two@example.com');
    const dup = await post(c2.inviteToken);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PHONE_TAKEN');
  });

  it('lookup returns the invited address and company; re-inviting reissues the token', async () => {
    const officer = await register(app, 'officer');
    const drive = await createOpenDrive(app, officer);
    const first = (await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'again.hr@example.com' })).body;
    const second = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'again.hr@example.com' });
    expect(second.status).toBe(200);
    expect(second.body.reissued).toBe(true);
    expect((await request(app).post(`${B}/auth/recruiter-invite/lookup`).send({ inviteToken: first.inviteToken })).status).toBe(404);
    const look = await request(app).post(`${B}/auth/recruiter-invite/lookup`).send({ inviteToken: second.body.inviteToken });
    expect(look.body.invite).toMatchObject({ email: 'again.hr@example.com', companyName: 'Acme Demo Co', role: 'Software Engineer' });
  });

  it('open signup can never create a recruiter', async () => {
    const r = await request(app).post(`${B}/auth/register`).send({ name: 'Sneaky One', email: 'sneaky.one@example.com', phone: '9876543210', password: 'Passw0rdX', role: 'recruiter', acceptTerms: true });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.role).toBeTruthy();
  });

  it('an existing recruiter invited to a second drive is added at once and notified', async () => {
    const { officer, recruiter } = await setup(app);
    const d2 = await createOpenDrive(app, officer, { company: { name: 'Second Co', industry: 'Software', verified: true } });
    const r = await request(app).post(`${B}/drives/${d2.id}/recruiters`).set(auth(officer)).send({ email: recruiter.email });
    expect(r.status).toBe(201);
    expect(r.body.member.userId).toBe(recruiter.id);
    expect((await notifications(recruiter.id, 'recruiter_access')).length).toBe(1);
    const dup = await request(app).post(`${B}/drives/${d2.id}/recruiters`).set(auth(officer)).send({ email: recruiter.email });
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');
    const list = await request(app).get(`${B}/recruiter/drives`).set(auth(recruiter));
    expect(list.body.items).toHaveLength(2);
  });

  it('officer can edit permissions and revoke; revoked access is gone immediately and revocation is idempotent', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const { applicationId } = await makeCandidate(app, officer, drive.id);
    const url = `${B}/pipeline/drives/${drive.id}/candidates/${applicationId}`;
    expect((await request(app).get(url).set(auth(recruiter))).status).toBe(200);
    const patch = await request(app).patch(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer)).send({ permissions: { shortlist: false } });
    expect(patch.status).toBe(200);
    expect(patch.body.member.permissions.shortlist).toBe(false);
    const dec = await request(app).post(`${url}/decision`).set(auth(recruiter)).send({ decision: 'shortlisted' });
    expect(dec.status).toBe(403);
    expect(dec.body.error).toMatchObject({ code: 'PERMISSION_DENIED', fields: { permission: 'shortlist' } });
    const rev = await request(app).delete(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer)).send({ reason: 'Contract ended' });
    expect(rev.body).toMatchObject({ revoked: true, alreadyRevoked: false });
    expect((await request(app).get(url).set(auth(recruiter))).status).toBe(404);
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/funnel`).set(auth(recruiter))).status).toBe(404);
    expect((await request(app).get(`${B}/recruiter/drives`).set(auth(recruiter))).body.items).toHaveLength(0);
    const again = await request(app).delete(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer));
    expect(again.body.alreadyRevoked).toBe(true);
    const list = await request(app).get(`${B}/drives/${drive.id}/recruiters`).set(auth(officer));
    expect(list.body.members).toHaveLength(0);
    expect((await request(app).get(`${B}/drives/${drive.id}/recruiters?includeRevoked=1`).set(auth(officer))).body.members).toHaveLength(1);
    expect((await audits('recruiter.revoke')).length).toBe(1);
    expect((await audits('recruiter.permissions')).length).toBe(1);
  });
});

describe('recruiter scoping', () => {
  it('sees only assigned drives and only drives they belong to', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const other = await createOpenDrive(app, officer, { company: { name: 'Other Co', industry: 'Software', verified: true } });
    const mine = await request(app).get(`${B}/recruiter/drives`).set(auth(recruiter));
    expect(mine.body.items.map((d: any) => d.driveId)).toEqual([drive.id]);
    for (const path of [`candidates`, `funnel`, `rounds`, `settings`, `offers`, `messages`, `slots`, `outcomes`, `rubric`]) {
      const r = await request(app).get(`${B}/pipeline/drives/${other.id}/${path}`).set(auth(recruiter));
      expect(r.status, path).toBe(404);
      expect(r.body.error.code).toBe('DRIVE_NOT_FOUND');
    }
    expect((await request(app).get(`${B}/recruiter/drives/${other.id}`).set(auth(recruiter))).status).toBe(404);
    expect((await request(app).get(`${B}/recruiter/drives/${drive.id}`).set(auth(recruiter))).status).toBe(200);
  });

  it('cannot reach a candidate of another drive, even through their own drive path', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const other = await createOpenDrive(app, officer, { company: { name: 'Other Co', industry: 'Software', verified: true } });
    const foreign = await makeCandidate(app, officer, other.id);
    const r = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates/${foreign.applicationId}`).set(auth(recruiter));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('CANDIDATE_NOT_FOUND');
    const list = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates`).set(auth(recruiter));
    expect(list.body.total).toBe(0);
  });

  it('shows only the fields the student consented to share and never the live profile', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const s = await makeEligibleStudent(app);
    await request(app).put(`${B}/profile`).set(auth(s)).send({ links: { github: 'https://github.com/secret-handle-xyz', linkedin: 'https://www.linkedin.com/in/shared-one' }, contact: { city: 'Secretville' }, skills: ['Hidden Skill'] });
    const ap = await applyTo(app, s, drive.id);
    await request(app).post(`${B}/applications/${ap.body.application.id}/status`).set(auth(officer)).send({ status: 'screening' });
    const id = ap.body.application.id;
    const detail = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates/${id}`).set(auth(recruiter));
    expect(detail.status).toBe(200);
    const text = JSON.stringify(detail.body);
    for (const secret of ['secret-handle-xyz', 'Secretville', 'Hidden Skill']) expect(text).not.toContain(secret);
    const keys = Object.keys(detail.body.candidate.fields).filter((k) => k !== 'phoneDisplay');
    expect(keys.every((k) => (SHARED_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(detail.body.candidate.fields.linkedin).toBe('https://www.linkedin.com/in/shared-one');
    expect(detail.body.candidate.fieldKeys).not.toContain('github');
    // later profile edits do not leak: the snapshot is frozen at apply time
    await request(app).put(`${B}/profile`).set(auth(s)).send({ academics: { cgpa: 9.9 } });
    const again = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates/${id}`).set(auth(recruiter));
    expect(again.body.candidate.fields.cgpa).toBe(8.2);
  });

  it('hides unscreened and withdrawn applications unless the drive allows it', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const fresh = await makeCandidate(app, officer, drive.id, 'submitted');
    const list = (q = '') => request(app).get(`${B}/pipeline/drives/${drive.id}/candidates${q}`).set(auth(recruiter));
    expect((await list()).body.total).toBe(0);
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates/${fresh.applicationId}`).set(auth(recruiter))).status).toBe(404);
    expect((await request(app).put(`${B}/pipeline/drives/${drive.id}/settings`).set(auth(recruiter)).send({ showUnscreened: true })).status).toBe(403);
    await request(app).put(`${B}/pipeline/drives/${drive.id}/settings`).set(auth(officer)).send({ showUnscreened: true });
    expect((await list()).body.total).toBe(1);
    await request(app).post(`${B}/applications/${fresh.applicationId}/withdraw`).set(auth(fresh.student)).send({});
    expect((await list()).body.total).toBe(0);
  });

  it('cannot use student/officer endpoints that would expose other data', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const { applicationId, student } = await makeCandidate(app, officer, drive.id);
    const checks: [string, string][] = [
      ['get', `${B}/drives`], ['get', `${B}/drives/${drive.id}`], ['get', `${B}/drives/${drive.id}/applicants`], ['get', `${B}/drives/${drive.id}/applicants/export`],
      ['get', `${B}/students`], ['get', `${B}/students/${student.id}`], ['get', `${B}/applications/${applicationId}`], ['get', `${B}/applications`],
      ['get', `${B}/tickets`], ['get', `${B}/profile`], ['get', `${B}/officer/dashboard`],
    ];
    for (const [m, url] of checks) {
      const r = await (request(app) as any)[m](url).set(auth(recruiter));
      expect(r.status, url).toBe(403);
    }
    expect((await request(app).post(`${B}/applications/${applicationId}/status`).set(auth(recruiter)).send({ status: 'rejected' })).status).toBe(403);
  });

  it('keeps student and officer behaviour of the existing endpoints', async () => {
    const { officer, drive } = await setup(app);
    const { applicationId, student } = await makeCandidate(app, officer, drive.id);
    expect((await request(app).get(`${B}/applications/${applicationId}`).set(auth(student))).status).toBe(200);
    expect((await request(app).get(`${B}/applications/${applicationId}`).set(auth(officer))).body.application.student.name).toBeTruthy();
    expect((await request(app).get(`${B}/drives`).set(auth(student))).status).toBe(200);
    expect((await request(app).get(`${B}/students`).set(auth(officer))).status).toBe(200);
    expect((await request(app).get(`${B}/students`).set(auth(student))).status).toBe(403);
    expect((await request(app).get(`${B}/students`)).status).toBe(401);
  });

  it('is tenant scoped: other-tenant officers and recruiters get 404', async () => {
    const { officer, drive } = await setup(app);
    const { applicationId } = await makeCandidate(app, officer, drive.id);
    const T2 = '00000000-0000-4000-8000-0000000000c3';
    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant Two') ON CONFLICT DO NOTHING`, [T2]);
    const mk = async (role: string, tag: string, phone: string) => {
      const u = (await pool.query(`INSERT INTO users (tenant_id, role, name, email, email_key, phone, password_hash) VALUES ($1,$2,'T2 User',$3,$3,$4,'x') RETURNING id, tenant_id, role`, [T2, role, `${tag}@tenant2.edu`, phone])).rows[0];
      return { id: u.id, token: signAccessToken(cfg, u), refresh: '', email: '', phone } as any;
    };
    const off2 = await mk('officer', 'off2', '9811100001');
    const rec2 = await mk('recruiter', 'rec2', '9811100002');
    await pool.query(`INSERT INTO company_recruiters (drive_id, user_id, tenant_id) VALUES ($1,$2,$3)`, [drive.id, rec2.id, T2]); // cross-tenant membership row must not grant anything
    for (const who of [off2, rec2]) {
      for (const path of ['funnel', 'rounds', 'candidates', `candidates/${applicationId}`]) {
        expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/${path}`).set(auth(who))).status, path).toBe(404);
      }
    }
    expect((await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(off2)).send({ email: 'x.y.z@example.com' })).status).toBe(404);
    const t1 = await canAccessCandidate(rec2.id, applicationId);
    expect(t1.allowed).toBe(false);
  });
});

describe('canAccessCandidate', () => {
  it('implements the access matrix', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const other = await makeRecruiter(app, officer, (await createOpenDrive(app, officer)).id);
    const c = await makeCandidate(app, officer, drive.id);
    const stranger = await makeEligibleStudent(app);
    const submitted = await makeCandidate(app, officer, drive.id, 'submitted');
    expect((await canAccessCandidate(officer.id, c.applicationId)).allowed).toBe(true);
    expect((await canAccessCandidate(c.student.id, c.applicationId)).allowed).toBe(true);
    expect(await canAccessCandidate(stranger.id, c.applicationId)).toMatchObject({ allowed: false, reason: 'not_owner' });
    const ok = await canAccessCandidate(recruiter.id, c.applicationId);
    expect(ok).toMatchObject({ allowed: true, role: 'recruiter', driveId: drive.id, studentId: c.student.id });
    expect(ok.sharedFieldKeys).toContain('cgpa');
    expect(ok.sharedFieldKeys).not.toContain('github');
    expect(await canAccessCandidate(other.id, c.applicationId)).toMatchObject({ allowed: false, reason: 'not_assigned' });
    expect(await canAccessCandidate(recruiter.id, submitted.applicationId)).toMatchObject({ allowed: false, reason: 'not_screened' });
    expect((await canAccessCandidate(recruiter.id, '00000000-0000-4000-8000-000000000999')).allowed).toBe(false);
    expect((await canAccessCandidate('not-a-uuid', c.applicationId)).allowed).toBe(false);
    await request(app).patch(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer)).send({ permissions: { viewCandidates: false } });
    expect(await canAccessCandidate(recruiter.id, c.applicationId)).toMatchObject({ allowed: false, reason: 'no_permission' });
    await request(app).patch(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer)).send({ permissions: { viewCandidates: true } });
    await request(app).delete(`${B}/drives/${drive.id}/recruiters/${recruiter.id}`).set(auth(officer)).send({});
    expect(await canAccessCandidate(recruiter.id, c.applicationId)).toMatchObject({ allowed: false, reason: 'not_assigned' });
    const shared = await getSharedCandidate(c.applicationId);
    expect(shared?.fields.name).toBeTruthy();
    expect(Object.keys(shared!.fields)).not.toContain('github');
  });
});

describe('permission matrix', () => {
  it('returns the right status for every role on key endpoints', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const outsider = await makeRecruiter(app, officer, (await createOpenDrive(app, officer)).id);
    const { applicationId, student } = await makeCandidate(app, officer, drive.id);
    const round = await makeRound(app, officer, drive.id);
    const d = `${B}/pipeline/drives/${drive.id}`;
    type Row = [string, string, any, number[]]; // method, url, body, expected [anon, student, assignedRecruiter, otherRecruiter, officer]
    const rows: Row[] = [
      ['get', `${d}/candidates`, undefined, [401, 403, 200, 404, 200]],
      ['get', `${d}/candidates/${applicationId}`, undefined, [401, 403, 200, 404, 200]],
      ['get', `${d}/rounds`, undefined, [401, 403, 200, 404, 200]],
      ['post', `${d}/rounds`, { name: 'HR round', kind: 'hr' }, [401, 403, 403, 404, 201]],
      ['patch', `${d}/rounds/${round.id}`, { name: 'Renamed' }, [401, 403, 403, 404, 200]],
      ['put', `${d}/rubric`, { items: [{ label: 'Skill one' }] }, [401, 403, 403, 404, 200]],
      ['put', `${d}/settings`, { blindScorecards: false }, [401, 403, 403, 404, 200]],
      ['get', `${d}/funnel`, undefined, [401, 403, 200, 404, 200]],
      ['post', `${B}/drives/${drive.id}/recruiters`, { email: 'matrix.hr@example.com' }, [401, 403, 403, 403, 201]],
      ['get', `${B}/drives/${drive.id}/recruiters`, undefined, [401, 403, 403, 403, 200]],
      ['get', `${B}/recruiter/drives`, undefined, [401, 403, 200, 200, 200]],
      ['post', `${B}/pipeline/attendance/scan`, { token: 'x'.repeat(30) }, [401, 404, 403, 403, 403]],
      ['get', `${B}/pipeline/applications/${applicationId}/rounds`, undefined, [401, 200, 403, 403, 403]],
      ['get', `${B}/pipeline/applications/${applicationId}/offer`, undefined, [401, 200, 403, 403, 403]],
    ];
    const who: any[] = [null, student, recruiter, outsider, officer];
    for (const [m, url, body, exp] of rows) {
      for (let i = 0; i < who.length; i++) {
        let req = (request(app) as any)[m](url);
        if (who[i]) req = req.set(auth(who[i]));
        const res = await (body !== undefined ? req.send(body) : req);
        expect(res.status, `${m} ${url} as #${i}: ${JSON.stringify(res.body)}`).toBe(exp[i]);
      }
    }
  });
});

describe('candidate working actions', () => {
  it('shortlist/reject with reason, bulk, notes visibility, resume view and audit rows', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const second = await makeRecruiter(app, officer, drive.id);
    const c = await makeCandidate(app, officer, drive.id);
    const c2 = await makeCandidate(app, officer, drive.id);
    const url = `${B}/pipeline/drives/${drive.id}/candidates/${c.applicationId}`;
    const noReason = await request(app).post(`${url}/decision`).set(auth(recruiter)).send({ decision: 'rejected' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.fields.reason).toBeTruthy();
    expect((await request(app).post(`${url}/decision`).set(auth(recruiter)).send({ decision: 'rejected', reason: 'Not a fit for the role' })).body.decision).toBe('rejected');
    expect((await request(app).post(`${url}/decision`).set(auth(recruiter)).send({ decision: 'shortlisted' })).body.decision).toBe('shortlisted');
    const bulk = await request(app).post(`${B}/pipeline/drives/${drive.id}/candidates/bulk-decision`).set(auth(recruiter)).send({ applicationIds: [c.applicationId, c2.applicationId, '00000000-0000-4000-8000-000000000999'], decision: 'on_hold' });
    expect(bulk.body.updated).toBe(2);
    expect(bulk.body.failed).toHaveLength(1);
    const list = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates?decision=on_hold`).set(auth(recruiter));
    expect(list.body.total).toBe(2);
    expect((await notifications(officer.id, 'pipeline')).length).toBeGreaterThan(0);
    // application status is untouched by recruiter decisions
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('screening');

    const priv = await request(app).post(`${url}/notes`).set(auth(recruiter)).send({ body: 'private thought', visibility: 'private' });
    const team = await request(app).post(`${url}/notes`).set(auth(recruiter)).send({ body: 'team thought', visibility: 'team' });
    expect(priv.status).toBe(201);
    const seen2 = (await request(app).get(`${url}/notes`).set(auth(second))).body.items.map((n: any) => n.body);
    expect(seen2).toEqual(['team thought']);
    expect((await request(app).get(`${url}/notes`).set(auth(recruiter))).body.items).toHaveLength(2);
    expect((await request(app).delete(`${url}/notes/${team.body.note.id}`).set(auth(second))).status).toBe(403);
    expect((await request(app).delete(`${url}/notes/${priv.body.note.id}`).set(auth(second))).status).toBe(404);
    expect((await request(app).delete(`${url}/notes/${team.body.note.id}`).set(auth(officer))).status).toBe(200);

    const resume = await request(app).get(`${url}/resume`).set(auth(recruiter));
    expect(resume.body).toMatchObject({ url: 'https://example.com/cv.pdf', signed: false });
    const detail = await request(app).get(url).set(auth(recruiter));
    expect(detail.body.candidate.resume.url).toBe('https://example.com/cv.pdf');

    expect((await audits('candidate.decision')).length).toBe(1 + 1 + 2 + 0);
    expect((await audits('candidate.view')).length).toBe(1);
    expect((await audits('candidate.resume_view')).length).toBe(1);
    expect((await audits('candidate.note')).length).toBe(2);
    const filter = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates?q=${encodeURIComponent('Test User')}&minCgpa=8&sort=name&department=${encodeURIComponent('Computer Science')}`).set(auth(recruiter));
    expect(filter.body.total).toBe(2);
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates?minCgpa=9.5`).set(auth(recruiter))).body.total).toBe(0);
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates?limit=1`).set(auth(recruiter))).body.nextCursor).toBeTruthy();
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates?limit=99`).set(auth(recruiter))).status).toBe(400);
  });

  it('outcome proposals need officer approval before the student sees any change', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const c = await makeCandidate(app, officer, drive.id);
    const url = `${B}/pipeline/drives/${drive.id}/candidates/${c.applicationId}/outcomes`;
    expect((await request(app).post(url).set(auth(recruiter)).send({ kind: 'reject' })).status).toBe(400);
    const baseline = (await notifications(c.student.id, 'application_status')).length; // the officer's screening move
    const p = await request(app).post(url).set(auth(recruiter)).send({ kind: 'select', reason: 'Excellent interview' });
    expect(p.status).toBe(201);
    expect((await request(app).post(url).set(auth(recruiter)).send({ kind: 'select' })).body.error.code).toBe('OUTCOME_PENDING');
    expect((await pool.query('SELECT status FROM applications WHERE id=$1', [c.applicationId])).rows[0].status).toBe('screening');
    expect((await notifications(c.student.id, 'application_status')).length).toBe(baseline);
    expect((await request(app).post(`${B}/pipeline/outcomes/${p.body.outcome.id}/decide`).set(auth(recruiter)).send({ decision: 'approve' })).status).toBe(403);
    const pending = await request(app).get(`${B}/pipeline/drives/${drive.id}/outcomes?status=pending`).set(auth(officer));
    expect(pending.body.items).toHaveLength(1);
    const ok = await request(app).post(`${B}/pipeline/outcomes/${p.body.outcome.id}/decide`).set(auth(officer)).send({ decision: 'approve', note: 'Confirmed' });
    expect(ok.body.application.status).toBe('selected');
    expect((await request(app).post(`${B}/pipeline/outcomes/${p.body.outcome.id}/decide`).set(auth(officer)).send({ decision: 'approve' })).body.replayed).toBe(true);
    expect((await request(app).post(`${B}/pipeline/outcomes/${p.body.outcome.id}/decide`).set(auth(officer)).send({ decision: 'decline' })).body.error.code).toBe('OUTCOME_DECIDED');
    expect((await notifications(c.student.id, 'application_status')).length).toBe(baseline + 1);
    const ev = (await request(app).get(`${B}/applications/${c.applicationId}`).set(auth(c.student))).body.application.events;
    expect(ev[ev.length - 1]).toMatchObject({ status: 'selected', actorRole: 'officer' });
    // a selected application cannot be "selected" again
    const again = await request(app).post(url).set(auth(recruiter)).send({ kind: 'select' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await audits('outcome.decide')).length).toBe(1);
  });

  it('drive message thread is logged, notifies the other side and replays by clientId', async () => {
    const { officer, drive, recruiter } = await setup(app);
    const outsider = await makeRecruiter(app, officer, (await createOpenDrive(app, officer)).id);
    const clientId = '11111111-1111-4111-8111-111111111111';
    const post = (who: any, body: any) => request(app).post(`${B}/pipeline/drives/${drive.id}/messages`).set(auth(who)).send(body);
    const m1 = await post(recruiter, { body: 'Can we start at 10am?', clientId });
    expect(m1.status).toBe(201);
    expect((await post(recruiter, { body: 'Can we start at 10am?', clientId })).status).toBe(200);
    expect((await post(officer, { body: 'Yes, 10am works.' })).status).toBe(201);
    expect((await post(recruiter, { body: '   ' })).status).toBe(400);
    expect((await post(outsider, { body: 'hello' })).status).toBe(404);
    const list = await request(app).get(`${B}/pipeline/drives/${drive.id}/messages`).set(auth(officer));
    expect(list.body.items.map((x: any) => x.body)).toEqual(['Yes, 10am works.', 'Can we start at 10am?']);
    expect((await notifications(officer.id, 'pipeline_message')).length).toBe(1);
    expect((await notifications(recruiter.id, 'pipeline_message')).length).toBe(1);
    const logged = await audits('message.post');
    expect(logged.length).toBe(2);
    expect(JSON.stringify(logged)).not.toContain('10am');
  });
});

void addToRound; void notifications;
