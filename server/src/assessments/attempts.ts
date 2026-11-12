import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, badRequest, conflict, notFound, unprocessable } from '../errors';
import { codeHash } from './compare';
import { aggregate, gradeCoding, gradeObjective, isAnswered, round2, type Correctness } from './grading';
import { newSeed, seededShuffle } from './random';
import { LANGUAGES, MAX_CODE_CHARS, mergeSettings, type Language, type QuestionType, type Settings } from './schemas';
import { audit, iso, loadAssessment, loadStructure } from './service';
import { num } from './bank';

export const ANSWER_GRACE_MS = 5000;
export const AUTO_SUBMIT_REASONS = ['student', 'deadline', 'proctor', 'closed', 'admin'] as const;
export type SubmitReason = (typeof AUTO_SUBMIT_REASONS)[number];

export interface UserCtx { id: string; tenantId: string; name?: string }

const lockKey = (a: string, b: string) => `${a}:${b}`;

// ------------------------------------------------------------------ access
export async function loadMyAssessment(db: Db, u: UserCtx, id: string) {
  const a = (await db.query(`SELECT * FROM assessments WHERE id=$1 AND tenant_id=$2 AND status='published'`, [id, u.tenantId])).rows[0];
  if (!a) throw notFound('Assessment not found', 'ASSESSMENT_NOT_FOUND');
  if (!a.is_practice) {
    const ok = await db.query('SELECT 1 FROM assessment_audience WHERE assessment_id=$1 AND user_id=$2', [id, u.id]);
    if (!ok.rowCount) throw notFound('Assessment not found', 'ASSESSMENT_NOT_FOUND');
  }
  return a;
}

export async function loadMyAttempt(db: Db, u: UserCtx, attemptId: string, lock = false) {
  const att = (await db.query(`SELECT * FROM assessment_attempts WHERE id=$1 AND tenant_id=$2 AND user_id=$3 ${lock ? 'FOR UPDATE' : ''}`, [attemptId, u.tenantId, u.id])).rows[0];
  if (!att) throw notFound('Attempt not found', 'ATTEMPT_NOT_FOUND');
  return att;
}

// ------------------------------------------------------------------ sections / ordering
export interface SectionStatus { id: string; title: string; timeLimitMinutes: number | null; enteredAt: string | null; deadlineAt: string | null; locked: boolean; questionIds: string[] }

export const isSequential = (sections: any[]) => sections.some((s) => s.time_limit_minutes);

export function sectionStatuses(att: any, sections: any[], orderedQ: Map<string, string[]>, now: Date): SectionStatus[] {
  const seq = isSequential(sections);
  const state: Record<string, { enteredAt: string }> = att.section_state || {};
  const maxEntered = sections.reduce((m, s, i) => (state[s.id] ? i : m), -1);
  return sections.map((s, i) => {
    if (!seq) return { id: s.id, title: s.title, timeLimitMinutes: null, enteredAt: iso(att.started_at), deadlineAt: null, locked: false, questionIds: orderedQ.get(s.id) || [] };
    const entered = state[s.id]?.enteredAt ? new Date(state[s.id].enteredAt) : null;
    let deadline: Date | null = null;
    if (entered && s.time_limit_minutes) deadline = new Date(Math.min(entered.getTime() + s.time_limit_minutes * 60000, new Date(att.deadline_at).getTime()));
    const locked = !!entered && (i < maxEntered || (deadline !== null && now.getTime() > deadline.getTime() + ANSWER_GRACE_MS));
    return {
      id: s.id, title: s.title, timeLimitMinutes: s.time_limit_minutes, enteredAt: entered ? entered.toISOString() : null,
      deadlineAt: deadline ? deadline.toISOString() : null, locked, questionIds: entered ? orderedQ.get(s.id) || [] : [],
    };
  });
}

export function orderedQuestions(att: any, settings: Settings, sections: any[], aqs: any[]) {
  const bySection = new Map<string, any[]>();
  for (const s of sections) {
    let list = aqs.filter((q) => q.section_id === s.id).sort((a, b) => a.ord - b.ord);
    if (settings.randomiseQuestions) list = seededShuffle(list, String(att.seed), `q:${s.id}`);
    bySection.set(s.id, list);
  }
  return bySection;
}

