import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, badRequest, conflict, notFound } from '../errors';
import { ANSWER_GRACE_MS, bestSubmission, finalizeAttempt, gradeAttempt, loadMyAttempt, orderedQuestions, sectionStatuses, submissionScore, type UserCtx } from './attempts';
import { num } from './bank';
import { codeHash } from './compare';
import { gradeCoding } from './grading';
import { evaluateCode, getJudge, JudgeUnavailableError, type CodeEvaluation, type Judge0Client, type TestSpec } from './judge';
import { LANGUAGES, MAX_CODE_CHARS, MAX_STDIN_CHARS, mergeSettings, type Language } from './schemas';
import { loadAssessment, loadStructure } from './service';

export const RUN_LIMIT = 20;
export const RUN_WINDOW_MIN = 10;
export const SUBMIT_LIMIT_PER_QUESTION = 50;

export class RateLimitedError extends ApiError {
  constructor(public retryAfterSeconds: number) { super(429, 'RATE_LIMITED', 'Too many code runs. Please wait a few minutes.'); }
}
/** Judge unavailable: the code was stored as pending_judge. */
export class JudgeQueuedError extends ApiError {
  constructor(public submissionId: string | null) { super(503, 'CODE_EXECUTION_UNAVAILABLE', 'Code execution is temporarily unavailable. Your code is saved and will be judged shortly.'); }
}
export const judgeDown = () => new ApiError(503, 'CODE_EXECUTION_UNAVAILABLE', 'Code execution is temporarily unavailable. Please try again shortly.');

const specs = (coding: any, kind?: 'sample' | 'hidden'): TestSpec[] =>
  (coding.testCases as any[]).filter((t) => !kind || t.kind === kind).map((t) => ({ id: t.id, kind: t.kind, input: t.input, expectedOutput: t.expectedOutput, weight: Number(t.weight), explanation: t.explanation }));

export function validateCodeInput(coding: any, language: unknown, code: unknown) {
  const fields: Record<string, string> = {};
  if (typeof language !== 'string' || !(LANGUAGES as readonly string[]).includes(language) || !(coding.languages as string[]).includes(language)) fields.language = 'Language is not allowed for this question';
  if (typeof code !== 'string' || !code.trim()) fields.code = 'Write some code first';
  else if (code.length > MAX_CODE_CHARS) fields.code = `Code must be at most ${MAX_CODE_CHARS} characters`;
  else if (code.includes('\u0000')) fields.code = 'Contains invalid characters';
  if (Object.keys(fields).length) throw badRequest(String(Object.values(fields)[0]), fields);
  return { language: language as Language, code: code as string };
}

/** What a student may see about one test result. */
function sampleView(o: any, t: TestSpec, ev: { stdout: string; stderr: string }) {
  return { id: o.id, verdict: o.verdict, passed: o.passed, input: t.input, expectedOutput: t.expectedOutput, stdout: ev.stdout.slice(0, 4000), stderr: ev.stderr.slice(0, 1000), timeMs: o.timeMs, memoryKb: o.memoryKb };
}

// ------------------------------------------------------------------ attempt context
interface CodeCtx { att: any; a: any; aq: any; user: UserCtx }

async function loadCodeCtx(pool: Pool, user: UserCtx, attemptId: string, aqId: string, now: Date): Promise<CodeCtx> {
  let expired = false;
  const ctx = await withTx(pool, async (c) => {
    const att = await loadMyAttempt(c, user, attemptId);
    if (att.status !== 'in_progress') throw conflict('ATTEMPT_ALREADY_SUBMITTED', 'This attempt has already been submitted');
    if (now.getTime() > new Date(att.deadline_at).getTime() + ANSWER_GRACE_MS) { expired = true; return null; }
    const a = await loadAssessment(c, user.tenantId, att.assessment_id);
    const { sections, questions } = await loadStructure(c, a.id);
    const aq = questions.find((q) => q.id === aqId);
    if (!aq || aq.snapshot?.type !== 'coding') throw notFound('Question not found', 'QUESTION_NOT_FOUND');
    const ordered = orderedQuestions(att, mergeSettings(a.settings), sections, questions);
    const secs = sectionStatuses(att, sections, new Map([...ordered].map(([k, v]) => [k, v.map((q) => q.id)])), now);
    const sec = secs.find((s) => s.id === aq.section_id);
    if (!sec || !sec.enteredAt || sec.locked) throw conflict('SECTION_CLOSED', 'That section is closed');
    return { att, a, aq, user };
  });
  if (expired || !ctx) {
    await finalizeAttempt(pool, attemptId, 'deadline', now);
    throw conflict('DEADLINE_PASSED', 'The time for this attempt is over. It has been submitted.');
  }
  return ctx;
}

