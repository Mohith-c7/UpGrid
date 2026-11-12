import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyTo, auth, createOpenDrive, fakePush, makeApp, makeEligibleStudent, makeOtherTenant, pool, register, resetDb, sent, type Session } from './helpers';
import { MockJudge } from './assessments-judge-mock';
import { setJudge } from '../src/assessments/judge';
import { runJudgeQueue } from '../src/assessments/code';
import { runAutoSubmit, runDueAssessmentReminders } from '../src/assessments/workers';
import { collectFeatureFlags } from '../src/features';

const B = '/api/v1';
const app = makeApp();
const judge = new MockJudge();
let officer: Session;
let s1: Session; let s2: Session; let s3: Session;

beforeAll(() => setJudge(judge));
afterAll(() => setJudge(null));
beforeEach(async () => {
  await resetDb();
  judge.configured = true; judge.down = false; judge.calls = 0; judge.batches = [];
  officer = await register(app, 'officer');
  s1 = await register(app, 'student', { name: 'Asha One' });
  s2 = await register(app, 'student', { name: 'Bala Two' });
  s3 = await register(app, 'student', { name: 'Chitra Three' });
});

const get = (s: Session, p: string) => request(app).get(B + p).set(auth(s));
const post = (s: Session, p: string, body: unknown = {}) => request(app).post(B + p).set(auth(s)).send(body as any);
const put = (s: Session, p: string, body: unknown = {}) => request(app).put(B + p).set(auth(s)).send(body as any);

const mcq = (over: Record<string, unknown> = {}) => ({
  type: 'mcq_single', title: `Q ${randomUUID().slice(0, 6)}`, body: 'Pick one', topic: 'aptitude', tags: ['Math'], difficulty: 'easy', marks: 2, negativeMarks: 1,
  options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }, { id: 'c', text: '5' }], answer: { correct: 'b' }, ...over,
});
const multi = (over: Record<string, unknown> = {}) => mcq({
  type: 'mcq_multi', marks: 4, negativeMarks: 2, options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }, { id: 'd', text: '5' }], answer: { correct: ['a', 'b', 'd'] }, ...over,
});
const numeric = (over: Record<string, unknown> = {}) => ({ type: 'numeric', title: 'pi', body: 'pi to 2dp', marks: 3, negativeMarks: 1, answer: { value: 3.14, tolerance: 0.01 }, ...over });
const shortText = (over: Record<string, unknown> = {}) => ({ type: 'short_text', title: 'capital', body: 'Capital of India', marks: 2, negativeMarks: 0, answer: { accepted: ['new delhi', 'delhi'], mode: 'exact' }, ...over });
const coding = (over: Record<string, unknown> = {}) => ({
  type: 'coding', title: 'Sum of two numbers', body: 'Read two ints, print the sum.', topic: 'basics', tags: ['arrays'], difficulty: 'easy', marks: 7, negativeMarks: 0,
  coding: {
    constraints: '|a|,|b| <= 1e9', languages: ['python3', 'cpp'], timeLimitMs: 2000, memoryLimitMb: 256, starterCode: { python3: 'a, b = map(int, input().split())\n' },
    testCases: [
      { kind: 'sample', input: '1 2', expectedOutput: '3', weight: 1, explanation: '1+2' },
      { kind: 'hidden', input: '10 20', expectedOutput: '30', weight: 2 },
      { kind: 'hidden', input: '100 200', expectedOutput: '300', weight: 3 },
      { kind: 'hidden', input: '5 5', expectedOutput: '10', weight: 1 },
    ],
  }, ...over,
});

async function bank(body: Record<string, unknown>): Promise<string> {
  const r = await post(officer, '/assessment-questions', body);
  if (r.status !== 201) throw new Error('bank create failed ' + JSON.stringify(r.body));
  return r.body.question.id;
}

interface Opts { students?: Session[]; settings?: Record<string, unknown>; duration?: number; sections?: any[]; extra?: Record<string, unknown> }
/** Creates + publishes an assessment, then moves the window so it is open now. Returns ids. */
async function liveAssessment(qs: { id: string; marks?: number; negativeMarks?: number }[], o: Opts = {}) {
  const students = o.students ?? [s1, s2, s3];
  const body = {
    title: 'Campus Drive Test', instructions: 'Read carefully', opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    durationMinutes: o.duration ?? 60, audience: { type: 'students', studentIds: students.map((s) => s.id) },
    settings: { negativeMarking: true, resultVisibility: 'immediate', allowReview: true, ...(o.settings || {}) },
    sections: o.sections ?? [{ title: 'Section A', questions: qs.map((q) => ({ questionId: q.id, marks: q.marks, negativeMarks: q.negativeMarks })) }], ...(o.extra || {}),
  };
  const c = await post(officer, '/assessments', body);
  if (c.status !== 201) throw new Error('create failed ' + JSON.stringify(c.body));
  const id = c.body.assessment.id as string;
  const p = await post(officer, `/assessments/${id}/publish`);
  if (p.status !== 200) throw new Error('publish failed ' + JSON.stringify(p.body));
  await openNow(id);
  const detail = (await get(officer, `/assessments/${id}`)).body.assessment;
  const aq = (i: number, sec = 0) => detail.sections[sec].questions[i].id as string;
  return { id, detail, aq };
}
const openNow = (id: string) => pool.query(`UPDATE assessments SET opens_at = now() - interval '5 minutes', closes_at = now() + interval '3 hours' WHERE id=$1`, [id]);
const start = (s: Session, id: string) => post(s, `/my/assessments/${id}/start`);
const save = (s: Session, attemptId: string, answers: any[]) => put(s, `/attempts/${attemptId}/answers`, { answers });
const ans = (questionId: string, answer: unknown, clientTs = Date.now(), extra: Record<string, unknown> = {}) => ({ questionId, answer, clientTs, ...extra });

async function takeTest(s: Session, id: string, answers: [string, unknown][]) {
  const st = await start(s, id);
  expect(st.status).toBeLessThan(300);
  const attemptId = st.body.attempt.id as string;
  if (answers.length) expect((await save(s, attemptId, answers.map(([q, a]) => ans(q, a)))).status).toBe(200);
  const sub = await post(s, `/attempts/${attemptId}/submit`);
  expect(sub.status).toBe(200);
  return attemptId;
}

describe('question bank', () => {
  it('CRUD, search, duplicate, archive, delete rules', async () => {
    const id = await bank(mcq({ title: 'Capital quiz', tags: ['GK', 'geo'], topic: 'GK' }));
    await bank(coding());
    const list = await get(officer, '/assessment-questions?tag=gk');
    expect(list.body.items.map((x: any) => x.id)).toEqual([id]);
    expect(list.body.items[0].answer).toBeUndefined();
    expect((await get(officer, '/assessment-questions?q=capital')).body.items).toHaveLength(1);
    expect((await get(officer, '/assessment-questions?type=coding')).body.items[0].coding.testCaseCounts).toEqual({ sample: 1, hidden: 3 });
    const full = await get(officer, `/assessment-questions/${id}`);
    expect(full.body.question.answer).toEqual({ correct: 'b' });
    const upd = await put(officer, `/assessment-questions/${id}`, mcq({ title: 'Capital quiz v2' }));
    expect(upd.body.question.title).toBe('Capital quiz v2');
    const dup = await post(officer, `/assessment-questions/${id}/duplicate`);
    expect(dup.status).toBe(201); expect(dup.body.question.title).toBe('Capital quiz v2 (copy)');
    expect((await post(officer, `/assessment-questions/${dup.body.question.id}/archive`)).body.question.status).toBe('archived');
    expect((await get(officer, '/assessment-questions')).body.items.every((x: any) => x.status === 'active')).toBe(true);
    expect((await get(officer, '/assessment-questions?status=archived')).body.items).toHaveLength(1);
    expect((await request(app).delete(`${B}/assessment-questions/${dup.body.question.id}`).set(auth(officer))).status).toBe(204);
    await liveAssessment([{ id }], { students: [s1] });
    const del = await request(app).delete(`${B}/assessment-questions/${id}`).set(auth(officer));
    expect(del.status).toBe(409); expect(del.body.error.code).toBe('QUESTION_IN_USE');
  });

  it('validates question shapes with field errors', async () => {
    const bad1 = await post(officer, '/assessment-questions', mcq({ answer: { correct: 'z' } }));
    expect(bad1.status).toBe(400); expect(bad1.body.error.fields['answer.correct']).toBeTruthy();
    const bad2 = await post(officer, '/assessment-questions', mcq({ options: [{ id: 'a', text: 'x' }] }));
    expect(bad2.body.error.fields.options).toBeTruthy();
    const bad3 = await post(officer, '/assessment-questions', mcq({ negativeMarks: 5 }));
    expect(bad3.body.error.fields.negativeMarks).toBeTruthy();
    const bad4 = await post(officer, '/assessment-questions', coding({ coding: { languages: ['ruby'], testCases: [{ kind: 'sample', input: '', expectedOutput: '', weight: 1 }] } }));
    expect(bad4.status).toBe(400);
    const bad5 = await post(officer, '/assessment-questions', shortText({ answer: { accepted: ['(a+)+$'], mode: 'regex' } }));
    expect(bad5.body.error.fields['answer.accepted.0']).toBeTruthy();
    const bad6 = await post(officer, '/assessment-questions', { ...mcq(), practice: true });
    expect(bad6.status).toBe(400);
    const bad7 = await post(officer, '/assessment-questions', coding({ practice: true, coding: { ...coding().coding, testCases: [{ kind: 'sample', input: '1', expectedOutput: '1', weight: 1 }] } }));
    expect(bad7.status).toBe(422); expect(bad7.body.error.code).toBe('NOT_PRACTICE_READY');
  });

  it('bulk import (json + csv) reports row errors, supports dry run', async () => {
    const rows = [
      { title: 'Q1', optionA: '1', optionB: '2', correct: 'B', tags: 'x;y', marks: 2 },
      { title: 'Q2', optionA: '1', correct: 'A' },
      { type: 'mcq_multi', title: 'Q3', options: ['a', 'b', 'c'], correct: 'A;C' },
    ];
    const dry = await post(officer, '/assessment-questions/import', { format: 'json', rows, dryRun: true });
    expect(dry.body).toMatchObject({ total: 3, imported: 0, valid: 2, dryRun: true });
    expect(dry.body.errors).toEqual([{ row: 2, fields: expect.objectContaining({ options: expect.any(String) }) }]);
    expect((await get(officer, '/assessment-questions')).body.items).toHaveLength(0);
    const real = await post(officer, '/assessment-questions/import', { format: 'json', rows });
    expect(real.body.imported).toBe(2);
    const csv = 'type,title,optionA,optionB,optionC,correct,difficulty\nmcq_single,"Hello, world",x,y,z,C,hard\nmcq_single,Bad,x,y,z,Q,easy\n';
    const c = await post(officer, '/assessment-questions/import', { format: 'csv', csv });
    expect(c.body).toMatchObject({ total: 2, imported: 1 });
    expect(c.body.errors[0].row).toBe(2);
    expect(c.body.errors[0].fields.correct).toBeTruthy();
    expect((await get(officer, '/assessment-questions?difficulty=hard')).body.items[0].title).toBe('Hello, world');
    expect((await post(officer, '/assessment-questions/import', { format: 'json', rows: [] })).status).toBe(400);
    expect((await post(officer, '/assessment-questions/import', { format: 'xml' })).status).toBe(400);
  });
});

