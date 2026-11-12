import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTo, auth, createOpenDrive, makeEligibleStudent, pool, register, resetDb, type Session } from './helpers';
import { B, makeIntegApp, MockMailer, MockStorage } from './integ-helpers';
import { addToRound, makeCandidate, makeRecruiter, makeRound, setRubric } from './pipelineHelpers';
import { getFileStore } from '../src/ai/resumeText';
import { getPolicy, fromOpsPolicy, evaluateOfferAgainstPolicy } from '../src/pipeline/policy';
import { collectFeatureFlags } from '../src/features';

/** Storage whose objects can be read back (the AI module reads uploaded resumes through it). */
class ReadableStorage extends MockStorage {
  blobs = new Map<string, Buffer>();
  async get(key: string) {
    const b = this.blobs.get(key);
    return b ? { bytes: b, contentType: 'application/pdf', etag: 'etag-1' } : null;
  }
}

const storage = new ReadableStorage();
const mailer = new MockMailer();
const app = makeIntegApp({ REQUIRE_VERIFIED_EMAIL: 'false' }, { storage, mailer });
let officer: Session;

/** Earlier tests leave fire-and-forget work (push, mail, reminder sync) in flight; give it a moment and retry a lost deadlock race. */
async function cleanSlate() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise((r) => setTimeout(r, 100));
      await resetDb();
      await pool.query('TRUNCATE ai_question_sets, ai_question_drafts, cohorts, tenant_settings CASCADE');
      return;
    } catch (e) {
      if ((e as any)?.code !== '40P01' || attempt >= 4) throw e;
    }
  }
}
beforeAll(cleanSlate);
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await cleanSlate();
  mailer.sent.length = 0;
  storage.blobs.clear();
  officer = await register(app, 'officer');
});

async function fileResume(studentId: string, applicationId: string) {
  const tenantId = (await pool.query('SELECT tenant_id FROM users WHERE id=$1', [studentId])).rows[0].tenant_id as string;
  const id = randomUUID();
  const key = `${tenantId}/${studentId}/resume/${id}.pdf`;
  await pool.query(`INSERT INTO files (id, tenant_id, owner_id, purpose, key, file_name, content_type, size, status) VALUES ($1,$2,$3,'resume',$4,'cv.pdf','application/pdf',20,'ready')`, [id, tenantId, studentId, key]);
  await pool.query(`UPDATE applications SET resume_snapshot = $2 WHERE id=$1`, [applicationId, JSON.stringify({ kind: 'file', fileId: id, label: 'Main' })]);
  storage.blobs.set(key, Buffer.from('%PDF-1.4 resume bytes'));
  return { id, key, tenantId };
}