// ------------------------------------------------------------------ run (samples / custom stdin)
async function reserveRun(pool: Pool, scope: { attemptId?: string; aqId?: string; userId: string; questionId?: string; tenantId: string }, language: string, now: Date) {
  return withTx(pool, async (c) => {
    const key = scope.attemptId ?? `${scope.userId}:${scope.questionId}`;
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`run:${key}`]);
    const since = new Date(now.getTime() - RUN_WINDOW_MIN * 60000);
    const rows = (await c.query(
      scope.attemptId
        ? `SELECT created_at FROM assessment_code_submissions WHERE kind='run' AND attempt_id=$1 AND created_at > $2 ORDER BY created_at`
        : `SELECT created_at FROM assessment_code_submissions WHERE kind='run' AND attempt_id IS NULL AND user_id=$1 AND question_id=$3 AND created_at > $2 ORDER BY created_at`,
      scope.attemptId ? [scope.attemptId, since] : [scope.userId, since, scope.questionId])).rows;
    if (rows.length >= RUN_LIMIT) {
      const wait = Math.max(1, Math.ceil((new Date(rows[0].created_at).getTime() + RUN_WINDOW_MIN * 60000 - now.getTime()) / 1000));
      throw new RateLimitedError(wait);
    }
    return (await c.query(
      `INSERT INTO assessment_code_submissions (tenant_id, user_id, attempt_id, aq_id, question_id, kind, source, language, code, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'run',$6,$7,'','queued',$8) RETURNING id`,
      [scope.tenantId, scope.userId, scope.attemptId ?? null, scope.aqId ?? null, scope.questionId ?? null, scope.attemptId ? 'student' : 'practice', language, now])).rows[0].id as string;
  });
}

async function doRun(pool: Pool, judge: Judge0Client, rowId: string, coding: any, language: Language, code: string, stdin: string | undefined) {
  try {
    if (stdin !== undefined) {
      const raw = await judge.execute([{ language, code, stdin }], { timeLimitMs: coding.timeLimitMs, memoryLimitMb: coding.memoryLimitMb });
      await pool.query(`UPDATE assessment_code_submissions SET status='judged', judged_at=now() WHERE id=$1`, [rowId]);
      const r = raw[0];
      const status = r.status === 'ok' ? 'completed' : r.status === 'compile_error' ? 'compile_error' : r.status === 'time_limit' ? 'time_limit_exceeded' : r.status === 'memory_limit' ? 'memory_limit_exceeded' : 'runtime_error';
      return { run: { mode: 'custom', compile: { ok: r.status !== 'compile_error', output: r.status === 'compile_error' ? (r.compileOutput || r.stderr).slice(0, 2000) : undefined }, results: [{ verdict: status, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 1000), timeMs: r.timeMs, memoryKb: r.memoryKb }] } };
    }
    const tests = specs(coding, 'sample');
    const ev = await evaluateCode(judge, { timeLimitMs: coding.timeLimitMs, memoryLimitMb: coding.memoryLimitMb, compare: coding.compare }, language, code, tests);
    await pool.query(`UPDATE assessment_code_submissions SET status='judged', verdict=$2, passed=$3, total=$4, judged_at=now() WHERE id=$1`, [rowId, ev.verdict, ev.passed, ev.total]);
    return {
      run: {
        mode: 'samples', verdict: ev.verdict, compile: { ok: ev.verdict !== 'compile_error', output: ev.compileOutput ? ev.compileOutput.slice(0, 2000) : undefined },
        results: ev.outcomes.map((o, i) => sampleView(o, tests[i], o)),
      },
    };
  } catch (e) {
    await pool.query(`UPDATE assessment_code_submissions SET status='error', judged_at=now() WHERE id=$1`, [rowId]).catch(() => undefined);
    if (e instanceof JudgeUnavailableError) throw judgeDown();
    throw e;
  }
}