describe('assessment authoring and publish', () => {
  it('runs completeness checks and then publishes once, notifying and scheduling reminders', async () => {
    const q1 = await bank(mcq());
    const empty = await post(officer, '/assessments', { title: 'Draft only' });
    expect(empty.status).toBe(201);
    const p0 = await post(officer, `/assessments/${empty.body.assessment.id}/publish`);
    expect(p0.status).toBe(422); expect(p0.body.error.code).toBe('NOT_PUBLISHABLE');
    expect(p0.body.error.fields).toMatchObject({ sections: expect.any(String), durationMinutes: expect.any(String), opensAt: expect.any(String), audience: expect.any(String) });

    // coding question without 2 hidden tests and window in the past
    const weak = await bank(coding({ coding: { ...coding().coding, testCases: [{ kind: 'sample', input: '1 2', expectedOutput: '3', weight: 1 }, { kind: 'hidden', input: '1 1', expectedOutput: '2', weight: 1 }] } }));
    const a = await post(officer, '/assessments', {
      title: 'Weak', durationMinutes: 30, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3600_000).toISOString(),
      audience: { type: 'students', studentIds: [s1.id] }, sections: [{ title: 'S', questions: [{ questionId: weak }, { questionId: q1 }] }], settings: { passCutoff: { type: 'marks', value: 999 } },
    });
    const p1 = await post(officer, `/assessments/${a.body.assessment.id}/publish`);
    expect(p1.status).toBe(422);
    expect(p1.body.error.fields['sections.0.questions.0']).toMatch(/2 hidden/);
    expect(p1.body.error.fields.opensAt).toMatch(/future/);
    expect(p1.body.error.fields['settings.passCutoff']).toBeTruthy();

    // coding cannot be published when the judge is not configured
    const ok = await bank(coding({ title: 'ok coding' }));
    const b = await post(officer, '/assessments', {
      title: 'Needs judge', durationMinutes: 30, opensAt: new Date(Date.now() + 2 * 3600_000).toISOString(), closesAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      audience: { type: 'students', studentIds: [s1.id] }, sections: [{ title: 'S', questions: [{ questionId: ok }] }],
    });
    judge.configured = false;
    const p2 = await post(officer, `/assessments/${b.body.assessment.id}/publish`);
    expect(p2.status).toBe(422); expect(p2.body.error.fields['sections.0.questions.0']).toMatch(/not configured/);
    expect(collectFeatureFlags()).toMatchObject({ assessments: true, codeExecution: false });
    judge.configured = true;
    expect(collectFeatureFlags().codeExecution).toBe(true);

    sent.length = 0;
    await pool.query(`INSERT INTO devices (tenant_id, user_id, expo_push_token, platform) SELECT tenant_id, id, 'ExponentPushToken[abc]', 'android' FROM users WHERE id=$1`, [s1.id]);
    const pub = await post(officer, `/assessments/${b.body.assessment.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ audienceCount: 1, notified: 1, replayed: false });
    expect(pub.body.assessment.status).toBe('published');
    const notes = await get(s1, '/notifications');
    expect(notes.body.items.some((n: any) => n.type === 'assessment_published')).toBe(true);
    expect(sent.flat().some((m) => m.title.includes('New test'))).toBe(true);
    const rem = await pool.query(`SELECT kind FROM assessment_reminders WHERE assessment_id=$1 ORDER BY kind`, [b.body.assessment.id]);
    expect(rem.rows.map((r) => r.kind)).toEqual(['t15', 't60']);
    // idempotent
    const again = await post(officer, `/assessments/${b.body.assessment.id}/publish`);
    expect(again.body).toMatchObject({ replayed: true, notified: 0 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE type='assessment_published' AND user_id=$1`, [s1.id])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM assessment_reminders WHERE assessment_id=$1`, [b.body.assessment.id])).rows[0].n).toBe(2);
    // locked after publish
    const edit = await put(officer, `/assessments/${b.body.assessment.id}`, { title: 'renamed' });
    expect(edit.status).toBe(409); expect(edit.body.error.code).toBe('ASSESSMENT_LOCKED');
    const ok2 = await put(officer, `/assessments/${b.body.assessment.id}`, { instructions: 'Updated notes' });
    expect(ok2.body.assessment.instructions).toBe('Updated notes');
    const shrink = await put(officer, `/assessments/${b.body.assessment.id}`, { closesAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    expect(shrink.status).toBe(409);
  });

  it('clone, archive, preview, audience resolution (drive applicants / eligible / cohort)', async () => {
    const q1 = await bank(mcq()); const q2 = await bank(multi());
    const drive = await createOpenDrive(app, officer);
    const eligible = await makeEligibleStudent(app);
    const applied = await makeEligibleStudent(app);
    expect((await applyTo(app, applied, drive.id)).status).toBe(201);
    const base = { title: 'T', durationMinutes: 30, driveId: drive.id, opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 5 * 3600_000).toISOString(), sections: [{ title: 'S', questions: [{ questionId: q1 }, { questionId: q2 }] }] };
    const mk = async (audience: any) => (await post(officer, '/assessments', { ...base, audience })).body.assessment.id as string;
    const applicants = await mk({ type: 'drive_applicants', statuses: ['submitted'] });
    expect((await get(officer, `/assessments/${applicants}/audience`)).body.count).toBe(1);
    const elig = await mk({ type: 'all_eligible' });
    const eligIds = (await get(officer, `/assessments/${elig}/audience`)).body;
    expect(eligIds.count).toBe(2);
    expect(eligIds.sample.map((x: any) => x.id).sort()).toEqual([eligible.id, applied.id].sort());
    const cohort = await mk({ type: 'cohort', cohortId: 'ops-1' });
    const { setCohortResolver } = await import('../src/assessments/service');
    setCohortResolver(null); // createApp binds the ops resolver; this test exercises the unlinked path first
    const res = await get(officer, `/assessments/${cohort}/audience`);
    expect(res.body.count).toBe(0); expect(res.body.unresolved).toMatch(/not available/);
    const pubC = await post(officer, `/assessments/${cohort}/publish`);
    expect(pubC.status).toBe(422);
    setCohortResolver(async () => [s1.id, s2.id]);
    expect((await get(officer, `/assessments/${cohort}/audience`)).body.count).toBe(2);
    expect((await post(officer, `/assessments/${cohort}/publish`)).status).toBe(200);
    setCohortResolver(null);

    const clone = await post(officer, `/assessments/${applicants}/clone`);
    expect(clone.status).toBe(201);
    expect(clone.body.assessment).toMatchObject({ title: 'T (copy)', status: 'draft', opensAt: null, questionCount: 2 });
    const prev = await get(officer, `/assessments/${applicants}/preview`);
    expect(prev.body.questions).toHaveLength(2);
    expect(JSON.stringify(prev.body)).not.toContain('"answer"');
    expect((await post(officer, `/assessments/${applicants}/archive`)).body.assessment.status).toBe('archived');
    expect((await get(officer, '/assessments?status=archived')).body.items).toHaveLength(1);
  });

  it('refreshes the audience for late applicants', async () => {
    const q1 = await bank(mcq());
    const drive = await createOpenDrive(app, officer);
    const a = await makeEligibleStudent(app); const b = await makeEligibleStudent(app);
    await applyTo(app, a, drive.id);
    const c = await post(officer, '/assessments', {
      title: 'T', durationMinutes: 30, driveId: drive.id, opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      audience: { type: 'drive_applicants', statuses: ['submitted'] }, sections: [{ title: 'S', questions: [{ questionId: q1 }] }],
    });
    const id = c.body.assessment.id;
    await post(officer, `/assessments/${id}/publish`);
    await applyTo(app, b, drive.id);
    const r = await post(officer, `/assessments/${id}/audience/refresh`);
    expect(r.body).toEqual({ added: 1, audienceCount: 2 });
    expect((await get(b, '/my/assessments')).body.items).toHaveLength(1);
    expect((await post(officer, `/assessments/${id}/audience/refresh`)).body.added).toBe(0);
  });
});

describe('attempt flow', () => {
  it('start is idempotent, resumes with the same randomised order and server-side remaining time', async () => {
    const qs = [];
    for (let i = 0; i < 8; i++) qs.push({ id: await bank(mcq({ title: `Q${i}` })) });
    const { id } = await liveAssessment(qs, { settings: { randomiseQuestions: true, randomiseOptions: true } });
    const first = await start(s1, id);
    expect(first.status).toBe(201); expect(first.body.resumed).toBe(false);
    const order1 = first.body.questions.map((q: any) => q.id);
    const opts1 = first.body.questions.map((q: any) => q.options.map((o: any) => o.id).join(''));
    expect(first.body.questions.map((q: any) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // answers never leak
    const raw = JSON.stringify(first.body);
    expect(raw).not.toContain('"correct"'); expect(raw).not.toContain('explanation');
    // different student gets a different order (seeded per attempt)
    const other = await start(s2, id);
    expect(other.body.questions.map((q: any) => q.id)).not.toEqual(order1);
    // time passes on the server clock
    await pool.query(`UPDATE assessment_attempts SET started_at = started_at - interval '10 minutes', deadline_at = deadline_at - interval '10 minutes' WHERE id=$1`, [first.body.attempt.id]);
    const again = await start(s1, id);
    expect(again.status).toBe(200); expect(again.body.resumed).toBe(true);
    expect(again.body.attempt.id).toBe(first.body.attempt.id);
    expect(again.body.questions.map((q: any) => q.id)).toEqual(order1);
    expect(again.body.questions.map((q: any) => q.options.map((o: any) => o.id).join(''))).toEqual(opts1);
    expect(again.body.attempt.remainingSeconds).toBeLessThanOrEqual(50 * 60);
    expect(again.body.attempt.remainingSeconds).toBeGreaterThan(48 * 60);
    const viaGet = await get(s1, `/attempts/${first.body.attempt.id}`);
    expect(viaGet.body.questions.map((q: any) => q.id)).toEqual(order1);
    expect((await pool.query('SELECT count(*)::int AS n FROM assessment_attempts WHERE user_id=$1', [s1.id])).rows[0].n).toBe(1);
  });

  it('parallel starts create exactly one attempt', async () => {
    const q = await bank(mcq());
    const { id } = await liveAssessment([{ id: q }]);
    const rs = await Promise.all([start(s1, id), start(s1, id), start(s1, id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.attempt.id)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM assessment_attempts WHERE user_id=$1', [s1.id])).rows[0].n).toBe(1);
  });

  it('deadline = min(start + duration, closesAt); window rules', async () => {
    const q = await bank(mcq());
    const { id } = await liveAssessment([{ id: q }], { duration: 120 });
    await pool.query(`UPDATE assessments SET closes_at = now() + interval '20 minutes' WHERE id=$1`, [id]);
    const st = await start(s1, id);
    expect(st.body.attempt.remainingSeconds).toBeLessThanOrEqual(20 * 60);
    expect(st.body.attempt.remainingSeconds).toBeGreaterThan(19 * 60);
    // not yet open / closed
    const { id: later } = await liveAssessment([{ id: q }]);
    await pool.query(`UPDATE assessments SET opens_at = now() + interval '30 minutes' WHERE id=$1`, [later]);
    const early = await start(s1, later);
    expect(early.status).toBe(422); expect(early.body.error.code).toBe('NOT_OPEN_YET');
    await pool.query(`UPDATE assessments SET opens_at = now() - interval '3 hours', closes_at = now() - interval '1 hour' WHERE id=$1`, [later]);
    const closed = await start(s1, later);
    expect(closed.status).toBe(422); expect(closed.body.error.code).toBe('ASSESSMENT_CLOSED');
    const mine = await get(s1, '/my/assessments?bucket=past');
    expect(mine.body.items.map((x: any) => x.id)).toContain(later);
  });

  it('enforces the deadline on autosave and finalises the attempt', async () => {
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }]);
    const st = await start(s1, id);
    const attemptId = st.body.attempt.id;
    expect((await save(s1, attemptId, [ans(aq(0), 'b')])).status).toBe(200);
    await pool.query(`UPDATE assessment_attempts SET deadline_at = now() - interval '30 seconds' WHERE id=$1`, [attemptId]);
    const late = await save(s1, attemptId, [ans(aq(0), 'a', Date.now() + 5)]);
    expect(late.status).toBe(409); expect(late.body.error.code).toBe('DEADLINE_PASSED');
    const row = (await pool.query('SELECT status, submit_reason, score FROM assessment_attempts WHERE id=$1', [attemptId])).rows[0];
    expect(row).toMatchObject({ status: 'submitted', submit_reason: 'deadline' });
    expect(Number(row.score)).toBe(2); // the earlier answer 'b' was kept, the late one rejected
    const after = await save(s1, attemptId, [ans(aq(0), 'a')]);
    expect(after.status).toBe(409); expect(after.body.error.code).toBe('ATTEMPT_ALREADY_SUBMITTED');
    // within the 5s grace window a late save is still accepted
    const st2 = await start(s2, id);
    await pool.query(`UPDATE assessment_attempts SET deadline_at = now() - interval '2 seconds' WHERE id=$1`, [st2.body.attempt.id]);
    expect((await save(s2, st2.body.attempt.id, [ans(aq(0), 'b')])).status).toBe(200);
  });

  it('autosave is last-write-wins by clientTs, even under concurrency; flags and clearing work', async () => {
    const q = await bank(mcq()); const q2 = await bank(shortText());
    const { id, aq } = await liveAssessment([{ id: q }, { id: q2 }]);
    const attemptId = (await start(s1, id)).body.attempt.id;
    const t = Date.now();
    const [r1, r2] = await Promise.all([
      save(s1, attemptId, [ans(aq(0), 'a', t + 1000)]),
      save(s1, attemptId, [ans(aq(0), 'b', t + 2000)]),
    ]);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    let state = (await get(s1, `/attempts/${attemptId}`)).body;
    expect(state.answers[aq(0)].answer).toBe('b');
    const stale = await save(s1, attemptId, [ans(aq(0), 'c', t + 500), ans(aq(1), 'Delhi', t)]);
    expect(stale.body.stale).toEqual([aq(0)]); expect(stale.body.saved).toBe(1);
    // flag only, own timestamp domain
    const fl = await save(s1, attemptId, [{ questionId: aq(0), flagged: true, clientTs: t + 10, timeSpentMs: 4000 }]);
    expect(fl.body.saved).toBe(1);
    state = (await get(s1, `/attempts/${attemptId}`)).body;
    expect(state.answers[aq(0)]).toMatchObject({ answer: 'b', flagged: true });
    // clear
    await save(s1, attemptId, [ans(aq(0), null, t + 3000)]);
    expect((await get(s1, `/attempts/${attemptId}`)).body.answers[aq(0)].answer).toBeNull();
    // bad shapes
    const bad = await save(s1, attemptId, [ans(aq(0), 'zzz'), ans(randomUUID(), 'a')]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toMatchObject({ 'answers.0.answer': expect.any(String), 'answers.1.questionId': expect.any(String) });
    expect((await save(s1, attemptId, [])).status).toBe(400);
  });

  it('submit is idempotent, grades immediately and the attempt cannot be changed afterwards', async () => {
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }]);
    const attemptId = (await start(s1, id)).body.attempt.id;
    const sub = await post(s1, `/attempts/${attemptId}/submit`, { answers: [ans(aq(0), 'b')] });
    expect(sub.body).toMatchObject({ replayed: false, resultAvailable: true, attempt: { status: 'submitted', submitReason: 'student', evaluation: 'complete' } });
    const sub2 = await post(s1, `/attempts/${attemptId}/submit`);
    expect(sub2.status).toBe(200); expect(sub2.body.replayed).toBe(true);
    expect(sub2.body.attempt.submittedAt).toBe(sub.body.attempt.submittedAt);
    expect((await save(s1, attemptId, [ans(aq(0), 'a')])).status).toBe(409);
    // max attempts
    const again = await start(s1, id);
    expect(again.status).toBe(409); expect(again.body.error.code).toBe('MAX_ATTEMPTS_REACHED');
    expect((await get(s1, '/my/assessments?bucket=past')).body.items[0]).toMatchObject({ id, attemptsUsed: 1, canStart: false, myScore: { score: 2, maxScore: 2 } });
  });

  it('allows several attempts when configured, ranking uses the best', async () => {
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }], { settings: { maxAttempts: 2 }, students: [s1, s2] });
    await takeTest(s1, id, [[aq(0), 'a']]);
    await takeTest(s1, id, [[aq(0), 'b']]);
    expect((await start(s1, id)).status).toBe(409);
    await takeTest(s2, id, [[aq(0), 'a']]);
    const res = await get(officer, `/assessments/${id}/results`);
    const byName = Object.fromEntries(res.body.items.map((r: any) => [r.name, r]));
    expect(byName['Asha One']).toMatchObject({ score: 2, rank: 1, attemptNo: 2 });
    expect(byName['Bala Two']).toMatchObject({ score: -1, rank: 2 });
  });
});

describe('auto-submit worker and proctoring', () => {
  it('auto-submit worker finalises expired attempts exactly once', async () => {
    const q = await bank(mcq()); const q2 = await bank(numeric());
    const { id, aq } = await liveAssessment([{ id: q }, { id: q2 }]);
    const a1 = (await start(s1, id)).body.attempt.id;
    const a2 = (await start(s2, id)).body.attempt.id;
    await save(s1, a1, [ans(aq(0), 'b'), ans(aq(1), '3.141')]);
    await pool.query(`UPDATE assessment_attempts SET deadline_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [[a1, a2]]);
    expect(await runAutoSubmit(pool)).toBe(2);
    expect(await runAutoSubmit(pool)).toBe(0);
    const rows = (await pool.query('SELECT id, status, submit_reason, score, evaluation, submitted_at, deadline_at FROM assessment_attempts WHERE id = ANY($1::uuid[]) ORDER BY id', [[a1, a2]])).rows;
    for (const r of rows) { expect(r.status).toBe('submitted'); expect(r.submit_reason).toBe('deadline'); expect(r.evaluation).toBe('complete'); expect(new Date(r.submitted_at).getTime()).toBeLessThanOrEqual(new Date(r.deadline_at).getTime()); }
    expect(Number(rows.find((r) => r.id === a1).score)).toBe(5);
    expect(Number(rows.find((r) => r.id === a2).score)).toBe(0);
    // attempts still running are untouched
    const a3 = (await start(s3, id)).body.attempt.id;
    await runAutoSubmit(pool);
    expect((await pool.query('SELECT status FROM assessment_attempts WHERE id=$1', [a3])).rows[0].status).toBe('in_progress');
  });

  it('two workers never double-process (SKIP LOCKED)', async () => {
    const q = await bank(mcq());
    const { id } = await liveAssessment([{ id: q }]);
    const ids: string[] = [];
    for (const s of [s1, s2, s3]) ids.push((await start(s, id)).body.attempt.id);
    await pool.query(`UPDATE assessment_attempts SET deadline_at = now() - interval '1 minute'`);
    const [x, y] = await Promise.all([runAutoSubmit(pool), runAutoSubmit(pool)]);
    expect(x + y).toBe(3);
  });

  it('logs and counts proctor events, auto-submits at the limit, never blocks otherwise', async () => {
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }], { settings: { proctoring: { enabled: true, maxWarnings: 3, autoSubmit: true } } });
    const attemptId = (await start(s1, id)).body.attempt.id;
    const ev = (type: string, extra: any = {}) => ({ type, clientTs: Date.now(), ...extra });
    const e1 = await post(s1, `/attempts/${attemptId}/events`, { events: [ev('focus_lost'), ev('focus_regained'), ev('network_offline')] });
    expect(e1.body).toMatchObject({ warnings: 1, maxWarnings: 3, autoSubmitted: false, status: 'in_progress' });
    const dupe = await post(s1, `/attempts/${attemptId}/events`, { events: [ev('app_background', { eventId: 'e-1' })] });
    expect(dupe.body.warnings).toBe(2);
    const retry = await post(s1, `/attempts/${attemptId}/events`, { events: [ev('app_background', { eventId: 'e-1' })] });
    expect(retry.body.warnings).toBe(2); // retried batch not double counted
    await save(s1, attemptId, [ans(aq(0), 'b')]);
    const e3 = await post(s1, `/attempts/${attemptId}/events`, { events: [ev('focus_lost')] });
    expect(e3.body).toMatchObject({ warnings: 3, autoSubmitted: true, status: 'submitted' });
    expect((await pool.query('SELECT submit_reason, score FROM assessment_attempts WHERE id=$1', [attemptId])).rows[0]).toMatchObject({ submit_reason: 'proctor', score: '2.00' });
    const late = await post(s1, `/attempts/${attemptId}/events`, { events: [ev('focus_lost')] });
    expect(late.status).toBe(200); expect(late.body.ignored).toBe(true);
    expect((await post(s2, `/attempts/${attemptId}/events`, { events: [ev('focus_lost')] })).status).toBe(404);
    expect((await post(s1, `/attempts/${attemptId}/events`, { events: [{ type: 'screenshot', clientTs: 1 }] })).status).toBe(400);
    const sheet = (await get(officer, `/assessments/${id}/attempts/${attemptId}`)).body;
    expect(sheet.proctorEvents.length).toBe(5); // the retried eventId was not logged twice
    const results = await get(officer, `/assessments/${id}/results`);
    expect(results.body.items.find((r: any) => r.studentId === s1.id).flags).toMatchObject({ proctor: true, autoSubmitted: true });
  });

  it('without autoSubmit the attempt keeps running; disabled proctoring only logs', async () => {
    const q = await bank(mcq());
    const a = await liveAssessment([{ id: q }], { settings: { proctoring: { enabled: true, maxWarnings: 1, autoSubmit: false } } });
    const at = (await start(s1, a.id)).body.attempt.id;
    const r = await post(s1, `/attempts/${at}/events`, { events: [{ type: 'focus_lost', clientTs: 1 }, { type: 'focus_lost', clientTs: 2 }] });
    expect(r.body).toMatchObject({ warnings: 2, autoSubmitted: false, status: 'in_progress' });
    const b = await liveAssessment([{ id: q }]);
    const bt = (await start(s1, b.id)).body.attempt.id;
    const r2 = await post(s1, `/attempts/${bt}/events`, { events: [{ type: 'focus_lost', clientTs: 1 }] });
    expect(r2.body).toMatchObject({ warnings: 0, maxWarnings: null });
  });
});

