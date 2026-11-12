import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { ApiError, notFound, parse, wrap } from '../errors';
import {
  attemptDto, attemptState, enterSection, finalizeAttempt, loadMyAssessment, loadMyAttempt, PROCTOR_TYPES, recordEvents, saveAnswers, startAttempt, submitAttempt,
} from '../assessments/attempts';
import { num } from '../assessments/bank';
import { JudgeQueuedError, loadPracticeProblem, RateLimitedError, runInAttempt, runPractice, submitCodeInAttempt, submitPractice } from '../assessments/code';
import { studentResult, resultReleased } from '../assessments/results';
import { mergeSettings } from '../assessments/schemas';
import { iso, loadAssessment, loadStructure } from '../assessments/service';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const answerItem = z.object({
  questionId: z.string().uuid('Must be a valid id'), answer: z.any().optional(), flagged: z.boolean().optional(),
  clientTs: z.number().int().min(0).max(8_640_000_000_000_000), timeSpentMs: z.number().int().min(0).max(86_400_000).optional(),
}).strict();
const answersBody = z.object({ answers: z.array(answerItem).min(1, 'Send at least one answer').max(100, 'At most 100 answers per request') }).strict();

/** Maps the code-execution errors that need extra response data / headers. */
const codeErrors = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof RateLimitedError) {
    res.set('Retry-After', String(err.retryAfterSeconds));
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: err.message } });
  }
  if (err instanceof JudgeQueuedError) {
    return res.status(503).json({ error: { code: err.code, message: err.message }, ...(err.submissionId ? { submission: { id: err.submissionId, status: 'pending_judge' } } : {}) });
  }
  return next(err);
};

type Bucket = 'upcoming' | 'live' | 'past';