export async function runInAttempt(pool: Pool, user: UserCtx, attemptId: string, body: { questionId: string; language: unknown; code: unknown; stdin?: unknown }, now = new Date()) {
  const ctx = await loadCodeCtx(pool, user, attemptId, body.questionId, now);
  const coding = ctx.aq.snapshot.coding;
  const { language, code } = validateCodeInput(coding, body.language, body.code);
  let stdin: string | undefined;
  if (body.stdin !== undefined && body.stdin !== null) {
    if (typeof body.stdin !== 'string' || body.stdin.length > MAX_STDIN_CHARS) throw badRequest('stdin must be text up to 10000 characters', { stdin: 'Must be text up to 10000 characters' });
    stdin = body.stdin;
  }
  const judge = getJudge();
  if (!judge.isConfigured()) throw judgeDown();
  const id = await reserveRun(pool, { attemptId, aqId: ctx.aq.id, userId: user.id, tenantId: user.tenantId }, language, now);
  return doRun(pool, judge, id, coding, language, code, stdin);
}

// ------------------------------------------------------------------ submit (all tests)
function storedResults(ev: CodeEvaluation) {
  return ev.outcomes.map((o) => ({ id: o.id, kind: o.kind, weight: o.weight, verdict: o.verdict, passed: o.passed, timeMs: o.timeMs, memoryKb: o.memoryKb }));
}

async function saveJudged(db: Db, id: string, ev: CodeEvaluation, marks: number) {
  const score = gradeCoding(marks, ev.outcomes.map((o) => ({ weight: o.weight, passed: o.passed }))).score;
  await db.query(
    `UPDATE assessment_code_submissions SET status='judged', verdict=$2, passed=$3, total=$4, score=$5, max_score=$6, results=$7, compile_output=$8, judged_at=now(), next_try_at=NULL WHERE id=$1`,
    [id, ev.verdict, ev.passed, ev.total, score, marks, JSON.stringify(storedResults(ev)), ev.compileOutput]);
  return score;
}

function submissionView(sub: { id: string; language: string; status: string }, ev: CodeEvaluation, tests: TestSpec[], score: number, marks: number) {
  const samples = ev.outcomes.map((o, i) => ({ o, t: tests[i] })).filter((x) => x.o.kind === 'sample').map((x) => sampleView(x.o, x.t, x.o));
  const hidden = ev.outcomes.filter((o) => o.kind === 'hidden');
  return {
    id: sub.id, language: sub.language, status: 'judged', verdict: ev.verdict, passed: ev.passed, total: ev.total, score, maxScore: marks,
    compileOutput: ev.compileOutput ? ev.compileOutput.slice(0, 2000) : undefined,
    samples, hiddenPassed: hidden.filter((o) => o.passed).length, hiddenTotal: hidden.length,
  };
}

export async function submitCodeInAttempt(pool: Pool, user: UserCtx, attemptId: string, aqId: string, body: { language: unknown; code: unknown }, now = new Date()) {
  const ctx = await loadCodeCtx(pool, user, attemptId, aqId, now);
  const coding = ctx.aq.snapshot.coding;
  const { language, code } = validateCodeInput(coding, body.language, body.code);
  const marks = num(ctx.aq.marks);
  const count = Number((await pool.query(`SELECT count(*) FROM assessment_code_submissions WHERE attempt_id=$1 AND aq_id=$2 AND kind='submit'`, [attemptId, aqId])).rows[0].count);
  if (count >= SUBMIT_LIMIT_PER_QUESTION) throw new RateLimitedError(60);
  const hash = codeHash(code);
  const judge = getJudge();
  const sub = (await pool.query(
    `INSERT INTO assessment_code_submissions (tenant_id, user_id, attempt_id, aq_id, kind, source, language, code, status, norm_hash, max_score, created_at)
     VALUES ($1,$2,$3,$4,'submit','student',$5,$6,$7,$8,$9,$10) RETURNING id, language`,
    [user.tenantId, user.id, attemptId, aqId, language, code, judge.isConfigured() ? 'queued' : 'pending_judge', hash, marks, now])).rows[0];
  if (!judge.isConfigured()) {
    await pool.query(`UPDATE assessment_code_submissions SET next_try_at=now() + interval '30 seconds' WHERE id=$1`, [sub.id]);
    throw new JudgeQueuedError(sub.id);
  }
  const tests = specs(coding);
  let ev: CodeEvaluation;
  try {
    ev = await evaluateCode(judge, { timeLimitMs: coding.timeLimitMs, memoryLimitMb: coding.memoryLimitMb, compare: coding.compare }, language, code, tests);
  } catch (e) {
    if (e instanceof JudgeUnavailableError) {
      await pool.query(`UPDATE assessment_code_submissions SET status='pending_judge', tries=1, next_try_at=now() + interval '30 seconds' WHERE id=$1`, [sub.id]);
      throw new JudgeQueuedError(sub.id);
    }
    await pool.query(`UPDATE assessment_code_submissions SET status='error' WHERE id=$1`, [sub.id]);
    throw e;
  }
  const prevBest = bestSubmission(ctx.aq, (await pool.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND aq_id=$2 AND kind='submit' AND status='judged' AND id <> $3`, [attemptId, aqId, sub.id])).rows);
  const score = await saveJudged(pool, sub.id, ev, marks);
  const best = bestSubmission(ctx.aq, (await pool.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND aq_id=$2 AND kind='submit' AND status='judged'`, [attemptId, aqId])).rows)!;
  return {
    submission: {
      ...submissionView(sub, ev, tests, score, marks),
      best: { passed: best.sub.passed, total: best.sub.total, score: best.score, verdict: best.sub.verdict },
      improved: best.sub.id === sub.id && (!prevBest || score > prevBest.score),
    },
  };
}