describe('grading end to end, sections and result visibility', () => {
  it('grades every type with negative marking, section totals and cutoffs', async () => {
    const m1 = await bank(mcq()); const mm = await bank(multi()); const nu = await bank(numeric()); const st = await bank(shortText());
    const { id, aq } = await liveAssessment([], {
      sections: [{ title: 'Aptitude', cutoffMarks: 4, questions: [{ questionId: m1 }, { questionId: mm }] }, { title: 'Verbal', questions: [{ questionId: nu }, { questionId: st }] }],
      settings: { passCutoff: { type: 'marks', value: 8 } },
    });
    const detail = (await get(officer, `/assessments/${id}`)).body.assessment;
    expect(detail.totalMarks).toBe(11);
    const sec = (i: number, j: number) => detail.sections[i].questions[j].id;
    // s1: all right
    const a1 = await takeTest(s1, id, [[sec(0, 0), 'b'], [sec(0, 1), ['a', 'b', 'd']], [sec(1, 0), 3.14], [sec(1, 1), ' Delhi ']]);
    // s2: partial multi, wrong single (-1), numeric wrong (-1), short unanswered
    const a2 = await takeTest(s2, id, [[sec(0, 0), 'a'], [sec(0, 1), ['a', 'b']], [sec(1, 0), 9]]);
    // s3: multi with a wrong option (-2), rest right
    const a3 = await takeTest(s3, id, [[sec(0, 0), 'b'], [sec(0, 1), ['a', 'c']], [sec(1, 0), 3.15], [sec(1, 1), 'delhi']]);
    const r1 = (await get(s1, `/attempts/${a1}/result`)).body.result;
    expect(r1).toMatchObject({ score: 11, maxScore: 11, percent: 100, passed: true, rank: 1, totalParticipants: 3, percentile: 66.7 });
    expect(r1.sections.map((s: any) => [s.score, s.maxScore, s.cutoffMet])).toEqual([[6, 6, true], [5, 5, null]]);
    const r2 = (await get(s2, `/attempts/${a2}/result`)).body.result;
    expect(r2).toMatchObject({ score: 0.67, passed: false, rank: 3 });
    expect(r2.sections[0]).toMatchObject({ score: 1.67, cutoffMet: false });
    const r3 = (await get(s3, `/attempts/${a3}/result`)).body.result;
    expect(r3).toMatchObject({ score: 5, passed: false, rank: 2 });
    expect(r3.sections[0]).toMatchObject({ score: 0, cutoffMet: false });
    // review shows the key, the partial verdicts and explanations
    const review = (await get(s2, `/attempts/${a2}/result`)).body.review;
    expect(review.map((x: any) => x.correct)).toEqual(['wrong', 'partial', 'wrong', 'unanswered']);
    expect(review[1]).toMatchObject({ yourAnswer: ['a', 'b'], correctAnswer: ['a', 'b', 'd'], score: 2.67, maxScore: 4 });
  });

  it('turns negative marking off per assessment', async () => {
    const m1 = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: m1 }], { settings: { negativeMarking: false } });
    const a1 = await takeTest(s1, id, [[aq(0), 'a']]);
    expect((await get(s1, `/attempts/${a1}/result`)).body.result.score).toBe(0);
    const st = await start(s2, id);
    expect(st.body.questions[0].negativeMarks).toBe(0);
  });

  it('result visibility: immediate | after_close | manual, review only when allowed', async () => {
    const q = await bank(mcq());
    const imm = await liveAssessment([{ id: q }], { settings: { resultVisibility: 'immediate', allowReview: false } });
    const t1 = await takeTest(s1, imm.id, [[imm.aq(0), 'b']]);
    const r1 = (await get(s1, `/attempts/${t1}/result`)).body;
    expect(r1.available).toBe(true); expect(r1.review).toBeNull();

    const ac = await liveAssessment([{ id: q }], { settings: { resultVisibility: 'after_close', allowReview: true } });
    const t2 = await takeTest(s1, ac.id, [[ac.aq(0), 'b']]);
    const r2 = (await get(s1, `/attempts/${t2}/result`)).body;
    expect(r2).toMatchObject({ available: false, visibility: 'after_close', reason: 'AFTER_CLOSE' });
    expect(r2.result).toBeUndefined();
    await pool.query(`UPDATE assessments SET opens_at = now() - interval '5 hours', closes_at = now() - interval '1 minute' WHERE id=$1`, [ac.id]);
    const r2b = (await get(s1, `/attempts/${t2}/result`)).body;
    expect(r2b.available).toBe(true); expect(r2b.review).toHaveLength(1);

    const man = await liveAssessment([{ id: q }], { settings: { resultVisibility: 'manual', allowReview: true } });
    const t3 = await takeTest(s1, man.id, [[man.aq(0), 'b']]);
    expect((await get(s1, `/attempts/${t3}/result`)).body).toMatchObject({ available: false, reason: 'MANUAL' });
    expect((await get(s1, '/my/assessments?bucket=past')).body.items.find((x: any) => x.id === man.id)).toMatchObject({ resultReleased: false, myScore: null, canStart: false }); // attempts used up => past, score hidden
    expect((await post(s1, `/assessments/${man.id}/results/publish`)).status).toBe(403);
    const pub = await post(officer, `/assessments/${man.id}/results/publish`);
    expect(pub.body).toMatchObject({ released: true, notified: 1, alreadyPublished: false });
    expect((await get(s1, `/attempts/${t3}/result`)).body.available).toBe(true);
    expect((await post(officer, `/assessments/${man.id}/results/publish`)).body.alreadyPublished).toBe(true);
    expect((await get(s1, '/notifications')).body.items.filter((n: any) => n.type === 'assessment_result')).toHaveLength(1);
    await post(officer, `/assessments/${man.id}/results/unpublish`);
    expect((await get(s1, `/attempts/${t3}/result`)).body.available).toBe(false);
    // result of an unsubmitted attempt
    const live = await start(s2, man.id);
    expect((await get(s2, `/attempts/${live.body.attempt.id}/result`)).status).toBe(409);
  });

  it('rank ties share a rank, ranking can be disabled', async () => {
    const q1 = await bank(mcq({ marks: 5 })); const q2 = await bank(mcq({ marks: 5 }));
    const { id, aq } = await liveAssessment([{ id: q1 }, { id: q2 }]);
    const t1 = await takeTest(s1, id, [[aq(0), 'b'], [aq(1), 'b']]);
    const t2 = await takeTest(s2, id, [[aq(0), 'b'], [aq(1), 'b']]);
    const t3 = await takeTest(s3, id, [[aq(0), 'b']]);
    const ranks = [t1, t2, t3].map(() => 0);
    ranks[0] = (await get(s1, `/attempts/${t1}/result`)).body.result.rank;
    ranks[1] = (await get(s2, `/attempts/${t2}/result`)).body.result.rank;
    ranks[2] = (await get(s3, `/attempts/${t3}/result`)).body.result.rank;
    expect(ranks).toEqual([1, 1, 3]);
    const table = (await get(officer, `/assessments/${id}/results`)).body;
    expect(table.items.map((r: any) => [r.name, r.rank, r.score])).toEqual([['Asha One', 1, 10], ['Bala Two', 1, 10], ['Chitra Three', 3, 5]]);
    expect(table.summary).toMatchObject({ participants: 3, avg: 8.33, median: 10, max: 10, min: 5 });
    const noRank = await liveAssessment([{ id: q1 }], { settings: { rankingEnabled: false } });
    const t = await takeTest(s1, noRank.id, [[noRank.aq(0), 'b']]);
    expect((await get(s1, `/attempts/${t}/result`)).body.result).toMatchObject({ rank: null, percentile: null });
  });

  it('sequential sections: ordered, locked once left, per-section time', async () => {
    const a = await bank(mcq()); const b = await bank(mcq());
    const { id, detail } = await liveAssessment([], { sections: [{ title: 'S1', timeLimitMinutes: 10, questions: [{ questionId: a }] }, { title: 'S2', timeLimitMinutes: 10, questions: [{ questionId: b }] }] });
    const st = await start(s1, id);
    const attemptId = st.body.attempt.id;
    const [q1, q2] = [detail.sections[0].questions[0].id, detail.sections[1].questions[0].id];
    expect(st.body.questions.map((q: any) => q.id)).toEqual([q1]);
    expect(st.body.sections[1]).toMatchObject({ enteredAt: null, questionIds: [] });
    expect(st.body.sections[0].deadlineAt).toBeTruthy();
    expect((await save(s1, attemptId, [ans(q2, 'b')])).status).toBe(409); // section not open
    const enter = await post(s1, `/attempts/${attemptId}/sections/${detail.sections[1].id}/enter`);
    expect(enter.body.questions.map((q: any) => q.id)).toEqual([q2]);
    expect((await post(s1, `/attempts/${attemptId}/sections/${detail.sections[1].id}/enter`)).status).toBe(200);
    const locked = await save(s1, attemptId, [ans(q1, 'b')]);
    expect(locked.status).toBe(409); expect(locked.body.error.code).toBe('SECTION_CLOSED');
    const mixed = await save(s1, attemptId, [ans(q1, 'b'), ans(q2, 'b')]);
    expect(mixed.body).toMatchObject({ saved: 1, rejected: [{ questionId: q1, reason: 'SECTION_CLOSED' }] });
    // timed-out section
    const st2 = await start(s2, id);
    await pool.query(`UPDATE assessment_attempts SET section_state = jsonb_build_object($2::text, jsonb_build_object('enteredAt', (now() - interval '11 minutes')::text)) WHERE id=$1`, [st2.body.attempt.id, detail.sections[0].id]);
    const timeUp = await save(s2, st2.body.attempt.id, [ans(q1, 'b')]);
    expect(timeUp.status).toBe(409); expect(timeUp.body.error.code).toBe('SECTION_CLOSED');
    const skip = await post(s3, `/attempts/${(await start(s3, id)).body.attempt.id}/sections/${randomUUID()}/enter`);
    expect(skip.status).toBe(404);
  });
});