export function studentQuestion(aq: any, number: number, att: any, settings: Settings) {
  const s = aq.snapshot;
  const base: any = { id: aq.id, sectionId: aq.section_id, number, type: s.type, title: s.title, body: s.body, marks: num(aq.marks), negativeMarks: settings.negativeMarking ? num(aq.negative_marks) : 0 };
  if (s.type === 'mcq_single' || s.type === 'mcq_multi') {
    base.multi = s.type === 'mcq_multi';
    base.options = (settings.randomiseOptions ? seededShuffle(s.options, String(att.seed), `o:${aq.id}`) : s.options).map((o: any) => ({ id: o.id, text: o.text }));
  }
  if (s.type === 'coding') {
    const tcs = s.coding.testCases as any[];
    base.coding = {
      constraints: s.coding.constraints, languages: s.coding.languages, timeLimitMs: s.coding.timeLimitMs, memoryLimitMb: s.coding.memoryLimitMb,
      starterCode: s.coding.starterCode,
      samples: tcs.filter((t) => t.kind === 'sample').map((t) => ({ id: t.id, input: t.input, expectedOutput: t.expectedOutput, explanation: t.explanation })),
      hiddenCount: tcs.filter((t) => t.kind === 'hidden').length,
    };
  }
  return base;
}

// ------------------------------------------------------------------ state
export function attemptDto(att: any, a: any, now: Date) {
  const settings = mergeSettings(a.settings);
  return {
    id: att.id, assessmentId: att.assessment_id, attemptNo: att.attempt_no, status: att.status, submitReason: att.submit_reason ?? null,
    startedAt: iso(att.started_at), deadlineAt: iso(att.deadline_at), submittedAt: iso(att.submitted_at),
    remainingSeconds: att.status === 'in_progress' ? Math.max(0, Math.floor((new Date(att.deadline_at).getTime() - now.getTime()) / 1000)) : 0,
    warnings: att.warnings, maxWarnings: settings.proctoring.enabled ? settings.proctoring.maxWarnings : null,
    practice: att.is_practice, evaluation: att.evaluation,
  };
}