export function assessmentsStudentRouters(deps: Deps) {
  const { pool } = deps;

  // ---------------------------------------------------------------- /my/assessments
  const mine = Router();
  mine.use(authenticate(deps), requireRole('student'));

  async function summarize(a: any, userId: string, now: Date) {
    const settings = mergeSettings(a.settings);
    const atts = (await pool.query('SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 ORDER BY attempt_no', [a.id, userId])).rows;
    const used = atts.filter((x) => x.status === 'submitted').length;
    const active = atts.find((x) => x.status === 'in_progress') || null;
    const opens = a.opens_at ? new Date(a.opens_at).getTime() : 0;
    const closes = a.closes_at ? new Date(a.closes_at).getTime() : Infinity;
    let bucket: Bucket;
    if (now.getTime() < opens) bucket = 'upcoming';
    else if (now.getTime() >= closes) bucket = 'past';
    else bucket = used >= settings.maxAttempts && !active ? 'past' : 'live';
    const released = resultReleased(a, now);
    const best = atts.filter((x) => x.status === 'submitted' && x.evaluation === 'complete')
      .reduce((b: any, x) => (!b || (x.score_override ?? x.score) > (b.score_override ?? b.score) ? x : b), null);
    let drive: any = null;
    if (a.drive_id) { const d = (await pool.query('SELECT id, company, role FROM drives WHERE id=$1', [a.drive_id])).rows[0]; if (d) drive = { id: d.id, company: d.company?.name ?? null, role: d.role }; }
    const eff = best ? Number(best.score_override ?? best.score) : 0;
    const max = best ? Number(best.max_score) : 0;
    return {
      id: a.id, title: a.title, drive, opensAt: iso(a.opens_at), closesAt: iso(a.closes_at), durationMinutes: a.duration_minutes, totalMarks: num(a.total_marks), questionCount: a.question_count,
      sectionCount: Number((await pool.query('SELECT count(*) FROM assessment_sections WHERE assessment_id=$1', [a.id])).rows[0].count),
      bucket, attemptsAllowed: settings.maxAttempts, attemptsUsed: used, activeAttempt: active ? { id: active.id, deadlineAt: iso(active.deadline_at) } : null,
      canStart: bucket === 'live', resultReleased: released,
      myScore: best && released ? { score: eff, maxScore: max, percent: max ? Math.round((eff / max) * 10000) / 100 : 0, passed: best.passed } : null,
      serverNow: now.toISOString(), attempts: atts.map((x) => ({ id: x.id, attemptNo: x.attempt_no, status: x.status, startedAt: iso(x.started_at), submittedAt: iso(x.submitted_at), evaluation: x.evaluation })),
    };
  }

  mine.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({ bucket: z.enum(['upcoming', 'live', 'past', 'all']).default('all'), cursor: z.string().optional(), limit: z.string().optional() }), req.query);
    const limit = pageLimit(q.limit); const offset = decodeCursor(q.cursor);
    const now = new Date();
    const rows = (await pool.query(
      `SELECT a.* FROM assessments a JOIN assessment_audience au ON au.assessment_id=a.id AND au.user_id=$2
        WHERE a.tenant_id=$1 AND a.status='published' AND NOT a.is_practice`, [u.tenantId, u.id])).rows;
    let items = await Promise.all(rows.map((a) => summarize(a, u.id, now)));
    if (q.bucket !== 'all') items = items.filter((i) => i.bucket === q.bucket);
    const order = { live: 0, upcoming: 1, past: 2 } as const;
    items.sort((x, y) => order[x.bucket] - order[y.bucket] || (x.bucket === 'past' ? new Date(y.closesAt!).getTime() - new Date(x.closesAt!).getTime() : new Date(x.opensAt!).getTime() - new Date(y.opensAt!).getTime()));
    res.json({ items: items.slice(offset, offset + limit).map(({ attempts, ...rest }) => { void attempts; return rest; }), nextCursor: items.length > offset + limit ? encodeCursor(offset + limit) : null });
  }));

  mine.get('/:id', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadMyAssessment(pool, u, pid(req));
    const now = new Date();
    const s = await summarize(a, u.id, now);
    const { sections } = await loadStructure(pool, a.id);
    const counts = (await pool.query('SELECT section_id, count(*)::int AS n FROM assessment_questions WHERE assessment_id=$1 GROUP BY section_id', [a.id])).rows;
    const settings = mergeSettings(a.settings);
    const { attempts, ...rest } = s;
    res.json({
      assessment: {
        ...rest, instructions: a.instructions, practice: a.is_practice,
        sections: sections.map((x) => ({ id: x.id, title: x.title, timeLimitMinutes: x.time_limit_minutes, cutoffMarks: num(x.cutoff_marks), questionCount: counts.find((c) => c.section_id === x.id)?.n ?? 0 })),
        settings: {
          negativeMarking: settings.negativeMarking, proctoring: settings.proctoring, resultVisibility: settings.resultVisibility, allowReview: settings.allowReview,
          rankingEnabled: settings.rankingEnabled && !a.is_practice, maxAttempts: a.is_practice ? null : settings.maxAttempts, randomised: settings.randomiseQuestions || settings.randomiseOptions,
        },
      },
      attempts, serverNow: now.toISOString(),
    });
  }));

  mine.post('/:id/start', wrap(async (req, res) => {
    const u = me(req);
    const out = await startAttempt(pool, u, pid(req));
    res.status(out.resumed ? 200 : 201).json({ resumed: out.resumed, ...out.state });
  }));

  // ---------------------------------------------------------------- /attempts
  const att = Router();
  att.use(authenticate(deps), requireRole('student'));

  const stateOf = async (req: Request) => {
    const u = me(req);
    let a0 = await loadMyAttempt(pool, u, pid(req));
    const now = new Date();
    if (a0.status === 'in_progress' && now.getTime() >= new Date(a0.deadline_at).getTime() + 5000) {
      a0 = (await finalizeAttempt(pool, a0.id, 'deadline', now)).attempt;
    }
    const a = await loadAssessment(pool, u.tenantId, a0.assessment_id);
    return attemptState(pool, a0, a, now);
  };
  att.get('/:id', wrap(async (req, res) => res.json(await stateOf(req))));
  att.get('/:id/questions', wrap(async (req, res) => { const s = await stateOf(req); res.json({ attempt: s.attempt, serverNow: s.serverNow, sections: s.sections, questions: s.questions }); }));

  att.put('/:id/answers', wrap(async (req, res) => {
    const body = parse<z.infer<typeof answersBody>>(answersBody, req.body ?? {});
    res.json(await saveAnswers(pool, me(req), pid(req), body.answers as any));
  }));

  att.post('/:id/sections/:sectionId/enter', wrap(async (req, res) => {
    res.json(await enterSection(pool, me(req), pid(req), String(req.params.sectionId)));
  }));

  att.post('/:id/events', wrap(async (req, res) => {
    const body = parse<any>(z.object({
      events: z.array(z.object({ type: z.enum(PROCTOR_TYPES, { message: `type must be one of ${PROCTOR_TYPES.join(', ')}` }), clientTs: z.number().int().min(0).optional(), eventId: z.string().min(1).max(64).optional() }).strict()).min(1).max(20),
    }).strict(), req.body ?? {});
    res.json(await recordEvents(pool, me(req), pid(req), body.events));
  }));

  att.post('/:id/submit', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<any>(z.object({ answers: answersBody.shape.answers.optional() }).strict(), req.body ?? {});
    const out = await submitAttempt(pool, u, pid(req), body.answers);
    const a = out.a;
    const now = new Date();
    const reloaded = (await pool.query('SELECT * FROM assessment_attempts WHERE id=$1', [out.att.id])).rows[0];
    res.json({
      attempt: { id: reloaded.id, status: reloaded.status, submitReason: reloaded.submit_reason, submittedAt: iso(reloaded.submitted_at), evaluation: reloaded.evaluation },
      replayed: out.replayed, resultAvailable: reloaded.evaluation === 'complete' && resultReleased(a, now),
    });
  }));

  att.get('/:id/result', wrap(async (req, res) => {
    const u = me(req);
    const at = await loadMyAttempt(pool, u, pid(req));
    if (at.status !== 'submitted') throw new ApiError(409, 'ATTEMPT_NOT_SUBMITTED', 'Submit the attempt to see the result');
    const a = await loadAssessment(pool, u.tenantId, at.assessment_id);
    res.json(await studentResult(pool, at, a, new Date()));
  }));

  att.post('/:id/run', wrap(async (req, res) => {
    const b = parse<any>(z.object({ questionId: z.string().uuid(), language: z.any(), code: z.any(), stdin: z.any().optional() }).strict(), req.body ?? {});
    res.json(await runInAttempt(pool, me(req), pid(req), b));
  }));
  att.post('/:id/questions/:qid/submit-code', wrap(async (req, res) => {
    const b = parse<any>(z.object({ language: z.any(), code: z.any() }).strict(), req.body ?? {});
    res.json(await submitCodeInAttempt(pool, me(req), pid(req), String(req.params.qid), b));
  }));
  att.use(codeErrors);

  // ---------------------------------------------------------------- /practice
  const prac = Router();
  prac.use(authenticate(deps), requireRole('student'));

  prac.get('/assessments', wrap(async (req, res) => {
    const u = me(req);
    const rows = (await pool.query(`SELECT * FROM assessments WHERE tenant_id=$1 AND status='published' AND is_practice ORDER BY published_at DESC, id`, [u.tenantId])).rows;
    const items = [];
    for (const a of rows) {
      const st = (await pool.query(`SELECT count(*)::int AS n, (SELECT score FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND status='submitted' ORDER BY submitted_at DESC LIMIT 1) AS last FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND status='submitted'`, [a.id, u.id])).rows[0];
      items.push({ id: a.id, title: a.title, durationMinutes: a.duration_minutes, questionCount: a.question_count, totalMarks: num(a.total_marks), attemptsUsed: st.n, lastScore: st.last === null ? null : Number(st.last) });
    }
    res.json({ items });
  }));

  prac.get('/problems', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      q: z.string().max(100).optional(), difficulty: z.enum(['easy', 'medium', 'hard']).optional(), topic: z.string().max(80).optional(), tag: z.string().max(40).optional(),
      status: z.enum(['solved', 'unsolved']).optional(), cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const limit = pageLimit(q.limit); const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId, u.id];
    let where = `q.tenant_id=$1 AND q.type='coding' AND q.practice AND q.status='active'`;
    if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (m: string) => '\\' + m)}%`); where += ` AND q.title ILIKE $${params.length}`; }
    if (q.difficulty) { params.push(q.difficulty); where += ` AND q.difficulty=$${params.length}`; }
    if (q.topic) { params.push(q.topic); where += ` AND lower(q.topic)=lower($${params.length})`; }
    if (q.tag) { params.push(q.tag.toLowerCase()); where += ` AND $${params.length} = ANY(q.tags)`; }
    if (q.status === 'solved') where += ' AND COALESCE(s.solved,false)'; if (q.status === 'unsolved') where += ' AND NOT COALESCE(s.solved,false)';
    const rows = (await pool.query(
      `SELECT q.id, q.title, q.difficulty, q.topic, q.tags, q.marks, q.coding->'languages' AS languages,
              COALESCE(s.attempted,false) AS attempted, COALESCE(s.solved,false) AS solved, COALESCE(s.best,0) AS best
         FROM aq_questions q LEFT JOIN (
           SELECT question_id, true AS attempted,
                  COALESCE(bool_or(status='judged' AND total>0 AND passed=total), false) AS solved,
                  COALESCE(max(CASE WHEN status='judged' AND total>0 THEN passed::numeric*100/total END), 0) AS best
             FROM assessment_code_submissions WHERE user_id=$2 AND kind='submit' AND question_id IS NOT NULL AND status <> 'error' GROUP BY question_id
         ) s ON s.question_id=q.id WHERE ${where} ORDER BY CASE q.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, q.created_at, q.id LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    res.json({
      items: rows.slice(0, limit).map((x) => ({ id: x.id, title: x.title, difficulty: x.difficulty, topic: x.topic, tags: x.tags, languages: x.languages, marks: num(x.marks), solved: x.solved, attempted: x.attempted, bestPercent: Math.round(Number(x.best) * 100) / 100 })),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    });
  }));

  prac.get('/problems/:id', wrap(async (req, res) => {
    const u = me(req);
    const q = await loadPracticeProblem(pool, u, pid(req));
    const last = (await pool.query(`SELECT language, code, verdict, passed, total, status FROM assessment_code_submissions WHERE user_id=$1 AND question_id=$2 AND kind='submit' ORDER BY created_at DESC LIMIT 1`, [u.id, q.id])).rows[0];
    const solved = (await pool.query(`SELECT 1 FROM assessment_code_submissions WHERE user_id=$1 AND question_id=$2 AND kind='submit' AND status='judged' AND total>0 AND passed=total LIMIT 1`, [u.id, q.id])).rowCount! > 0;
    const tcs = q.coding.testCases as any[];
    res.json({
      problem: {
        id: q.id, title: q.title, body: q.body, constraints: q.coding.constraints, difficulty: q.difficulty, topic: q.topic, tags: q.tags, languages: q.coding.languages,
        timeLimitMs: q.coding.timeLimitMs, memoryLimitMb: q.coding.memoryLimitMb, starterCode: q.coding.starterCode,
        samples: tcs.filter((t) => t.kind === 'sample').map((t) => ({ id: t.id, input: t.input, expectedOutput: t.expectedOutput, explanation: t.explanation })),
        solved, lastSubmission: last ? { language: last.language, code: last.code, verdict: last.verdict, passed: last.passed, total: last.total } : null,
      },
    });
  }));
  prac.post('/problems/:id/run', wrap(async (req, res) => {
    const b = parse<any>(z.object({ language: z.any(), code: z.any(), stdin: z.any().optional() }).strict(), req.body ?? {});
    res.json(await runPractice(pool, me(req), pid(req), b));
  }));
  prac.post('/problems/:id/submit', wrap(async (req, res) => {
    const b = parse<any>(z.object({ language: z.any(), code: z.any() }).strict(), req.body ?? {});
    res.json(await submitPractice(pool, me(req), pid(req), b));
  }));
  prac.use(codeErrors);

  void notFound; void attemptDto;
  return { mine, att, prac };
}