describe('regrade, override and exports', () => {
  it('correcting the answer key and regrading updates every attempt, with audit and override preserved', async () => {
    const q = await bank(mcq({ marks: 4, negativeMarks: 1 }));
    const { id, aq } = await liveAssessment([{ id: q }]);
    const t1 = await takeTest(s1, id, [[aq(0), 'b']]);
    const t2 = await takeTest(s2, id, [[aq(0), 'c']]);
    const t3 = await takeTest(s3, id, []);
    const score = async (s: Session, t: string) => (await get(s, `/attempts/${t}/result`)).body.result.score;
    expect([await score(s1, t1), await score(s2, t2), await score(s3, t3)]).toEqual([4, -1, 0]);
    // override s3 first
    const ov = await put(officer, `/assessments/${id}/attempts/${t3}/override`, { score: 2, reason: 'Medical issue during test' });
    expect(ov.body.attempt).toMatchObject({ effectiveScore: 2, override: { score: 2 } });
    expect(await score(s3, t3)).toBe(2);
    expect((await put(officer, `/assessments/${id}/attempts/${t3}/override`, { score: 99, reason: 'too much' })).status).toBe(400);
    expect((await put(officer, `/assessments/${id}/attempts/${t3}/override`, { score: 1, reason: '' })).status).toBe(400);
    // bank edits do not change the running test
    await put(officer, `/assessment-questions/${q}`, mcq({ marks: 4, answer: { correct: 'c' } }));
    expect(await score(s2, t2)).toBe(-1);
    // correct the key on the assessment
    const key = await put(officer, `/assessments/${id}/questions/${aq(0)}/key`, { reason: 'Answer key was wrong', answer: { correct: 'c' } });
    expect(key.body.needsRegrade).toBe(true);
    expect(await score(s1, t1)).toBe(4); // not regraded yet
    const rg = await post(officer, `/assessments/${id}/regrade`, { reason: 'Key corrected' });
    expect(rg.body).toMatchObject({ regraded: 3, changed: 2 }); // s3 has no answer so its computed score stays 0
    expect([await score(s1, t1), await score(s2, t2), await score(s3, t3)]).toEqual([-1, 4, 2]); // override kept
    const audit = (await pool.query(`SELECT action, meta FROM audit_events WHERE action LIKE 'assessment.%' ORDER BY id`)).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['assessment.score_override', 'assessment.key_corrected', 'assessment.regraded']));
    expect((await post(officer, `/assessments/${id}/regrade`, { reason: 'x' })).status).toBe(400);
    // marks change flows through too
    await put(officer, `/assessments/${id}/questions/${aq(0)}/key`, { reason: 'Double marks', marks: 8, negativeMarks: 2 });
    await post(officer, `/assessments/${id}/regrade`, { reason: 'Marks changed' });
    expect(await score(s2, t2)).toBe(8);
    expect((await get(officer, `/assessments/${id}`)).body.assessment.totalMarks).toBe(8);
    const rows = (await get(officer, `/assessments/${id}/results`)).body.items;
    expect(rows.find((r: any) => r.studentId === s3.id)).toMatchObject({ score: 2, flags: { overridden: true }, override: { reason: 'Medical issue during test' } });
    // clearing the override restores the computed score
    await put(officer, `/assessments/${id}/attempts/${t3}/override`, { score: null, reason: 'Revoked' });
    expect(await score(s3, t3)).toBe(0);
    // students cannot do any of this
    expect((await put(s1, `/assessments/${id}/questions/${aq(0)}/key`, { reason: 'abc', marks: 1 })).status).toBe(403);
    expect((await post(s1, `/assessments/${id}/regrade`, { reason: 'abc' })).status).toBe(403);
  });

  it('exports CSV safely and gives analytics, distribution and answer sheets', async () => {
    const evilName = await register(app, 'student', { name: 'Evil Name' });
    await pool.query(`UPDATE users SET name='=HYPERLINK("http://x")' WHERE id=$1`, [evilName.id]);
    const q1 = await bank(mcq()); const q2 = await bank(mcq({ difficulty: 'hard' }));
    const { id, aq } = await liveAssessment([{ id: q1 }, { id: q2 }], { students: [s1, s2, evilName] });
    await takeTest(s1, id, [[aq(0), 'b'], [aq(1), 'b']]);
    const t2 = await post(s2, `/my/assessments/${id}/start`);
    await save(s2, t2.body.attempt.id, [ans(aq(0), 'b', Date.now(), { timeSpentMs: 12_000 }), ans(aq(1), 'a', Date.now(), { timeSpentMs: 30_000 })]);
    await post(s2, `/attempts/${t2.body.attempt.id}/submit`);
    const csv = await get(officer, `/assessments/${id}/results/export`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text.split('\r\n')[0]).toContain('rank,name,email,registrationNumber,status,score');
    expect(csv.text).toContain('not_attempted');
    const an = (await get(officer, `/assessments/${id}/analytics`)).body;
    expect(an.questions).toHaveLength(2);
    expect(an.questions[0]).toMatchObject({ attempted: 2, correctCount: 2, correctPercent: 100, difficultyIndex: 1, attemptRate: 100 });
    expect(an.questions[1]).toMatchObject({ attempted: 2, correctCount: 1, correctPercent: 50, avgTimeSeconds: 30 });
    expect(an.distribution.buckets).toHaveLength(10);
    expect(an.distribution.buckets.reduce((s: number, b: any) => s + b.count, 0)).toBe(2);
    expect(an.summary.notAttempted).toBe(1);
    const sheet = await get(officer, `/assessments/${id}/attempts/${t2.body.attempt.id}`);
    expect(sheet.body.student.name).toBe('Bala Two');
    expect(sheet.body.answers[1]).toMatchObject({ answer: 'a', correctAnswer: 'b', correct: 'wrong', timeSpentMs: 30000 });
    expect((await get(officer, `/assessments/${id}/results?status=not_attempted`)).body.items).toHaveLength(1);
    expect((await get(officer, `/assessments/${id}/results?q=bala`)).body.items).toHaveLength(1);
    expect((await get(officer, `/assessments/${id}/results?limit=1`)).body.nextCursor).toBeTruthy();
    expect((await get(officer, `/assessments/${id}/results?sort=bogus`)).status).toBe(400);
  });
});