export async function attemptState(db: Db, att: any, a: any, now: Date) {
  const settings = mergeSettings(a.settings);
  const { sections, questions } = await loadStructure(db, a.id);
  const ordered = orderedQuestions(att, settings, sections, questions);
  const secs = sectionStatuses(att, sections, new Map([...ordered].map(([k, v]) => [k, v.map((q) => q.id)])), now);
  const visible = new Set(secs.filter((s) => s.enteredAt).flatMap((s) => s.questionIds));
  let n = 0;
  const qOut: any[] = [];
  for (const s of sections) for (const aq of ordered.get(s.id) || []) {
    n++;
    if (visible.has(aq.id)) qOut.push(studentQuestion(aq, n, att, settings));
  }
  const answers: Record<string, any> = {};
  for (const r of (await db.query('SELECT aq_id, answer, flagged, updated_at FROM assessment_answers WHERE attempt_id=$1', [att.id])).rows) {
    answers[r.aq_id] = { answer: r.answer, flagged: r.flagged, savedAt: iso(r.updated_at) };
  }
  const code: Record<string, any> = {};
  const codeAqs = questions.filter((q) => q.snapshot?.type === 'coding');
  if (codeAqs.length) {
    const subs = (await db.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND kind='submit' ORDER BY created_at, id`, [att.id])).rows;
    for (const aq of codeAqs) {
      const mine = subs.filter((s) => s.aq_id === aq.id);
      const best = bestSubmission(aq, mine);
      code[aq.id] = {
        submissions: mine.length,
        best: best ? { passed: best.sub.passed, total: best.sub.total, score: best.score, maxScore: num(aq.marks), verdict: best.sub.verdict } : null,
        pending: mine.some((s) => s.status === 'pending_judge'),
      };
    }
  }
  return {
    attempt: attemptDto(att, a, now), serverNow: now.toISOString(),
    assessment: {
      id: a.id, title: a.title, instructions: a.instructions, durationMinutes: a.duration_minutes, negativeMarking: settings.negativeMarking,
      proctoring: settings.proctoring, totalMarks: num(a.total_marks),
    },
    sections: secs, questions: qOut, answers, code,
  };
}

// ------------------------------------------------------------------ start
export async function startAttempt(pool: Pool, u: UserCtx, assessmentId: string, now = new Date()) {
  const res = await withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(assessmentId, u.id)]);
    const a = await loadMyAssessment(c, u, assessmentId);
    const settings = mergeSettings(a.settings);
    const existing = (await c.query(`SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 AND status='in_progress' FOR UPDATE`, [assessmentId, u.id])).rows[0];
    if (existing) {
      if (now.getTime() < new Date(existing.deadline_at).getTime()) return { att: existing, a, resumed: true, finalizedStale: false };
      await finalizeInTx(c, existing, existing.deadline_at && a.closes_at && new Date(existing.deadline_at) >= new Date(a.closes_at) ? 'closed' : 'deadline', now);
    }
    if (!a.is_practice) {
      if (a.opens_at && now.getTime() < new Date(a.opens_at).getTime()) {
        throw unprocessable('NOT_OPEN_YET', 'This test has not opened yet', { opensAt: new Date(a.opens_at).toISOString() });
      }
      if (a.closes_at && now.getTime() >= new Date(a.closes_at).getTime()) throw unprocessable('ASSESSMENT_CLOSED', 'This test is closed');
    }
    const prev = (await c.query('SELECT count(*)::int AS n, coalesce(max(attempt_no),0)::int AS m FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2', [assessmentId, u.id])).rows[0];
    if (!a.is_practice && prev.n >= settings.maxAttempts) throw conflict('MAX_ATTEMPTS_REACHED', 'You have used all attempts for this test');
    let deadline = new Date(now.getTime() + a.duration_minutes * 60000);
    if (!a.is_practice && a.closes_at && new Date(a.closes_at).getTime() < deadline.getTime()) deadline = new Date(a.closes_at);
    const { sections } = await loadStructure(c, assessmentId);
    const state = sections.length ? { [sections[0].id]: { enteredAt: now.toISOString() } } : {};
    const att = (await c.query(
      `INSERT INTO assessment_attempts (tenant_id, assessment_id, user_id, attempt_no, seed, started_at, deadline_at, is_practice, section_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [u.tenantId, assessmentId, u.id, prev.m + 1, newSeed(), now, deadline, a.is_practice, JSON.stringify(state)])).rows[0];
    return { att, a, resumed: false, finalizedStale: false };
  });
  return { ...res, state: await attemptState(pool, res.att, res.a, now) };
}

// ------------------------------------------------------------------ answers
export interface AnswerItem { questionId: string; answer?: unknown; flagged?: boolean; clientTs: number; timeSpentMs?: number }

function validateAnswer(aq: any, answer: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (answer === null) return { ok: true, value: null };
  const t = aq.snapshot.type as QuestionType;
  const ids: string[] = (aq.snapshot.options || []).map((o: any) => o.id);
  switch (t) {
    case 'mcq_single':
      return typeof answer === 'string' && ids.includes(answer) ? { ok: true, value: answer } : { ok: false, message: 'Choose one of the options' };
    case 'mcq_multi':
      return Array.isArray(answer) && answer.every((x) => typeof x === 'string' && ids.includes(x)) && new Set(answer).size === answer.length
        ? { ok: true, value: answer.length ? answer : null } : { ok: false, message: 'Choose from the listed options' };
    case 'numeric': {
      const n = typeof answer === 'string' && answer.trim() !== '' ? Number(answer) : answer;
      return typeof n === 'number' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: 'Enter a number' };
    }
    case 'short_text':
      // eslint-disable-next-line no-control-regex
      if (typeof answer !== 'string' || answer.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answer)) return { ok: false, message: 'Enter up to 500 characters of text' };
      return { ok: true, value: answer };
    case 'coding': {
      const o = answer as any;
      if (!o || typeof o !== 'object' || typeof o.code !== 'string' || typeof o.language !== 'string') return { ok: false, message: 'Provide {language, code}' };
      if (!(aq.snapshot.coding.languages as string[]).includes(o.language) || !(LANGUAGES as readonly string[]).includes(o.language)) return { ok: false, message: 'Language not allowed for this question' };
      if (o.code.length > MAX_CODE_CHARS || o.code.includes('\u0000')) return { ok: false, message: `Code must be at most ${MAX_CODE_CHARS} characters` };
      return { ok: true, value: { language: o.language, code: o.code } };
    }
  }
  return { ok: false, message: 'Unsupported question' };
}