describe('(a) AI file store and (e) recruiter resume access / signer', () => {
  it('AI reads stored resumes through R2; recruiters read only candidates they may see; pipeline signs file resumes', async () => {
    const drive = await createOpenDrive(app, officer);
    const recruiter = await makeRecruiter(app, officer, drive.id);
    const otherDrive = await createOpenDrive(app, officer);
    const stranger = await makeRecruiter(app, officer, otherDrive.id);
    const cand = await makeCandidate(app, officer, drive.id);
    const f = await fileResume(cand.student.id, cand.applicationId);

    const store = getFileStore();
    expect(store).not.toBeNull();
    const got = await store!.get(f.id, { userId: cand.student.id, tenantId: f.tenantId });
    expect(got!.bytes.toString()).toContain('%PDF-1.4');
    expect(got!.ownerId).toBe(cand.student.id);
    expect(await store!.get(f.id, { userId: cand.student.id, tenantId: randomUUID() })).toBeNull();
    expect(await store!.get(randomUUID(), { userId: cand.student.id, tenantId: f.tenantId })).toBeNull();

    const own = await request(app).get(`${B}/files/${f.id}/url`).set(auth(cand.student));
    expect(own.status).toBe(200);
    const rec = await request(app).get(`${B}/files/${f.id}/url`).set(auth(recruiter));
    expect(rec.status).toBe(200);
    expect(rec.body.url).toContain(f.key);
    expect((await request(app).get(`${B}/files/${f.id}/url`).set(auth(stranger))).status).toBe(404);

    const view = await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates/${cand.applicationId}/resume`).set(auth(recruiter));
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ signed: true });
    expect(view.body.url).toContain(f.key);
  });
});

describe('(b) cohort audiences, (c) AI MCQ import', () => {
  it('assessment cohort audience resolves through the ops cohort engine', async () => {
    const s1 = await makeEligibleStudent(app);
    const s2 = await makeEligibleStudent(app);
    await makeEligibleStudent(app);
    const c = await request(app).post(`${B}/cohorts`).set(auth(officer)).send({ name: 'Pick', kind: 'fixed', studentIds: [s1.id, s2.id] });
    expect(c.status).toBe(201);
    const q = await request(app).post(`${B}/assessment-questions`).set(auth(officer)).send({
      type: 'mcq_single', title: 'Q1', body: 'Pick', options: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], answer: { correct: 'b' }, marks: 1,
    });
    expect(q.status).toBe(201);
    const a = await request(app).post(`${B}/assessments`).set(auth(officer)).send({
      title: 'Cohort test', durationMinutes: 30, audience: { type: 'cohort', cohortId: c.body.cohort.id },
      opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      sections: [{ title: 'S', questions: [{ questionId: q.body.question.id }] }],
    });
    expect(a.status).toBe(201);
    const aud = await request(app).get(`${B}/assessments/${a.body.assessment.id}/audience`).set(auth(officer));
    expect(aud.body.count).toBe(2);
    const pub = await request(app).post(`${B}/assessments/${a.body.assessment.id}/publish`).set(auth(officer));
    expect(pub.status).toBe(200);
    expect(pub.body.audienceCount).toBe(2);
    // an id that is not a cohort never crashes; it just cannot be resolved
    const bad = await request(app).post(`${B}/assessments`).set(auth(officer)).send({ title: 'Bad', durationMinutes: 30, audience: { type: 'cohort', cohortId: 'nope' } });
    if (bad.status === 201) expect((await request(app).get(`${B}/assessments/${bad.body.assessment.id}/audience`).set(auth(officer))).status).toBe(200);
  });

  it('POST /ai/mcq/import lands drafts in the assessments question bank', async () => {
    const t = officer;
    const tenantId = (await pool.query('SELECT tenant_id FROM users WHERE id=$1', [t.id])).rows[0].tenant_id;
    const d = (await pool.query(
      `INSERT INTO ai_question_drafts (tenant_id, created_by, topic, difficulty, tags, stem, options, correct_index, explanation, status)
       VALUES ($1,$2,'Arithmetic','easy','["aptitude"]','What is 3+3?','["5","6","7","8"]',1,'Because 3+3=6','draft') RETURNING id`, [tenantId, t.id])).rows[0].id;
    const imp = await request(app).post(`${B}/ai/mcq/import`).set(auth(officer)).send({ ids: [d, randomUUID()] });
    expect(imp.status).toBe(200);
    expect(imp.body.imported).toHaveLength(1);
    expect(imp.body.skipped).toHaveLength(1);
    const qid = imp.body.imported[0].questionId;
    const row = (await pool.query('SELECT * FROM aq_questions WHERE id=$1', [qid])).rows[0];
    expect(row).toMatchObject({ type: 'mcq_single', topic: 'Arithmetic', difficulty: 'easy', body: 'What is 3+3?' });
    expect(row.answer).toEqual({ correct: 'b' });
    expect(row.options.map((o: any) => o.text)).toEqual(['5', '6', '7', '8']);
    const viaApi = await request(app).get(`${B}/assessment-questions/${qid}`).set(auth(officer));
    expect(viaApi.status).toBe(200);
    // importing twice is refused by the AI module (already imported)
    expect((await request(app).post(`${B}/ai/mcq/import`).set(auth(officer)).send({ ids: [d] })).body.skipped[0].reason).toMatch(/imported/);
  });
});

describe('(d) question sets on scorecards', () => {
  it('an approved AI question set for this candidate can be attached to a scorecard; others are refused', async () => {
    const drive = await createOpenDrive(app, officer);
    const recruiter = await makeRecruiter(app, officer, drive.id);
    const round = await makeRound(app, officer, drive.id);
    await setRubric(app, officer, drive.id, round.id);
    const cand = await makeCandidate(app, officer, drive.id);
    const other = await makeCandidate(app, officer, drive.id);
    await addToRound(app, officer, drive.id, round.id, [cand.applicationId, other.applicationId]);
    const tenantId = (await pool.query('SELECT tenant_id FROM users WHERE id=$1', [officer.id])).rows[0].tenant_id;
    const mk = async (appId: string, status: string) => (await pool.query(
      `INSERT INTO ai_question_sets (tenant_id, application_id, drive_id, created_by, round_type, difficulty, questions, status) VALUES ($1,$2,$3,$4,'technical','medium','[]',$5) RETURNING id`,
      [tenantId, appId, drive.id, recruiter.id, status])).rows[0].id as string;
    const approved = await mk(cand.applicationId, 'approved');
    const draft = await mk(cand.applicationId, 'draft');
    const foreign = await mk(other.applicationId, 'approved');
    const put = (appId: string, questionSetId: string) => request(app).put(`${B}/pipeline/drives/${drive.id}/candidates/${appId}/scorecards/${round.id}`).set(auth(recruiter))
      .send({ ratings: [{ itemId: 'problem', rating: 4 }, { itemId: 'comm', rating: 5 }], recommendation: 'hire', questionSetId });
    expect((await put(cand.applicationId, draft)).status).toBe(422);
    expect((await put(cand.applicationId, foreign)).status).toBe(422);
    const ok = await put(cand.applicationId, approved);
    expect(ok.status).toBe(201);
    expect((await pool.query('SELECT scorecard_ref FROM ai_question_sets WHERE id=$1', [approved])).rows[0].scorecard_ref).toBe(ok.body.scorecard.id);
    expect((await pool.query('SELECT 1 FROM scorecards WHERE application_id=$1', [other.applicationId])).rowCount).toBe(0);
  });
});

describe('(f) invite mailer', () => {
  it('recruiter invites are emailed through the mail module', async () => {
    const drive = await createOpenDrive(app, officer);
    const inv = await request(app).post(`${B}/drives/${drive.id}/recruiters`).set(auth(officer)).send({ email: 'hiring@acme.example', name: 'Hira' });
    expect(inv.status).toBe(201);
    expect(inv.body.emailSent).toBe(true);
    const mail = mailer.to('hiring@acme.example')[0];
    expect(mail.text).toContain(inv.body.inviteToken);
  });
});

describe('(g) offers follow the active ops policy', () => {
  it('translates the ops policy shape and falls back to defaults when none is active', async () => {
    const tenantId = (await pool.query('SELECT tenant_id FROM users WHERE id=$1', [officer.id])).rows[0].tenant_id;
    expect((await getPolicy(tenantId, pool)).offers.oneOffer).toBe(true); // nothing stored: pipeline defaults
    const ops = { schemaVersion: 1, oneOffer: { enabled: false }, tiers: { enabled: false, dreamMinLpa: 10, superDreamMinLpa: 20 }, upgrade: { enabled: false, multiplier: 1.5 } };
    await pool.query(`INSERT INTO tenant_settings (tenant_id, policy) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET policy=EXCLUDED.policy`, [tenantId, JSON.stringify(ops)]);
    expect((await getPolicy(tenantId, pool)).offers.oneOffer).toBe(false);
    const held = [{ status: 'accepted', totalLpa: 6 }];
    const p1 = fromOpsPolicy({ ...ops, oneOffer: { enabled: true } }).offers;
    expect(evaluateOfferAgainstPolicy({ policy: p1, offer: { totalLpa: 12 }, existing: held }).result).toBe('blocked');
    const p2 = fromOpsPolicy({ ...ops, oneOffer: { enabled: true }, upgrade: { enabled: true, multiplier: 1.5 } }).offers;
    expect(evaluateOfferAgainstPolicy({ policy: p2, offer: { totalLpa: 9 }, existing: held }).result).toBe('allowed');
    expect(evaluateOfferAgainstPolicy({ policy: p2, offer: { totalLpa: 8 }, existing: held }).result).toBe('blocked');
    const p3 = fromOpsPolicy({ ...ops, oneOffer: { enabled: true }, tiers: { enabled: true, dreamMinLpa: 10, superDreamMinLpa: 20 } }).offers;
    expect(evaluateOfferAgainstPolicy({ policy: p3, offer: { totalLpa: 11 }, existing: held }).result).toBe('allowed');
    expect(evaluateOfferAgainstPolicy({ policy: p3, offer: { totalLpa: 8 }, existing: held }).result).toBe('blocked');
  });
});

describe('(h) GET /config flags', () => {
  it('lists every module flag', async () => {
    const res = await request(app).get(`${B}/config`);
    expect(res.status).toBe(200);
    for (const k of ['ai', 'recruiter', 'assessments', 'codeExecution', 'googleLogin', 'emailVerification', 'fileUploads', 'turnstile', 'requireVerifiedEmail', 'opsAnalytics', 'opsPolicy', 'opsCohorts', 'opsCalendar']) {
      expect(typeof res.body.features[k], k).toBe('boolean');
    }
    expect(res.body.features.fileUploads).toBe(true);
    expect(res.body.features.assessments).toBe(true);
    expect(res.body.features.recruiter).toBe(true);
    expect(Object.keys(collectFeatureFlags()).length).toBeGreaterThan(10);
  });
});

describe('mount order: every role reaches every module and gets the right status', () => {
  it('student / officer / recruiter against one endpoint of each module', async () => {
    const drive = await createOpenDrive(app, officer);
    const recruiter = await makeRecruiter(app, officer, drive.id);
    const student = await makeEligibleStudent(app);
    const none = randomUUID();
    const d = `/pipeline/drives/${drive.id}`;
    // [method, path, student, officer, recruiter]; 'x' = a module-level 404 (code other than the router's catch-all NOT_FOUND)
    type Exp = number | 'x';
    const rows: [string, string, Exp, Exp, Exp][] = [
      ['get', '/me', 200, 200, 200],                              // core (auth)
      ['get', '/drives', 200, 200, 403],                          // core drives (recruiters use the pipeline)
      ['get', '/students', 403, 200, 403],                        // core officer router
      ['get', '/announcements', 200, 200, 200],                   // core announcements
      ['get', '/config', 200, 200, 200],                          // public config
      ['get', '/ai/status', 200, 200, 200],                       // AI
      ['get', `/files/${none}/url`, 'x', 'x', 'x'],               // files (per-route auth)
      ['get', `/applications/${none}/resume-url`, 403, 'x', 403], // files: officer-only route
      ['get', '/policy/active', 403, 200, 403],                   // ops policy
      ['get', '/cohorts', 403, 200, 403],                         // ops cohorts
      ['get', '/analytics/dashboard', 403, 200, 403],              // ops analytics
      ['get', '/calendar?from=2026-01-01&to=2026-02-01', 200, 200, 200], // ops calendar
      ['get', '/assessments', 403, 200, 403],                     // assessments (officer)
      ['get', '/my/assessments', 200, 403, 403],                  // assessments (student), mounted under ops' /my prefix
      ['get', '/practice/assessments', 200, 403, 403],                        // assessments practice
      ['get', `${d}/candidates`, 403, 200, 200],                  // pipeline (staff)
      ['get', `${d}/rounds`, 403, 200, 200],
      ['get', `/pipeline/applications/${none}/offer`, 'x', 403, 403], // pipeline student route
    ];
    const who: [string, Session][] = [['student', student], ['officer', officer], ['recruiter', recruiter]];
    const bad: string[] = [];
    for (const [method, path, ...exp] of rows) {
      for (const [i, [name, sess]] of who.entries()) {
        const r = await (request(app) as any)[method](`${B}${path}`).set(auth(sess));
        const want = exp[i];
        const code = r.body?.error?.code;
        const okStatus = want === 'x' ? r.status === 404 && code !== 'NOT_FOUND' : r.status === want;
        const okCode = want === 403 ? code === 'FORBIDDEN' : true;
        if (!okStatus || !okCode) bad.push(`${name} ${method.toUpperCase()} ${path}: got ${r.status} ${code ?? ''}, want ${want}`);
      }
    }
    expect(bad).toEqual([]);
    // public routes need no token
    expect((await request(app).get(`${B}/health`)).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get(`${B}/legal/versions`)).status).toBe(200);
    expect((await request(app).post(`${B}/waitlist`).send({})).status).toBe(200) // honeypot path: public, never 401;
    expect((await request(app).post(`${B}/auth/recruiter-invite/lookup`).send({ inviteToken: 'x'.repeat(30) })).status).toBe(404);
    expect((await request(app).get(`${B}/calendar.ics?token=abc`)).status).toBe(404);
    expect((await request(app).get(`${B}/assessments`)).status).toBe(401);
    expect((await request(app).get(`${B}/pipeline/drives/${drive.id}/candidates`)).status).toBe(401);
  });
});