describe('coding', () => {
  const pyCode = (marker: string) => ({ language: 'python3', code: `# ${marker}\na, b = map(int, input().split())\nprint(a + b)\n` });

  it('run uses samples or custom stdin and is rate limited per attempt', async () => {
    const c = await bank(coding());
    const { id, aq } = await liveAssessment([{ id: c }]);
    const at = (await start(s1, id)).body.attempt.id;
    const st = (await get(s1, `/attempts/${at}`)).body;
    expect(st.questions[0].coding.samples).toEqual([{ id: 't1', input: '1 2', expectedOutput: '3', explanation: '1+2' }]);
    expect(st.questions[0].coding.hiddenCount).toBe(3);
    expect(JSON.stringify(st)).not.toContain('"300"'); // hidden expected output never sent
    const run = await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM') });
    expect(run.status).toBe(200);
    expect(run.body.run).toMatchObject({ mode: 'samples', verdict: 'accepted', results: [{ id: 't1', verdict: 'accepted', stdout: '3\n' }] });
    const custom = await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM'), stdin: '7 8' });
    expect(custom.body.run).toMatchObject({ mode: 'custom', results: [{ verdict: 'completed', stdout: '15\n' }] });
    expect((await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('COMPILE_ERR') })).body.run).toMatchObject({ verdict: 'compile_error', compile: { ok: false } });
    expect((await post(s1, `/attempts/${at}/run`, { questionId: aq(0), language: 'java', code: 'x' })).status).toBe(400);
    expect((await post(s1, `/attempts/${at}/run`, { questionId: aq(0), language: 'python3', code: '   ' })).status).toBe(400);
    for (let i = 0; i < 17; i++) expect((await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM') })).status).toBe(200);
    const limited = await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM') });
    expect(limited.status).toBe(429); expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // other attempts have their own budget
    const at2 = (await start(s2, id)).body.attempt.id;
    expect((await post(s2, `/attempts/${at2}/run`, { questionId: aq(0), ...pyCode('SUM') })).status).toBe(200);
    // not your attempt / not a coding question
    expect((await post(s2, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM') })).status).toBe(404);
  });

  it('submit-code stores verdicts, hides hidden tests, keeps the best, scores by weight', async () => {
    const c = await bank(coding());
    const { id, aq } = await liveAssessment([{ id: c }]);
    const at = (await start(s1, id)).body.attempt.id;
    const sub = (code: any) => post(s1, `/attempts/${at}/questions/${aq(0)}/submit-code`, code);
    const partial = await sub(pyCode('PARTIAL'));
    expect(partial.status).toBe(200);
    expect(partial.body.submission).toMatchObject({ status: 'judged', verdict: 'wrong_answer', passed: 3, total: 4, score: 4, maxScore: 7, hiddenPassed: 2, hiddenTotal: 3, improved: true });
    expect(JSON.stringify(partial.body)).not.toContain('300');
    expect(partial.body.submission.samples).toHaveLength(1);
    const worse = await sub(pyCode('WRONG'));
    expect(worse.body.submission).toMatchObject({ passed: 0, score: 0, improved: false, best: { passed: 3, total: 4, score: 4 } });
    const ce = await sub(pyCode('COMPILE_ERR'));
    expect(ce.body.submission).toMatchObject({ verdict: 'compile_error', compileOutput: 'error: expected ;' });
    expect((await sub(pyCode('TLE'))).body.submission.verdict).toBe('time_limit_exceeded');
    expect((await sub(pyCode('RUNTIME'))).body.submission.verdict).toBe('runtime_error');
    expect((await sub(pyCode('MLE'))).body.submission.verdict).toBe('memory_limit_exceeded');
    const state = (await get(s1, `/attempts/${at}`)).body;
    expect(state.code[aq(0)]).toMatchObject({ submissions: 6, pending: false, best: { passed: 3, total: 4, score: 4, maxScore: 7 } });
    await save(s1, at, [ans(aq(0), pyCode('PARTIAL'))]);
    const fin = await post(s1, `/attempts/${at}/submit`);
    expect(fin.body.attempt.evaluation).toBe('complete'); // same code already judged => nothing queued
    const result = (await get(s1, `/attempts/${at}/result`)).body.result;
    expect(result.score).toBe(4);
    expect(result.coding[0]).toMatchObject({ verdict: 'wrong_answer', passed: 3, total: 4, score: 4, maxScore: 7, language: 'python3' });
    const better = await post(s1, `/attempts/${at}/questions/${aq(0)}/submit-code`, pyCode('SUM'));
    expect(better.status).toBe(409); // already submitted
    // the officer sees per-test verdicts, the student never does
    const sheet = (await get(officer, `/assessments/${id}/attempts/${at}`)).body.answers[0];
    expect(sheet.submissions[0].tests.map((t: any) => t.kind)).toEqual(['sample', 'hidden', 'hidden', 'hidden']);
    expect(sheet.bestSubmissionId).toBe(sheet.submissions[0].id);
  });

  it('full marks for a correct solution; float tolerance and line mode honoured', async () => {
    const c = await bank(coding({ coding: { ...coding().coding, compare: { mode: 'tokens', floatTolerance: 0.001 } } }));
    const { id, aq } = await liveAssessment([{ id: c }]);
    const at = (await start(s1, id)).body.attempt.id;
    const ok = await post(s1, `/attempts/${at}/questions/${aq(0)}/submit-code`, pyCode('FLOAT'));
    expect(ok.body.submission).toMatchObject({ verdict: 'accepted', passed: 4, score: 7 });
    // single judge batch for all tests, with the question limits
    expect(judge.batches.at(-1)).toHaveLength(4);
    expect(judge.batches.at(-1)![0]).toMatchObject({ language: 'python3', stdin: '1 2' });
  });

  it('judge outage: 503, submissions queued as pending_judge, answers never lost, worker re-judges', async () => {
    const c = await bank(coding());
    const m = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: c }, { id: m }]);
    const at = (await start(s1, id)).body.attempt.id;
    judge.down = true;
    const run = await post(s1, `/attempts/${at}/run`, { questionId: aq(0), ...pyCode('SUM') });
    expect(run.status).toBe(503); expect(run.body.error.code).toBe('CODE_EXECUTION_UNAVAILABLE');
    const sc = await post(s1, `/attempts/${at}/questions/${aq(0)}/submit-code`, pyCode('SUM'));
    expect(sc.status).toBe(503); expect(sc.body.error.code).toBe('CODE_EXECUTION_UNAVAILABLE');
    expect(sc.body.submission).toMatchObject({ status: 'pending_judge' });
    expect((await get(s1, `/attempts/${at}`)).body.code[aq(0)]).toMatchObject({ submissions: 1, pending: true, best: null });
    // final submit with unsaved editor code
    await save(s1, at, [ans(aq(0), pyCode('SUM')), ans(aq(1), 'b')]);
    const fin = await post(s1, `/attempts/${at}/submit`);
    expect(fin.body.attempt.evaluation).toBe('pending'); expect(fin.body.resultAvailable).toBe(false);
    expect((await get(s1, `/attempts/${at}/result`)).body).toMatchObject({ available: false, reason: 'EVALUATION_PENDING' });
    expect(await pool.query(`SELECT 1 FROM assessment_code_submissions WHERE attempt_id=$1 AND status='pending_judge'`, [at]).then((r) => r.rowCount)).toBe(1); // the final editor code equals the queued submission, so it is not queued twice
    // judge still down: worker backs off, nothing lost
    const r1 = await runJudgeQueue(pool, judge, new Date(Date.now() + 60_000));
    expect(r1).toMatchObject({ judged: 0, requeued: 1 });
    // judge recovers
    judge.down = false;
    const r2 = await runJudgeQueue(pool, judge, new Date(Date.now() + 3600_000));
    expect(r2.judged).toBe(1);
    const row = (await pool.query('SELECT evaluation, score FROM assessment_attempts WHERE id=$1', [at])).rows[0];
    expect(row.evaluation).toBe('complete'); expect(Number(row.score)).toBe(7 + 2);
    expect((await get(s1, `/attempts/${at}/result`)).body.result.score).toBe(9);
    // unconfigured judge behaves the same
    judge.configured = false;
    const at2 = (await start(s2, id)).body.attempt.id;
    expect((await post(s2, `/attempts/${at2}/run`, { questionId: aq(0), ...pyCode('SUM') })).status).toBe(503);
    expect((await post(s2, `/attempts/${at2}/questions/${aq(0)}/submit-code`, pyCode('SUM'))).body.submission.status).toBe('pending_judge');
  });

  it('gives up after repeated outages without losing the attempt', async () => {
    const c = await bank(coding());
    const { id, aq } = await liveAssessment([{ id: c }]);
    const at = (await start(s1, id)).body.attempt.id;
    judge.down = true;
    await post(s1, `/attempts/${at}/questions/${aq(0)}/submit-code`, pyCode('SUM'));
    await post(s1, `/attempts/${at}/submit`);
    for (let i = 0; i < 9; i++) await runJudgeQueue(pool, judge, new Date(Date.now() + (i + 1) * 3_600_000));
    const row = (await pool.query('SELECT evaluation, score FROM assessment_attempts WHERE id=$1', [at])).rows[0];
    expect(row.evaluation).toBe('complete'); expect(Number(row.score)).toBe(0);
    expect((await pool.query(`SELECT status, verdict FROM assessment_code_submissions WHERE attempt_id=$1`, [at])).rows[0]).toMatchObject({ status: 'error', verdict: 'internal_error' });
  });

  it('flags identical and near-identical coding submissions (plagiarism-lite)', async () => {
    const c = await bank(coding());
    const { id, aq } = await liveAssessment([{ id: c }]);
    const long = (v: string, f: string) => ({
      language: 'python3',
      code: `# SUM\ndef ${f}(${v}1, ${v}2):\n    total = ${v}1 + ${v}2\n    return total\n\nfor line in open(0):\n    parts = line.split()\n    if len(parts) == 2:\n        print(${f}(int(parts[0]), int(parts[1])))\n`,
    });
    const other = { language: 'python3', code: '# SUM\nimport sys\ndata = sys.stdin.read().split()\nresult = 0\nfor token in data:\n    result += int(token)\nprint(result)\nprint("done") if False else None\n' };
    const submitFor = async (s: Session, code: any) => {
      const at = (await start(s, id)).body.attempt.id;
      await post(s, `/attempts/${at}/questions/${aq(0)}/submit-code`, code);
      await post(s, `/attempts/${at}/submit`);
      return at;
    };
    await submitFor(s1, long('a', 'add'));
    await submitFor(s2, long('x', 'plus')); // renamed identifiers + comment tweak => identical token stream
    await submitFor(s3, other);
    const p = (await get(officer, `/assessments/${id}/plagiarism`)).body;
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0]).toMatchObject({ identical: true, similarity: 1 });
    expect([p.pairs[0].a.name, p.pairs[0].b.name].sort()).toEqual(['Asha One', 'Bala Two']);
    const rows = (await get(officer, `/assessments/${id}/results?flagged=1`)).body.items;
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Asha One', 'Bala Two']);
    expect(rows.every((r: any) => r.flags.plagiarism)).toBe(true);
    expect((await get(officer, `/assessments/${id}/results`)).body.items.find((r: any) => r.name === 'Chitra Three').flags.plagiarism).toBe(false);
  });

  it('detects very similar (not identical) submissions by shingle overlap', async () => {
    const c = await bank(coding());
    const { id, aq } = await liveAssessment([{ id: c }]);
    const body = (extra: string) => ({ language: 'python3', code: `# SUM\nimport sys\ndata = sys.stdin.read().split()\nresult = 0\nfor token in data:\n    result += int(token)\n${extra}print(result)\n` });
    const run = async (s: Session, code: any) => { const at = (await start(s, id)).body.attempt.id; await post(s, `/attempts/${at}/questions/${aq(0)}/submit-code`, code); await post(s, `/attempts/${at}/submit`); };
    await run(s1, body(''));
    await run(s2, body('result = result\n'));
    const p = (await get(officer, `/assessments/${id}/plagiarism?threshold=0.7`)).body;
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0].identical).toBe(false);
    expect(p.pairs[0].similarity).toBeGreaterThanOrEqual(0.7);
    expect((await get(officer, `/assessments/${id}/plagiarism?threshold=0.99`)).body.pairs).toHaveLength(0);
  });
});