export interface SaveOutcome { saved: number; stale: string[]; rejected: { questionId: string; reason: string }[] }

/** Saves a batch inside the caller's transaction (attempt row must be locked). Last write wins per field by clientTs. */
export async function saveAnswersInTx(c: Db, att: any, a: any, items: AnswerItem[], now: Date): Promise<SaveOutcome> {
  const { sections, questions } = await loadStructure(c, a.id);
  const aqById = new Map(questions.map((q) => [q.id, q]));
  const ordered = orderedQuestions(att, mergeSettings(a.settings), sections, questions);
  const secs = sectionStatuses(att, sections, new Map([...ordered].map(([k, v]) => [k, v.map((q) => q.id)])), now);
  const secById = new Map(secs.map((s) => [s.id, s]));
  const existing = new Map((await c.query('SELECT aq_id, answer_ts, flag_ts, time_spent_ms FROM assessment_answers WHERE attempt_id=$1', [att.id])).rows.map((r) => [r.aq_id, r]));
  const fields: Record<string, string> = {};
  items.forEach((it, i) => {
    const aq = aqById.get(it.questionId);
    if (!aq) { fields[`answers.${i}.questionId`] = 'Unknown question'; return; }
    if (it.answer !== undefined) {
      const v = validateAnswer(aq, it.answer);
      if (!v.ok) fields[`answers.${i}.answer`] = v.message;
    }
  });
  if (Object.keys(fields).length) throw badRequest('Some answers are invalid', fields);
  const out: SaveOutcome = { saved: 0, stale: [], rejected: [] };
  for (const it of items) {
    const aq = aqById.get(it.questionId)!;
    const sec = secById.get(aq.section_id);
    if (!sec || !sec.enteredAt || sec.locked) { out.rejected.push({ questionId: it.questionId, reason: 'SECTION_CLOSED' }); continue; }
    const ex = existing.get(it.questionId) as any;
    const exAns = ex ? Number(ex.answer_ts) : 0;
    const exFlag = ex ? Number(ex.flag_ts) : 0;
    let applied = false; let stale = false;
    let ansVal: unknown = undefined;
    if (it.answer !== undefined) {
      if (it.clientTs >= exAns) { ansVal = validateAnswer(aq, it.answer); ansVal = (ansVal as any).value; applied = true; } else stale = true;
    }
    let flagVal: boolean | undefined;
    if (it.flagged !== undefined) {
      if (it.clientTs >= exFlag) { flagVal = it.flagged; applied = true; } else stale = true;
    }
    if (it.answer === undefined && it.flagged === undefined && it.timeSpentMs !== undefined) applied = true;
    const spent = Math.max(ex ? Number(ex.time_spent_ms) : 0, Math.min(Math.max(0, Math.floor(it.timeSpentMs ?? 0)), 24 * 3600_000));
    if (applied) {
      await c.query(
        `INSERT INTO assessment_answers (attempt_id, aq_id, tenant_id, answer, answer_ts, flagged, flag_ts, time_spent_ms, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (attempt_id, aq_id) DO UPDATE SET
           answer = CASE WHEN $9 THEN EXCLUDED.answer ELSE assessment_answers.answer END,
           answer_ts = CASE WHEN $9 THEN EXCLUDED.answer_ts ELSE assessment_answers.answer_ts END,
           flagged = CASE WHEN $10 THEN EXCLUDED.flagged ELSE assessment_answers.flagged END,
           flag_ts = CASE WHEN $10 THEN EXCLUDED.flag_ts ELSE assessment_answers.flag_ts END,
           time_spent_ms = GREATEST(assessment_answers.time_spent_ms, EXCLUDED.time_spent_ms), updated_at = now()`,
        [att.id, aq.id, att.tenant_id, ansVal === undefined || ansVal === null ? null : JSON.stringify(ansVal), ansVal !== undefined ? it.clientTs : 0,
          flagVal ?? false, flagVal !== undefined ? it.clientTs : 0, spent, ansVal !== undefined, flagVal !== undefined]);
      out.saved++;
      existing.set(it.questionId, { aq_id: it.questionId, answer_ts: ansVal !== undefined ? it.clientTs : exAns, flag_ts: flagVal !== undefined ? it.clientTs : exFlag, time_spent_ms: spent });
    }
    if (stale) out.stale.push(it.questionId);
  }
  return out;
}