// ------------------------------------------------------------------ judge queue worker
export interface JudgeRunResult { judged: number; requeued: number; failed: number }
const MAX_TRIES = 8;

/** Re-judges pending_judge submissions. Claims rows with SKIP LOCKED, judges outside the transaction. */
export async function runJudgeQueue(pool: Pool, judge: Judge0Client = getJudge(), now = new Date(), batch = 20, onlyAttempt?: string): Promise<JudgeRunResult> {
  const res: JudgeRunResult = { judged: 0, requeued: 0, failed: 0 };
  if (!judge.isConfigured()) return res;
  const claimed = await withTx(pool, async (c) => {
    const rows = (await c.query(
      `SELECT s.* FROM assessment_code_submissions s
        WHERE s.status='pending_judge' AND (s.next_try_at IS NULL OR s.next_try_at <= $1) ${onlyAttempt ? 'AND s.attempt_id=$3' : ''}
        ORDER BY s.created_at LIMIT $2 FOR UPDATE SKIP LOCKED`, onlyAttempt ? [now, batch, onlyAttempt] : [now, batch])).rows;
    if (rows.length) await c.query(`UPDATE assessment_code_submissions SET next_try_at = $2::timestamptz + interval '3 minutes' WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id), now]);
    return rows;
  });
  const touched = new Set<string>();
  for (const s of claimed) {
    let coding: any; let marks: number;
    if (s.aq_id) {
      const aq = (await pool.query('SELECT marks, snapshot FROM assessment_questions WHERE id=$1', [s.aq_id])).rows[0];
      if (!aq) { await pool.query(`UPDATE assessment_code_submissions SET status='error' WHERE id=$1`, [s.id]); res.failed++; continue; }
      coding = aq.snapshot.coding; marks = num(aq.marks);
    } else {
      const q = (await pool.query('SELECT marks, coding FROM aq_questions WHERE id=$1', [s.question_id])).rows[0];
      if (!q) { await pool.query(`UPDATE assessment_code_submissions SET status='error' WHERE id=$1`, [s.id]); res.failed++; continue; }
      coding = q.coding; marks = num(q.marks);
    }
    try {
      const ev = await evaluateCode(judge, { timeLimitMs: coding.timeLimitMs, memoryLimitMb: coding.memoryLimitMb, compare: coding.compare }, s.language, s.code, specs(coding));
      await saveJudged(pool, s.id, ev, marks);
      res.judged++;
    } catch (e) {
      if (e instanceof JudgeUnavailableError) {
        const tries = s.tries + 1;
        if (tries >= MAX_TRIES) {
          await pool.query(`UPDATE assessment_code_submissions SET status='error', verdict='internal_error', tries=$2, judged_at=now() WHERE id=$1`, [s.id, tries]);
          res.failed++;
        } else {
          const delay = Math.min(30 * 2 ** tries, 600);
          await pool.query(`UPDATE assessment_code_submissions SET tries=$2, next_try_at=$3 WHERE id=$1`, [s.id, tries, new Date(now.getTime() + delay * 1000)]);
          res.requeued++;
        }
      } else {
        await pool.query(`UPDATE assessment_code_submissions SET status='error', verdict='internal_error' WHERE id=$1`, [s.id]);
        res.failed++;
      }
    }
    if (s.attempt_id) touched.add(s.attempt_id);
  }
  for (const attemptId of touched) {
    await withTx(pool, async (c) => {
      const att = (await c.query('SELECT status FROM assessment_attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0];
      if (att?.status === 'submitted') await gradeAttempt(c, attemptId, now);
    });
  }
  return res;
}

// ------------------------------------------------------------------ practice problems
export async function loadPracticeProblem(db: Db, user: UserCtx, id: string) {
  const q = (await db.query(`SELECT * FROM aq_questions WHERE id=$1 AND tenant_id=$2 AND type='coding' AND practice AND status='active'`, [id, user.tenantId])).rows[0];
  if (!q) throw notFound('Problem not found', 'QUESTION_NOT_FOUND');
  return q;
}

export async function runPractice(pool: Pool, user: UserCtx, id: string, body: { language: unknown; code: unknown; stdin?: unknown }, now = new Date()) {
  const q = await loadPracticeProblem(pool, user, id);
  const { language, code } = validateCodeInput(q.coding, body.language, body.code);
  let stdin: string | undefined;
  if (body.stdin !== undefined && body.stdin !== null) {
    if (typeof body.stdin !== 'string' || body.stdin.length > MAX_STDIN_CHARS) throw badRequest('stdin must be text up to 10000 characters', { stdin: 'Must be text up to 10000 characters' });
    stdin = body.stdin;
  }
  const judge = getJudge();
  if (!judge.isConfigured()) throw judgeDown();
  const rid = await reserveRun(pool, { userId: user.id, questionId: id, tenantId: user.tenantId }, language, now);
  return doRun(pool, judge, rid, q.coding, language, code, stdin);
}

export async function submitPractice(pool: Pool, user: UserCtx, id: string, body: { language: unknown; code: unknown }, now = new Date()) {
  const q = await loadPracticeProblem(pool, user, id);
  const { language, code } = validateCodeInput(q.coding, body.language, body.code);
  const marks = num(q.marks);
  const recent = Number((await pool.query(`SELECT count(*) FROM assessment_code_submissions WHERE user_id=$1 AND question_id=$2 AND kind='submit' AND created_at > $3`, [user.id, id, new Date(now.getTime() - RUN_WINDOW_MIN * 60000)])).rows[0].count);
  if (recent >= RUN_LIMIT) throw new RateLimitedError(60);
  const judge = getJudge();
  const sub = (await pool.query(
    `INSERT INTO assessment_code_submissions (tenant_id, user_id, question_id, kind, source, language, code, status, norm_hash, max_score, created_at, next_try_at)
     VALUES ($1,$2,$3,'submit','practice',$4,$5,$6,$7,$8,$9,$10) RETURNING id, language`,
    [user.tenantId, user.id, id, language, code, judge.isConfigured() ? 'queued' : 'pending_judge', codeHash(code), marks, now, judge.isConfigured() ? null : new Date(now.getTime() + 30000)])).rows[0];
  if (!judge.isConfigured()) throw new JudgeQueuedError(sub.id);
  const tests = specs(q.coding);
  try {
    const ev = await evaluateCode(judge, { timeLimitMs: q.coding.timeLimitMs, memoryLimitMb: q.coding.memoryLimitMb, compare: q.coding.compare }, language, code, tests);
    const score = await saveJudged(pool, sub.id, ev, marks);
    return { submission: { ...submissionView(sub, ev, tests, score, marks), solved: ev.passed === ev.total } };
  } catch (e) {
    if (e instanceof JudgeUnavailableError) {
      await pool.query(`UPDATE assessment_code_submissions SET status='pending_judge', tries=1, next_try_at=now() + interval '30 seconds' WHERE id=$1`, [sub.id]);
      throw new JudgeQueuedError(sub.id);
    }
    await pool.query(`UPDATE assessment_code_submissions SET status='error' WHERE id=$1`, [sub.id]);
    throw e;
  }
}

export { submissionScore };