describe('practice mode', () => {
  it('practice sets are unlimited, unranked and instant; coding problems report solved status', async () => {
    const m = await bank(mcq()); const cq = await bank(coding({ practice: true })); await bank(coding({ title: 'Hidden from practice' }));
    const set = await post(officer, '/assessments', { title: 'Aptitude warm-up', practice: true, durationMinutes: 20, sections: [{ title: 'S', questions: [{ questionId: m }] }], settings: { allowReview: false } });
    expect(set.body.assessment.practice).toBe(true);
    expect((await post(officer, `/assessments/${set.body.assessment.id}/publish`)).status).toBe(200);
    expect((await get(s1, '/my/assessments')).body.items).toHaveLength(0);
    const list = await get(s1, '/practice/assessments');
    expect(list.body.items).toHaveLength(1);
    const pid = set.body.assessment.id;
    const a1 = (await start(s1, pid)).body;
    const a2 = await takeTest(s1, pid, [[a1.questions[0].id, 'b']]); // resumes and submits attempt 1
    expect(a2).toBe(a1.attempt.id);
    const again = await start(s1, pid);
    expect(again.status).toBe(201); expect(again.body.attempt.attemptNo).toBe(2);
    expect((await start(s1, pid)).body.attempt.id).toBe(again.body.attempt.id); // resume
    await post(s1, `/attempts/${again.body.attempt.id}/submit`);
    const third = await start(s1, pid);
    expect(third.status).toBe(201); // unlimited attempts
    const res = (await get(s1, `/attempts/${a2}/result`)).body;
    expect(res.available).toBe(true); expect(res.review).toHaveLength(1);
    expect(res.result).toMatchObject({ rank: null, percentile: null });
    expect(res.result.score).toBe(2);
    expect((await get(s1, '/practice/assessments')).body.items[0].attemptsUsed).toBe(2);

    const probs = await get(s1, '/practice/problems');
    expect(probs.body.items).toHaveLength(1);
    expect(probs.body.items[0]).toMatchObject({ id: cq, solved: false, attempted: false });
    const code = { language: 'python3', code: '# PARTIAL\nprint(1)' };
    expect((await post(s1, `/practice/problems/${cq}/run`, code)).body.run.verdict).toBe('accepted');
    const part = await post(s1, `/practice/problems/${cq}/submit`, code);
    expect(part.body.submission).toMatchObject({ passed: 3, total: 4, solved: false });
    let item = (await get(s1, '/practice/problems')).body.items[0];
    expect(item).toMatchObject({ solved: false, attempted: true, bestPercent: 75 });
    const full = await post(s1, `/practice/problems/${cq}/submit`, { language: 'python3', code: '# SUM\nprint(1)' });
    expect(full.body.submission).toMatchObject({ solved: true, verdict: 'accepted' });
    item = (await get(s1, '/practice/problems')).body.items[0];
    expect(item).toMatchObject({ solved: true, bestPercent: 100 });
    expect((await get(s2, '/practice/problems')).body.items[0].solved).toBe(false);
    expect((await get(s1, '/practice/problems?status=solved')).body.items).toHaveLength(1);
    expect((await get(s1, '/practice/problems?status=unsolved')).body.items).toHaveLength(0);
    const detail = (await get(s1, `/practice/problems/${cq}`)).body.problem;
    expect(detail).toMatchObject({ solved: true, lastSubmission: { verdict: 'accepted' } });
    expect(JSON.stringify(detail)).not.toContain('300');
    // practice run is rate limited per user + problem
    for (let i = 0; i < 20; i++) await post(s2, `/practice/problems/${cq}/run`, code);
    expect((await post(s2, `/practice/problems/${cq}/run`, code)).status).toBe(429);
    judge.down = true;
    const down = await post(s1, `/practice/problems/${cq}/submit`, code);
    expect(down.status).toBe(503); expect(down.body.submission.status).toBe('pending_judge');
    expect((await get(s1, '/practice/problems/' + randomUUID())).status).toBe(404);
  });
});