export class DeadlinePassedSignal extends Error {}

export async function saveAnswers(pool: Pool, u: UserCtx, attemptId: string, items: AnswerItem[], now = new Date()) {
  let expired = false;
  const res = await withTx(pool, async (c) => {
    const att = await loadMyAttempt(c, u, attemptId, true);
    if (att.status !== 'in_progress') throw conflict('ATTEMPT_ALREADY_SUBMITTED', 'This attempt has already been submitted');
    if (now.getTime() > new Date(att.deadline_at).getTime() + ANSWER_GRACE_MS) { expired = true; return null; }
    const a = await loadAssessment(c, u.tenantId, att.assessment_id);
    const out = await saveAnswersInTx(c, att, a, items, now);
    if (out.rejected.length && out.saved === 0 && !out.stale.length) throw conflict('SECTION_CLOSED', 'That section is closed');
    return { out, att };
  });
  if (expired || !res) {
    await finalizeAttempt(pool, attemptId, 'deadline', now);
    throw conflict('DEADLINE_PASSED', 'The time for this attempt is over. It has been submitted.');
  }
  const remaining = Math.max(0, Math.floor((new Date(res.att.deadline_at).getTime() - now.getTime()) / 1000));
  return { ...res.out, serverNow: now.toISOString(), remainingSeconds: remaining };
}

export async function enterSection(pool: Pool, u: UserCtx, attemptId: string, sectionId: string, now = new Date()) {
  let expired = false;
  const res = await withTx(pool, async (c) => {
    const att = await loadMyAttempt(c, u, attemptId, true);
    if (att.status !== 'in_progress') throw conflict('ATTEMPT_ALREADY_SUBMITTED', 'This attempt has already been submitted');
    if (now.getTime() >= new Date(att.deadline_at).getTime()) { expired = true; return null; }
    const a = await loadAssessment(c, u.tenantId, att.assessment_id);
    const settings = mergeSettings(a.settings);
    const { sections, questions } = await loadStructure(c, a.id);
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) throw notFound('Section not found', 'SECTION_NOT_FOUND');
    const state = { ...(att.section_state || {}) };
    if (isSequential(sections) && !state[sectionId]) {
      const maxEntered = sections.reduce((m, s, i) => (state[s.id] ? i : m), -1);
      if (idx !== maxEntered + 1) throw conflict('SECTION_NOT_NEXT', 'Sections must be opened in order');
      state[sectionId] = { enteredAt: now.toISOString() };
      await c.query('UPDATE assessment_attempts SET section_state=$2 WHERE id=$1', [att.id, JSON.stringify(state)]);
      att.section_state = state;
    }
    const ordered = orderedQuestions(att, settings, sections, questions);
    const secs = sectionStatuses(att, sections, new Map([...ordered].map(([k, v]) => [k, v.map((q) => q.id)])), now);
    const sec = secs[idx];
    let n = 0; const qs: any[] = [];
    for (const s of sections) for (const aq of ordered.get(s.id) || []) { n++; if (s.id === sectionId && sec.enteredAt) qs.push(studentQuestion(aq, n, att, settings)); }
    return { section: { id: sec.id, enteredAt: sec.enteredAt, deadlineAt: sec.deadlineAt, locked: sec.locked }, questions: qs };
  });
  if (expired || !res) {
    await finalizeAttempt(pool, attemptId, 'deadline', now);
    throw conflict('DEADLINE_PASSED', 'The time for this attempt is over. It has been submitted.');
  }
  return res;
}

// ------------------------------------------------------------------ proctoring
export const PROCTOR_TYPES = ['focus_lost', 'focus_regained', 'app_background', 'network_offline'] as const;
const COUNTED = new Set(['focus_lost', 'app_background']);

