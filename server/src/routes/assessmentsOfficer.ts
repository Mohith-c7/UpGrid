import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { withTx } from '../db';
import { ApiError, badRequest, conflict, notFound, parse, unprocessable, wrap } from '../errors';
import { createNotification } from '../notify';
import { STATUSES } from './applications';
import { num } from '../assessments/bank';
import { orderedQuestions, studentQuestion } from '../assessments/attempts';
import { bestSubmission } from '../assessments/attempts';
import { correctAnswerOf, analytics, csvForResults, filterSortRows, plagiarism, regradeAssessment, resultReleased, resultRows, shortlist } from '../assessments/results';
import { assessmentInput, mergeSettings, questionInput, validateQuestionShape } from '../assessments/schemas';
import {
  assessmentDto, audit, cancelReminders, iso, loadAssessment, loadStructure, notifyPublished, publishAssessment, pushToUsers, resolveFor, saveStructure,
  scheduleStartReminders, snapshotOf,
} from '../assessments/service';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const OPEN_STATUSES = STATUSES.filter((s) => s !== 'withdrawn' && s !== 'submitted');

export function assessmentsOfficerRouter(deps: Deps) {
  const { pool, push } = deps;
  const r = Router();
  r.use(authenticate(deps), requireRole('officer'));

  async function checkDrive(tenantId: string, driveId: unknown, field: string) {
    if (!driveId) return;
    const d = await pool.query('SELECT 1 FROM drives WHERE id=$1 AND tenant_id=$2', [driveId, tenantId]);
    if (!d.rowCount) throw badRequest('Drive not found', { [field]: 'Drive not found' });
  }
  function checkWindow(body: any, cur?: any) {
    const opens = body.opensAt !== undefined ? body.opensAt : cur?.opens_at;
    const closes = body.closesAt !== undefined ? body.closesAt : cur?.closes_at;
    if (opens && closes && new Date(closes).getTime() <= new Date(opens).getTime()) throw badRequest('closesAt must be after opensAt', { closesAt: 'Must be after opensAt' });
  }

  // ---------------------------------------------------------------- list / create / read / update
  r.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      status: z.enum(['draft', 'published', 'archived']).optional(), practice: z.enum(['1', '0', 'true', 'false']).optional(), q: z.string().max(100).optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const limit = pageLimit(q.limit); const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId]; let where = 'tenant_id=$1';
    if (q.status) { params.push(q.status); where += ` AND status=$${params.length}`; }
    if (q.practice) where += (q.practice === '1' || q.practice === 'true') ? ' AND is_practice' : ' AND NOT is_practice';
    if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (m: string) => '\\' + m)}%`); where += ` AND title ILIKE $${params.length}`; }
    const rows = (await pool.query(`SELECT * FROM assessments WHERE ${where} ORDER BY created_at DESC, id LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    const items = [];
    for (const a of rows.slice(0, limit)) items.push(await assessmentDto(pool, a, { summary: true }));
    res.json({ items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  r.post('/', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(assessmentInput.required({ title: true }), req.body ?? {});
    checkWindow(b);
    await checkDrive(u.tenantId, b.driveId, 'driveId');
    if (b.audience && 'driveId' in b.audience) await checkDrive(u.tenantId, b.audience.driveId, 'audience.driveId');
    const practice = b.practice === true;
    const settings = mergeSettings(null, b.settings);
    if (practice) settings.rankingEnabled = false;
    const id = await withTx(pool, async (c) => {
      const a = (await c.query(
        `INSERT INTO assessments (tenant_id, created_by, title, instructions, drive_id, audience, opens_at, closes_at, duration_minutes, settings, is_practice)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [u.tenantId, u.id, b.title, b.instructions ?? '', b.driveId ?? null, JSON.stringify(practice ? { type: 'all_students' } : b.audience ?? {}), b.opensAt ?? null, b.closesAt ?? null,
          b.durationMinutes ?? null, JSON.stringify(settings), practice])).rows[0].id as string;
      if (b.sections) await saveStructure(c, u.tenantId, a, b.sections);
      return a;
    });
    res.status(201).json({ assessment: await assessmentDto(pool, await loadAssessment(pool, u.tenantId, id)) });
  }));

  r.get('/:id', wrap(async (req, res) => {
    const a = await loadAssessment(pool, me(req).tenantId, pid(req));
    res.json({ assessment: await assessmentDto(pool, a) });
  }));

  r.put('/:id', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(assessmentInput, req.body ?? {});
    await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req), true);
      if (a.status === 'archived') throw conflict('ASSESSMENT_LOCKED', 'Archived assessments cannot be edited');
      if (a.status === 'published') {
        const bad: Record<string, string> = {};
        for (const k of Object.keys(b)) if (!['instructions', 'closesAt', 'settings'].includes(k)) bad[k] = 'Cannot be changed after publishing';
        if (b.settings) for (const k of Object.keys(b.settings)) if (!['resultVisibility', 'allowReview', 'proctoring'].includes(k)) bad[`settings.${k}`] = 'Cannot be changed after publishing';
        if (b.settings?.proctoring) for (const k of Object.keys(b.settings.proctoring)) if (k !== 'maxWarnings') bad[`settings.proctoring.${k}`] = 'Cannot be changed after publishing';
        if (b.closesAt && a.closes_at && new Date(b.closesAt).getTime() < new Date(a.closes_at).getTime()) bad.closesAt = 'The closing time can only move later';
        if (Object.keys(bad).length) throw conflict('ASSESSMENT_LOCKED', 'Only instructions, closing time and result settings can change after publishing', bad);
      }
      checkWindow(b, a);
      if (b.driveId !== undefined) await checkDrive(u.tenantId, b.driveId, 'driveId');
      if (b.audience && 'driveId' in b.audience) await checkDrive(u.tenantId, b.audience.driveId, 'audience.driveId');
      const settings = mergeSettings(a.settings, b.settings);
      const practice = b.practice !== undefined ? b.practice : a.is_practice;
      if (practice) settings.rankingEnabled = false;
      await c.query(
        `UPDATE assessments SET title=$3, instructions=$4, drive_id=$5, audience=$6, opens_at=$7, closes_at=$8, duration_minutes=$9, settings=$10, is_practice=$11, updated_at=now()
          WHERE id=$1 AND tenant_id=$2`,
        [a.id, u.tenantId, b.title ?? a.title, b.instructions ?? a.instructions, b.driveId !== undefined ? b.driveId : a.drive_id,
          JSON.stringify(practice ? { type: 'all_students' } : b.audience !== undefined ? b.audience ?? {} : a.audience),
          b.opensAt !== undefined ? b.opensAt : a.opens_at, b.closesAt !== undefined ? b.closesAt : a.closes_at,
          b.durationMinutes !== undefined ? b.durationMinutes : a.duration_minutes, JSON.stringify(settings), practice]);
      if (b.sections) {
        if (a.status !== 'draft') throw conflict('ASSESSMENT_LOCKED', 'Sections cannot be changed after publishing');
        await saveStructure(c, u.tenantId, a.id, b.sections);
      }
      if (a.status === 'published' && b.closesAt) await audit(c, u.tenantId, u.id, 'assessment.window_changed', { assessmentId: a.id, closesAt: b.closesAt });
    });
    res.json({ assessment: await assessmentDto(pool, await loadAssessment(pool, u.tenantId, pid(req))) });
  }));

  // ---------------------------------------------------------------- lifecycle
  r.post('/:id/publish', wrap(async (req, res) => {
    const u = me(req);
    const out = await publishAssessment(pool, push, u.tenantId, u.id, pid(req));
    res.json({ assessment: await assessmentDto(pool, out.a), audienceCount: out.audienceCount, notified: out.replayed ? 0 : out.a.is_practice ? 0 : out.notify.length, replayed: out.replayed });
  }));

  r.post('/:id/archive', wrap(async (req, res) => {
    const u = me(req);
    await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req), true);
      await c.query(`UPDATE assessments SET status='archived', updated_at=now() WHERE id=$1`, [a.id]);
      await cancelReminders(c, a.id);
      await audit(c, u.tenantId, u.id, 'assessment.archived', { assessmentId: a.id });
    });
    res.json({ assessment: await assessmentDto(pool, await loadAssessment(pool, u.tenantId, pid(req))) });
  }));

  r.post('/:id/clone', wrap(async (req, res) => {
    const u = me(req);
    const id = await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req));
      const { sections, questions } = await loadStructure(c, a.id);
      const settings = mergeSettings(a.settings);
      const n = (await c.query(
        `INSERT INTO assessments (tenant_id, created_by, title, instructions, drive_id, audience, duration_minutes, settings, is_practice)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [u.tenantId, u.id, `${a.title} (copy)`.slice(0, 150), a.instructions, a.drive_id, JSON.stringify(a.audience || {}), a.duration_minutes, JSON.stringify(settings), a.is_practice])).rows[0].id as string;
      const stillThere = new Set((await c.query(`SELECT id FROM aq_questions WHERE tenant_id=$1 AND status='active' AND id = ANY($2::uuid[])`, [u.tenantId, questions.map((q) => q.question_id).filter(Boolean)])).rows.map((x) => x.id));
      await saveStructure(c, u.tenantId, n, sections.map((s) => ({
        title: s.title, timeLimitMinutes: s.time_limit_minutes, cutoffMarks: num(s.cutoff_marks),
        questions: questions.filter((q) => q.section_id === s.id && stillThere.has(q.question_id)).map((q) => ({ questionId: q.question_id, marks: num(q.marks), negativeMarks: num(q.negative_marks) })),
      })));
      return n;
    });
    res.status(201).json({ assessment: await assessmentDto(pool, await loadAssessment(pool, u.tenantId, id)) });
  }));

  r.get('/:id/preview', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const seed = Number(req.query.seed ?? 1) || 1;
    const settings = mergeSettings(a.settings);
    const { sections, questions } = await loadStructure(pool, a.id);
    if (a.status === 'draft') {
      const bank = new Map((await pool.query('SELECT * FROM aq_questions WHERE tenant_id=$1 AND id = ANY($2::uuid[])', [u.tenantId, questions.map((q) => q.question_id)])).rows.map((x) => [x.id, x]));
      for (const q of questions) if (bank.get(q.question_id)) q.snapshot = snapshotOf(bank.get(q.question_id));
    }
    const fake = { seed };
    const ordered = orderedQuestions(fake, settings, sections, questions);
    let n = 0; const qs: any[] = [];
    for (const s of sections) for (const aq of ordered.get(s.id) || []) { n++; qs.push(studentQuestion(aq, n, fake, settings)); }
    res.json({
      assessment: { id: a.id, title: a.title, instructions: a.instructions, durationMinutes: a.duration_minutes, totalMarks: num(a.total_marks) }, settings,
      sections: sections.map((s) => ({ id: s.id, title: s.title, timeLimitMinutes: s.time_limit_minutes, cutoffMarks: num(s.cutoff_marks), questionIds: (ordered.get(s.id) || []).map((x: any) => x.id) })),
      questions: qs, serverNow: new Date().toISOString(),
    });
  }));

  r.get('/:id/audience', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const { ids, error } = await resolveFor(pool, a);
    const sample = ids.length ? (await pool.query('SELECT id, name FROM users WHERE id = ANY($1::uuid[]) ORDER BY name LIMIT 10', [ids])).rows : [];
    res.json({ count: ids.length, sample, ...(error ? { unresolved: error } : {}) });
  }));

  r.post('/:id/audience/refresh', wrap(async (req, res) => {
    const u = me(req);
    const out = await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req), true);
      if (a.status !== 'published') throw conflict('ASSESSMENT_LOCKED', 'Only published assessments have a materialised audience');
      const { ids, error } = await resolveFor(c, a);
      if (error) throw unprocessable('NOT_PUBLISHABLE', error, { audience: error });
      const have = new Set((await c.query('SELECT user_id FROM assessment_audience WHERE assessment_id=$1', [a.id])).rows.map((x) => x.user_id));
      const fresh = ids.filter((x) => !have.has(x));
      if (fresh.length) {
        await c.query(`INSERT INTO assessment_audience (assessment_id, user_id, tenant_id) SELECT $1, x, $2 FROM unnest($3::uuid[]) AS x ON CONFLICT DO NOTHING`, [a.id, u.tenantId, fresh]);
        if (a.opens_at && new Date(a.opens_at).getTime() > Date.now()) { await notifyPublished(c, a, fresh); await scheduleStartReminders(c, a, fresh); }
      }
      const total = Number((await c.query('SELECT count(*) FROM assessment_audience WHERE assessment_id=$1', [a.id])).rows[0].count);
      return { a, fresh, total };
    });
    if (out.fresh.length && !out.a.is_practice) await pushToUsers(pool, push, out.fresh, { title: `New test: ${out.a.title}`, body: 'A new test was assigned to you.', data: { assessmentId: out.a.id } });
    res.json({ added: out.fresh.length, audienceCount: out.total });
  }));

  // ---------------------------------------------------------------- answer key correction + regrade
  r.put('/:id/questions/:aqId/key', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({
      reason: z.string().trim().min(3, 'Give a reason').max(300), answer: z.record(z.string(), z.any()).optional(), marks: z.number().min(0.25).max(100).optional(),
      negativeMarks: z.number().min(0).max(100).optional(), explanation: z.string().max(5000).optional(),
    }).strict(), req.body ?? {});
    await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req), true);
      if (a.status === 'draft') throw conflict('ASSESSMENT_LOCKED', 'Edit the question bank for draft assessments');
      const aq = (await c.query('SELECT * FROM assessment_questions WHERE id=$1 AND assessment_id=$2', [String(req.params.aqId), a.id])).rows[0];
      if (!aq) throw notFound('Question not found', 'QUESTION_NOT_FOUND');
      const snap = { ...aq.snapshot };
      if (b.answer) snap.answer = b.answer;
      if (b.explanation !== undefined) snap.explanation = b.explanation;
      const marks = b.marks ?? Number(aq.marks); const neg = b.negativeMarks ?? Number(aq.negative_marks);
      const parsed = questionInput.safeParse({ type: snap.type, title: snap.title, body: snap.body, topic: snap.topic, tags: snap.tags, difficulty: snap.difficulty, marks, negativeMarks: neg, explanation: snap.explanation, options: snap.options, answer: snap.answer, coding: snap.coding });
      const shape = parsed.success ? validateQuestionShape(parsed.data) : { answer: 'Invalid answer key' };
      if (Object.keys(shape).length) throw badRequest(String(Object.values(shape)[0]), shape);
      await c.query('UPDATE assessment_questions SET snapshot=$2, marks=$3, negative_marks=$4 WHERE id=$1', [aq.id, JSON.stringify(snap), marks, neg]);
      await c.query(`UPDATE assessments SET total_marks=(SELECT COALESCE(sum(marks),0) FROM assessment_questions WHERE assessment_id=$1), updated_at=now() WHERE id=$1`, [a.id]);
      await audit(c, u.tenantId, u.id, 'assessment.key_corrected', { assessmentId: a.id, questionId: aq.id, reason: b.reason, answerChanged: !!b.answer, marks, negativeMarks: neg });
    });
    res.json({ assessment: await assessmentDto(pool, await loadAssessment(pool, u.tenantId, pid(req))), needsRegrade: true });
  }));

  r.post('/:id/regrade', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300), rejudge: z.boolean().default(false) }).strict(), req.body ?? {});
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    res.json(await regradeAssessment(pool, u.tenantId, u.id, a, b.reason, b.rejudge));
  }));

  // ---------------------------------------------------------------- results
  r.get('/:id/results', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      q: z.string().max(100).optional(), status: z.enum(['submitted', 'in_progress', 'not_attempted']).optional(), passed: z.enum(['1', '0']).optional(),
      flagged: z.enum(['1', '0']).optional(), sort: z.enum(['rank', 'score', 'name', 'time']).optional(), cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const limit = pageLimit(q.limit); const offset = decodeCursor(q.cursor);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const { rows, summary, released } = await resultRows(pool, a, new Date());
    const list = filterSortRows(rows, q);
    res.json({ summary, released, items: list.slice(offset, offset + limit), nextCursor: list.length > offset + limit ? encodeCursor(offset + limit) : null });
  }));

  r.get('/:id/results/export', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const { rows, sections } = await resultRows(pool, a, new Date());
    const csv = csvForResults(filterSortRows(rows, { sort: 'rank' }), sections);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="assessment-${a.id}-results.csv"` }).send(csv);
  }));

  r.get('/:id/analytics', wrap(async (req, res) => {
    const a = await loadAssessment(pool, me(req).tenantId, pid(req));
    res.json(await analytics(pool, a, new Date()));
  }));

  r.get('/:id/plagiarism', wrap(async (req, res) => {
    const q = parse<any>(z.object({ threshold: z.coerce.number().min(0.3).max(1).default(0.85) }), req.query);
    const a = await loadAssessment(pool, me(req).tenantId, pid(req));
    const p = await plagiarism(pool, a, q.threshold);
    res.json({ threshold: p.threshold, pairs: p.pairs });
  }));

  r.post('/:id/results/publish', wrap(async (req, res) => {
    const u = me(req);
    const out = await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req), true);
      if (a.status === 'draft') throw conflict('ASSESSMENT_LOCKED', 'Publish the assessment first');
      if (a.results_published_at) return { a, notified: [] as string[], already: true };
      const upd = (await c.query('UPDATE assessments SET results_published_at=now(), updated_at=now() WHERE id=$1 RETURNING *', [a.id])).rows[0];
      const users = (await c.query(`SELECT DISTINCT user_id FROM assessment_attempts WHERE assessment_id=$1 AND status='submitted' AND NOT is_practice`, [a.id])).rows.map((x) => x.user_id as string);
      for (const uid of users) await createNotification(c, u.tenantId, uid, 'assessment_result', `Results out: ${a.title}`, 'Your result is now available.', { assessmentId: a.id });
      await audit(c, u.tenantId, u.id, 'assessment.results_published', { assessmentId: a.id, notified: users.length });
      return { a: upd, notified: users, already: false };
    });
    if (out.notified.length) await pushToUsers(pool, push, out.notified, { title: `Results out: ${out.a.title}`, body: 'Your result is now available.', data: { assessmentId: out.a.id } });
    res.json({ released: true, resultsPublishedAt: iso(out.a.results_published_at), notified: out.notified.length, alreadyPublished: out.already });
  }));

  r.post('/:id/results/unpublish', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const upd = (await pool.query('UPDATE assessments SET results_published_at=NULL, updated_at=now() WHERE id=$1 RETURNING *', [a.id])).rows[0];
    await audit(pool, u.tenantId, u.id, 'assessment.results_unpublished', { assessmentId: a.id });
    res.json({ released: resultReleased(upd, new Date()), resultsPublishedAt: null });
  }));

  r.post('/:id/shortlist', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({
      minScore: z.number().min(-100000).max(100000).optional(), topN: z.number().int().min(1).max(10000).optional(), driveId: z.string().uuid().optional(),
      toStatus: z.enum(OPEN_STATUSES as [string, ...string[]], { message: `toStatus must be one of ${OPEN_STATUSES.join(', ')}` }), dryRun: z.boolean().default(true), note: z.string().trim().max(300).optional(),
    }).strict().refine((v) => (v.minScore === undefined) !== (v.topN === undefined), { message: 'Provide exactly one of minScore or topN', path: ['minScore'] }), req.body ?? {});
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    res.json(await shortlist(pool, push, u.tenantId, u.id, a, b));
  }));

  // ---------------------------------------------------------------- answer sheet + override
  const loadAttempt = async (tenantId: string, assessmentId: string, attemptId: string) => {
    const att = (await pool.query('SELECT * FROM assessment_attempts WHERE id=$1 AND assessment_id=$2 AND tenant_id=$3', [attemptId, assessmentId, tenantId])).rows[0];
    if (!att) throw notFound('Attempt not found', 'ATTEMPT_NOT_FOUND');
    return att;
  };

  r.get('/:id/attempts/:attemptId', wrap(async (req, res) => {
    const u = me(req);
    const a = await loadAssessment(pool, u.tenantId, pid(req));
    const att = await loadAttempt(u.tenantId, a.id, String(req.params.attemptId));
    const student = (await pool.query(`SELECT u.id, u.name, u.email, p.data->'identity'->>'registrationNumber' AS reg FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`, [att.user_id])).rows[0];
    const { sections, questions } = await loadStructure(pool, a.id);
    const answers = new Map((await pool.query('SELECT * FROM assessment_answers WHERE attempt_id=$1', [att.id])).rows.map((x) => [x.aq_id, x]));
    const subs = (await pool.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND kind='submit' ORDER BY created_at`, [att.id])).rows;
    const events = (await pool.query('SELECT type, client_ts, created_at, counted FROM assessment_proctor_events WHERE attempt_id=$1 ORDER BY id', [att.id])).rows;
    let n = 0; const out: any[] = [];
    for (const s of sections) for (const aq of questions.filter((x) => x.section_id === s.id)) {
      n++;
      const an = answers.get(aq.id);
      const mine = subs.filter((x) => x.aq_id === aq.id);
      const best = aq.snapshot.type === 'coding' ? bestSubmission(aq, mine) : null;
      out.push({
        questionId: aq.id, sectionId: s.id, number: n, type: aq.snapshot.type, title: aq.snapshot.title, answer: an?.answer ?? null, correctAnswer: correctAnswerOf(aq.snapshot),
        correct: an?.correct ?? 'unanswered', score: an?.score === null || an?.score === undefined ? 0 : Number(an.score), maxScore: num(aq.marks), timeSpentMs: an?.time_spent_ms ?? 0, flagged: an?.flagged ?? false,
        ...(aq.snapshot.type === 'coding' ? {
          bestSubmissionId: best?.sub.id ?? null,
          submissions: mine.map((x) => ({ id: x.id, language: x.language, status: x.status, source: x.source, verdict: x.verdict, passed: x.passed, total: x.total, score: Number(x.score), createdAt: iso(x.created_at), code: x.code, tests: x.results })),
        } : {}),
      });
    }
    res.json({
      attempt: {
        id: att.id, attemptNo: att.attempt_no, status: att.status, submitReason: att.submit_reason, startedAt: iso(att.started_at), deadlineAt: iso(att.deadline_at), submittedAt: iso(att.submitted_at),
        evaluation: att.evaluation, score: att.score === null ? null : Number(att.score), maxScore: att.max_score === null ? null : Number(att.max_score), passed: att.passed, warnings: att.warnings,
        effectiveScore: att.score_override !== null ? Number(att.score_override) : att.score === null ? null : Number(att.score),
      },
      student: { id: student.id, name: student.name, email: student.email, registrationNumber: student.reg ?? null },
      answers: out,
      proctorEvents: events.map((e) => ({ type: e.type, clientTs: e.client_ts === null ? null : Number(e.client_ts), createdAt: iso(e.created_at), counted: e.counted })),
      override: att.score_override === null ? null : { score: Number(att.score_override), reason: att.override_reason, at: iso(att.override_at), by: att.override_by },
    });
  }));

  r.put('/:id/attempts/:attemptId/override', wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ score: z.number().nullable(), reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      const a = await loadAssessment(c, u.tenantId, pid(req));
      const att = (await c.query('SELECT * FROM assessment_attempts WHERE id=$1 AND assessment_id=$2 AND tenant_id=$3 FOR UPDATE', [String(req.params.attemptId), a.id, u.tenantId])).rows[0];
      if (!att) throw notFound('Attempt not found', 'ATTEMPT_NOT_FOUND');
      if (att.status !== 'submitted') throw conflict('ATTEMPT_NOT_SUBMITTED', 'Only submitted attempts can be overridden');
      const max = Number(att.max_score ?? a.total_marks);
      if (b.score !== null && (b.score < 0 || b.score > max)) throw badRequest(`Score must be between 0 and ${max}`, { score: `Must be between 0 and ${max}` });
      await c.query(
        b.score === null
          ? 'UPDATE assessment_attempts SET score_override=NULL, override_reason=NULL, override_by=NULL, override_at=NULL WHERE id=$1'
          : 'UPDATE assessment_attempts SET score_override=$2, override_reason=$3, override_by=$4, override_at=now() WHERE id=$1',
        b.score === null ? [att.id] : [att.id, b.score, b.reason, u.id]);
      const { gradeAttempt } = await import('../assessments/attempts');
      await gradeAttempt(c, att.id);
      await audit(c, u.tenantId, u.id, 'assessment.score_override', { assessmentId: a.id, attemptId: att.id, from: att.score_override === null ? att.score : att.score_override, to: b.score, reason: b.reason });
      return (await c.query('SELECT * FROM assessment_attempts WHERE id=$1', [att.id])).rows[0];
    });
    res.json({ attempt: { id: out.id, score: Number(out.score), effectiveScore: out.score_override === null ? Number(out.score) : Number(out.score_override), passed: out.passed, override: out.score_override === null ? null : { score: Number(out.score_override), reason: out.override_reason } } });
  }));

  void ApiError;
  return r;
}