describe('shortlist', () => {
  it('previews first, then moves applications through the status machine idempotently', async () => {
    const q = await bank(mcq({ marks: 10, negativeMarks: 0 })); const q2 = await bank(mcq({ marks: 10, negativeMarks: 0 }));
    const drive = await createOpenDrive(app, officer);
    const apps = [] as { s: Session & { resumeId: string }; applicationId: string }[];
    for (let i = 0; i < 3; i++) {
      const s = await makeEligibleStudent(app);
      const ap = await applyTo(app, s, drive.id);
      expect(ap.status).toBe(201);
      apps.push({ s, applicationId: ap.body.application.id });
    }
    for (const a of apps) expect((await post(officer, `/applications/${a.applicationId}/status`, { status: 'screening' })).status).toBe(200);
    const stuck = apps[2]; // moves on to rejected already => selected is impossible
    await post(officer, `/applications/${stuck.applicationId}/status`, { status: 'rejected' });
    const noApp = await makeEligibleStudent(app); // took the test but never applied
    const students = [...apps.map((a) => a.s), noApp];
    const { id, aq } = await liveAssessment([{ id: q }, { id: q2 }], { students, extra: { driveId: drive.id } });
    // scores: 20, 10, 20, 20(no application)
    await takeTest(students[0], id, [[aq(0), 'b'], [aq(1), 'b']]);
    await takeTest(students[1], id, [[aq(0), 'b']]);
    await takeTest(students[2], id, [[aq(0), 'b'], [aq(1), 'b']]);
    await takeTest(students[3], id, [[aq(0), 'b'], [aq(1), 'b']]);
    const body = { minScore: 15, toStatus: 'selected' };
    const prev = await post(officer, `/assessments/${id}/shortlist`, body); // dryRun defaults to true
    expect(prev.status).toBe(200);
    expect(prev.body).toMatchObject({ dryRun: true, matched: 3, willChange: 1, changed: 0 });
    expect(prev.body.skipped.map((x: any) => x.reason).sort()).toEqual(['INVALID_TRANSITION', 'NO_APPLICATION']);
    const unchanged = await pool.query(`SELECT status FROM applications WHERE id=$1`, [apps[0].applicationId]);
    expect(unchanged.rows[0].status).toBe('screening');
    const real = await post(officer, `/assessments/${id}/shortlist`, { ...body, dryRun: false });
    expect(real.body).toMatchObject({ dryRun: false, matched: 3, changed: 1 });
    expect((await pool.query(`SELECT status FROM applications WHERE id=$1`, [apps[0].applicationId])).rows[0].status).toBe('selected');
    expect((await pool.query(`SELECT status FROM applications WHERE id=$1`, [apps[1].applicationId])).rows[0].status).toBe('screening');
    const ev = await pool.query(`SELECT note, actor_role FROM application_events WHERE application_id=$1 AND status='selected'`, [apps[0].applicationId]);
    expect(ev.rows).toHaveLength(1); expect(ev.rows[0].note).toMatch(/Assessment shortlist: Campus Drive Test \(score 20\)/);
    const notes = await get(apps[0].s, '/notifications');
    expect(notes.body.items.some((n: any) => n.type === 'application_status' && /shortlisted/.test(n.body))).toBe(true);
    // idempotent
    const repeat = await post(officer, `/assessments/${id}/shortlist`, { ...body, dryRun: false });
    expect(repeat.body).toMatchObject({ changed: 0, unchanged: 1 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM application_events WHERE application_id=$1 AND status='selected'`, [apps[0].applicationId])).rows[0].n).toBe(1);
    // topN with ties: rank <= 1 gives everyone who scored 20
    const top = await post(officer, `/assessments/${id}/shortlist`, { topN: 1, toStatus: 'interview', dryRun: true });
    expect(top.body.matched).toBe(3);
    // validation
    expect((await post(officer, `/assessments/${id}/shortlist`, { toStatus: 'selected' })).status).toBe(400);
    expect((await post(officer, `/assessments/${id}/shortlist`, { minScore: 1, topN: 1, toStatus: 'selected' })).status).toBe(400);
    expect((await post(officer, `/assessments/${id}/shortlist`, { minScore: 1, toStatus: 'withdrawn' })).status).toBe(400);
    expect((await post(officer, `/assessments/${id}/shortlist`, { minScore: 1, toStatus: 'selected', driveId: randomUUID() })).status).toBe(404);
    expect((await post(apps[0].s, `/assessments/${id}/shortlist`, body)).status).toBe(403);
    // still-evaluating attempts block a real run
    await pool.query(`UPDATE assessment_attempts SET evaluation='pending' WHERE user_id=$1`, [students[1].id]);
    const blocked = await post(officer, `/assessments/${id}/shortlist`, { minScore: 5, toStatus: 'selected', dryRun: false });
    expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('EVALUATION_PENDING');
    expect((await post(officer, `/assessments/${id}/shortlist`, { minScore: 5, toStatus: 'selected' })).body.pendingEvaluation).toBe(1);
  });

  it('needs a drive when the assessment is not linked to one', async () => {
    const q = await bank(mcq());
    const { id } = await liveAssessment([{ id: q }]);
    const r = await post(officer, `/assessments/${id}/shortlist`, { minScore: 1, toStatus: 'selected' });
    expect(r.status).toBe(400); expect(r.body.error.fields.driveId).toBeTruthy();
  });
});

describe('reminders', () => {
  it('sends t60/t15 start reminders once, skips started students and respects settings', async () => {
    const q = await bank(mcq());
    const opens = new Date(Date.now() + 2 * 3600_000);
    const c = await post(officer, '/assessments', {
      title: 'Reminder Test', durationMinutes: 30, opensAt: opens.toISOString(), closesAt: new Date(opens.getTime() + 4 * 3600_000).toISOString(),
      audience: { type: 'students', studentIds: [s1.id, s2.id, s3.id] }, sections: [{ title: 'S', questions: [{ questionId: q }] }],
    });
    const id = c.body.assessment.id;
    await post(officer, `/assessments/${id}/publish`);
    await put(s3, '/reminder-settings', { t60: false });
    await pool.query(`INSERT INTO devices (tenant_id, user_id, expo_push_token, platform) SELECT tenant_id, id, 'ExponentPushToken[r1]', 'android' FROM users WHERE id=$1`, [s1.id]);
    sent.length = 0;
    expect((await runDueAssessmentReminders(pool, fakePush, new Date())).sent).toBe(0); // nothing due yet
    const at60 = new Date(opens.getTime() - 59 * 60_000);
    await pool.query(`UPDATE assessments SET opens_at=$2, closes_at=$3 WHERE id=$1`, [id, new Date(at60.getTime() + 3600_000), new Date(at60.getTime() + 5 * 3600_000)]);
    // student 2 starts early? not possible before opening, so mimic by inserting an attempt
    await pool.query(`INSERT INTO assessment_attempts (tenant_id, assessment_id, user_id, seed, deadline_at, status) SELECT tenant_id, $1, id, 1, now() + interval '1 hour', 'in_progress' FROM users WHERE id=$2`, [id, s2.id]);
    const run = await runDueAssessmentReminders(pool, fakePush, at60);
    expect(run).toMatchObject({ sent: 1, skipped: 1, cancelled: 1 });
    const n1 = (await get(s1, '/notifications')).body.items.filter((n: any) => n.type === 'assessment_reminder');
    expect(n1).toHaveLength(1); expect(n1[0].title).toBe('Test starts in 1 hour');
    expect(sent.flat().filter((m) => m.title.includes('1 hour'))).toHaveLength(1);
    const again = await runDueAssessmentReminders(pool, fakePush, at60);
    expect(again).toMatchObject({ sent: 0, skipped: 0, cancelled: 0 });
    // archived => cancelled
    await post(officer, `/assessments/${id}/archive`);
    expect((await pool.query(`SELECT count(*)::int AS n FROM assessment_reminders WHERE assessment_id=$1 AND status='pending'`, [id])).rows[0].n).toBe(0);
  });
});

describe('permissions and tenant scoping', () => {
  it('keeps roles apart', async () => {
    const q = await bank(mcq());
    const { id } = await liveAssessment([{ id: q }], { students: [s1] });
    for (const [method, path] of [['get', '/assessment-questions'], ['post', '/assessment-questions'], ['get', '/assessments'], ['post', '/assessments'], ['get', `/assessments/${id}`], ['post', `/assessments/${id}/publish`], ['get', `/assessments/${id}/results`], ['get', `/assessments/${id}/analytics`], ['get', `/assessments/${id}/results/export`]] as const) {
      const r = await (request(app) as any)[method](B + path).set(auth(s1)).send({});
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    for (const path of ['/my/assessments', '/practice/problems', '/practice/assessments']) expect((await get(officer, path)).status, path).toBe(403);
    expect((await post(officer, `/my/assessments/${id}/start`)).status).toBe(403);
    expect((await request(app).get(B + '/assessments')).status).toBe(401);
    expect((await request(app).get(B + '/attempts/' + randomUUID())).status).toBe(401);
  });

  it('students only see tests they were invited to; attempts are private', async () => {
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }], { students: [s1] });
    expect((await get(s2, `/my/assessments/${id}`)).status).toBe(404);
    expect((await start(s2, id)).status).toBe(404);
    expect((await get(s2, '/my/assessments')).body.items).toHaveLength(0);
    const at = (await start(s1, id)).body.attempt.id;
    for (const [m, p] of [['get', `/attempts/${at}`], ['get', `/attempts/${at}/questions`], ['put', `/attempts/${at}/answers`], ['post', `/attempts/${at}/submit`], ['get', `/attempts/${at}/result`]] as const) {
      const r = await (request(app) as any)[m](B + p).set(auth(s2)).send({ answers: [ans(aq(0), 'b')] });
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    expect((await get(s1, `/my/assessments/${id}`)).body.assessment).toMatchObject({ id, attemptsUsed: 0, activeAttempt: { id: at } });
    const drafts = await post(officer, '/assessments', { title: 'Draft' });
    expect((await get(s1, `/my/assessments/${drafts.body.assessment.id}`)).status).toBe(404);
  });

  it('isolates tenants completely', async () => {
    const other = await makeOtherTenant('a');
    const q = await bank(mcq());
    const { id, aq } = await liveAssessment([{ id: q }], { students: [s1] });
    const at = await takeTest(s1, id, [[aq(0), 'b']]);
    for (const p of [`/assessments/${id}`, `/assessments/${id}/results`, `/assessments/${id}/analytics`, `/assessments/${id}/audience`, `/assessments/${id}/preview`, `/assessments/${id}/attempts/${at}`, `/assessment-questions/${q}`]) {
      expect((await get(other.officer, p)).status, p).toBe(404);
    }
    expect((await post(other.officer, `/assessments/${id}/publish`)).status).toBe(404);
    expect((await post(other.officer, `/assessments/${id}/regrade`, { reason: 'abc' })).status).toBe(404);
    expect((await put(other.officer, `/assessments/${id}`, { instructions: 'x' })).status).toBe(404);
    expect((await put(other.officer, `/assessments/${id}/attempts/${at}/override`, { score: 1, reason: 'abc' })).status).toBe(404);
    expect((await get(other.officer, '/assessments')).body.items).toHaveLength(0);
    expect((await get(other.officer, '/assessment-questions')).body.items).toHaveLength(0);
    expect((await get(other.student, '/my/assessments')).body.items).toHaveLength(0);
    expect((await start(other.student, id)).status).toBe(404);
    // a foreign student id in the audience never resolves; foreign question ids are rejected
    const mine = await post(officer, '/assessments', { title: 'X', audience: { type: 'students', studentIds: [other.student.id] }, sections: [{ title: 'S', questions: [{ questionId: q }] }], durationMinutes: 10, opensAt: new Date(Date.now() + 3600_000).toISOString(), closesAt: new Date(Date.now() + 7200_000).toISOString() });
    expect((await get(officer, `/assessments/${mine.body.assessment.id}/audience`)).body.count).toBe(0);
    const foreignQ = await post(other.officer, '/assessment-questions', mcq());
    expect(foreignQ.status).toBe(201);
    const bad = await post(officer, '/assessments', { title: 'Y', sections: [{ title: 'S', questions: [{ questionId: foreignQ.body.question.id }] }] });
    expect(bad.status).toBe(400);
    expect((await get(other.officer, `/practice/problems`)).status).toBe(403);
    // practice problems are per tenant
    await bank(coding({ practice: true }));
    expect((await get(other.student, '/practice/problems')).body.items).toHaveLength(0);
  });
});

describe('demo seed', () => {
  it('creates a live test, a completed test with graded attempts and a practice set', async () => {
    const { seedAssessmentDemo } = await import('../src/assessments/seed');
    const out: any = await seedAssessmentDemo(pool);
    expect(out.questions).toBe(13);
    const live = await get(s1, '/my/assessments?bucket=live');
    expect(live.body.items).toHaveLength(1);
    const past = await get(s1, '/my/assessments?bucket=past');
    expect(past.body.items).toHaveLength(1);
    expect(past.body.items[0].myScore).toMatchObject({ score: expect.any(Number) });
    const table = await get(officer, `/assessments/${out.done}/results`);
    expect(table.body.summary.participants).toBe(3);
    expect(table.body.items[0].rank).toBe(1);
    expect((await get(s1, '/practice/problems')).body.items).toHaveLength(3);
    expect((await get(s1, '/practice/assessments')).body.items).toHaveLength(1);
    // every seeded question is valid enough to publish a fresh test from
    const qs = (await get(officer, '/assessment-questions?limit=50')).body.items;
    expect(qs.length).toBe(13);
  });
});