export async function recordEvents(pool: Pool, u: UserCtx, attemptId: string, events: { type: string; clientTs?: number; eventId?: string }[], now = new Date()) {
  const out = await withTx(pool, async (c) => {
    const att = await loadMyAttempt(c, u, attemptId, true);
    const a = await loadAssessment(c, u.tenantId, att.assessment_id);
    const settings = mergeSettings(a.settings);
    if (att.status !== 'in_progress') return { att, a, ignored: true, autoSubmitted: false };
    let warnings = att.warnings;
    for (const ev of events) {
      const counted = settings.proctoring.enabled && COUNTED.has(ev.type);
      const ins = await c.query(
        `INSERT INTO assessment_proctor_events (tenant_id, attempt_id, type, client_ts, event_key, counted) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [u.tenantId, att.id, ev.type, ev.clientTs ?? null, ev.eventId ?? null, counted]);
      if (ins.rowCount && counted) warnings++;
    }
    await c.query('UPDATE assessment_attempts SET warnings=$2 WHERE id=$1', [att.id, warnings]);
    att.warnings = warnings;
    let auto = false;
    if (settings.proctoring.enabled && settings.proctoring.autoSubmit && warnings >= settings.proctoring.maxWarnings) {
      await finalizeInTx(c, att, 'proctor', now);
      auto = true;
    }
    return { att: { ...att, status: auto ? 'submitted' : att.status }, a, ignored: false, autoSubmitted: auto };
  });
  const settings = mergeSettings(out.a.settings);
  return {
    warnings: out.att.warnings, maxWarnings: settings.proctoring.enabled ? settings.proctoring.maxWarnings : null,
    autoSubmitted: out.autoSubmitted, status: out.att.status, ...(out.ignored ? { ignored: true } : {}),
  };
}

// ------------------------------------------------------------------ finalise + grade
export async function finalizeInTx(c: Db, att: any, reason: SubmitReason, now: Date) {
  if (att.status !== 'in_progress') return { replayed: true };
  const at = new Date(Math.min(now.getTime(), new Date(att.deadline_at).getTime()));
  await c.query(`UPDATE assessment_attempts SET status='submitted', submit_reason=$2, submitted_at=$3 WHERE id=$1`, [att.id, reason, at]);
  att.status = 'submitted'; att.submit_reason = reason; att.submitted_at = at;
  // never lose the editor contents: queue unsubmitted code for judging
  const aqs = (await c.query(`SELECT id, snapshot FROM assessment_questions WHERE assessment_id=$1 AND snapshot->>'type'='coding'`, [att.assessment_id])).rows;
  for (const aq of aqs) {
    const ans = (await c.query('SELECT answer FROM assessment_answers WHERE attempt_id=$1 AND aq_id=$2', [att.id, aq.id])).rows[0]?.answer;
    if (!ans || typeof ans.code !== 'string' || !ans.code.trim()) continue;
    if (!(aq.snapshot.coding.languages as string[]).includes(ans.language)) continue;
    const hash = codeHash(ans.code);
    const dup = await c.query(`SELECT 1 FROM assessment_code_submissions WHERE attempt_id=$1 AND aq_id=$2 AND kind='submit' AND language=$3 AND norm_hash=$4 AND status <> 'error'`, [att.id, aq.id, ans.language, hash]);
    if (dup.rowCount) continue;
    await c.query(
      `INSERT INTO assessment_code_submissions (tenant_id, user_id, attempt_id, aq_id, kind, source, language, code, status, norm_hash, next_try_at, max_score)
       VALUES ($1,$2,$3,$4,'submit','final',$5,$6,'pending_judge',$7,now(),(SELECT marks FROM assessment_questions WHERE id=$4))`,
      [att.tenant_id, att.user_id, att.id, aq.id, ans.language, ans.code, hash]);
  }
  await gradeAttempt(c, att.id, now);
  return { replayed: false };
}

export async function finalizeAttempt(pool: Pool, attemptId: string, reason: SubmitReason, now = new Date()) {
  return withTx(pool, async (c) => {
    const att = (await c.query('SELECT * FROM assessment_attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0];
    if (!att) throw notFound('Attempt not found', 'ATTEMPT_NOT_FOUND');
    const r = await finalizeInTx(c, att, reason, now);
    return { replayed: r.replayed, attempt: (await c.query('SELECT * FROM assessment_attempts WHERE id=$1', [attemptId])).rows[0] };
  });
}

/** Score of one judged submission under the *current* weights/marks (so regrades follow key changes). */
export function submissionScore(aq: any, sub: any): number {
  const tests = (aq.snapshot.coding.testCases as any[]).map((t) => ({
    weight: Number(t.weight), passed: !!(sub.results as any[]).find((r) => r.id === t.id && r.passed),
  }));
  return gradeCoding(num(aq.marks), tests).score;
}

export function bestSubmission(aq: any, subs: any[]): { sub: any; score: number } | null {
  let best: { sub: any; score: number } | null = null;
  for (const s of subs) {
    if (s.status !== 'judged') continue;
    const score = submissionScore(aq, s);
    if (!best || score > best.score) best = { sub: s, score };
  }
  return best;
}

/** Recomputes every question score and the attempt totals from stored answers and judged submissions. */
export async function gradeAttempt(c: Db, attemptId: string, now = new Date()) {
  const att = (await c.query('SELECT * FROM assessment_attempts WHERE id=$1', [attemptId])).rows[0];
  const a = (await c.query('SELECT * FROM assessments WHERE id=$1', [att.assessment_id])).rows[0];
  const settings = mergeSettings(a.settings);
  const { sections, questions } = await loadStructure(c, a.id);
  const answers = new Map((await c.query('SELECT * FROM assessment_answers WHERE attempt_id=$1', [attemptId])).rows.map((r) => [r.aq_id, r]));
  const subs = (await c.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND kind='submit'`, [attemptId])).rows;
  const pending = subs.some((s) => s.status === 'pending_judge' || s.status === 'queued');
  const scored: { sectionId: string; marks: number; score: number }[] = [];
  for (const aq of questions) {
    const snap = aq.snapshot;
    const ans = answers.get(aq.id)?.answer ?? null;
    let score = 0; let correct: Correctness = 'unanswered';
    if (snap.type === 'coding') {
      const mine = subs.filter((s) => s.aq_id === aq.id);
      const best = bestSubmission(aq, mine);
      if (best) {
        const g = gradeCoding(num(aq.marks), (snap.coding.testCases as any[]).map((t) => ({ weight: Number(t.weight), passed: !!(best.sub.results as any[]).find((r) => r.id === t.id && r.passed) })));
        score = g.score; correct = g.correct;
      } else if (isAnswered('coding', ans) || mine.length) { correct = 'wrong'; }
    } else {
      const g = gradeObjective({ type: snap.type, marks: num(aq.marks), negativeMarks: num(aq.negative_marks), answer: snap.answer }, ans, settings.negativeMarking);
      score = g.score; correct = g.correct;
    }
    await c.query(
      `INSERT INTO assessment_answers (attempt_id, aq_id, tenant_id, score, correct) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (attempt_id, aq_id) DO UPDATE SET score=EXCLUDED.score, correct=EXCLUDED.correct`,
      [attemptId, aq.id, att.tenant_id, score, correct]);
    scored.push({ sectionId: aq.section_id, marks: num(aq.marks), score });
  }
  const totals = aggregate(sections.map((s) => ({ id: s.id, cutoffMarks: num(s.cutoff_marks) })), scored, settings.passCutoff, att.score_override === null ? null : Number(att.score_override));
  await c.query(
    `UPDATE assessment_attempts SET score=$2, max_score=$3, section_scores=$4, passed=$5, graded_at=$6, evaluation=$7 WHERE id=$1`,
    [attemptId, totals.score, totals.maxScore, JSON.stringify(totals.sections), totals.passed, now, pending ? 'pending' : 'complete']);
  return { ...totals, evaluation: pending ? 'pending' : 'complete' };
}

export async function regradeAttempt(pool: Pool, attemptId: string, now = new Date()) {
  return withTx(pool, async (c) => {
    await c.query('SELECT 1 FROM assessment_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
    return gradeAttempt(c, attemptId, now);
  });
}

export async function submitAttempt(pool: Pool, u: UserCtx, attemptId: string, items: AnswerItem[] | undefined, now = new Date()) {
  const out = await withTx(pool, async (c) => {
    const att = await loadMyAttempt(c, u, attemptId, true);
    const a = await loadAssessment(c, u.tenantId, att.assessment_id);
    if (att.status === 'submitted') return { att, a, replayed: true };
    const expired = now.getTime() > new Date(att.deadline_at).getTime() + ANSWER_GRACE_MS;
    if (items?.length && !expired) {
      const sec = await saveAnswersInTx(c, att, a, items, now);
      void sec;
    }
    await finalizeInTx(c, att, expired ? 'deadline' : 'student', now);
    return { att: (await c.query('SELECT * FROM assessment_attempts WHERE id=$1', [attemptId])).rows[0], a, replayed: false };
  });
  return out;
}

export { audit, ApiError };
