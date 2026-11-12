import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, conflict, notFound, unprocessable } from '../errors';
import { createNotification } from '../notify';
import type { PushSender } from '../push';
import { TRANSITIONS, type AppStatus } from '../routes/applications';
import { toCompany } from '../drives';
import { formatIstStamp, toCsv } from '../csv';
import { attemptDto, bestSubmission, regradeAttempt } from './attempts';
import { num } from './bank';
import { codeShingles } from './plagiarismUtil';
import { codeHash, jaccard } from './compare';
import { rankScores, round2 } from './grading';
import { mergeSettings } from './schemas';
import { audit, iso, loadStructure, pushToUsers } from './service';

// ------------------------------------------------------------------ visibility
export function resultReleased(a: any, now: Date): boolean {
  if (a.is_practice) return true;
  if (a.results_published_at) return true;
  const v = mergeSettings(a.settings).resultVisibility;
  if (v === 'immediate') return true;
  if (v === 'after_close') return !!a.closes_at && now.getTime() >= new Date(a.closes_at).getTime();
  return false;
}

const eff = (r: any) => (r.score_override !== null && r.score_override !== undefined ? Number(r.score_override) : r.score === null ? 0 : Number(r.score));

/** One entry per student: their best submitted attempt (highest effective score, then lowest attempt number). */
export async function bestAttempts(db: Db, assessmentId: string) {
  const rows = (await db.query(`SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND status='submitted' AND NOT is_practice ORDER BY user_id, attempt_no`, [assessmentId])).rows;
  const best = new Map<string, any>();
  for (const r of rows) {
    const cur = best.get(r.user_id);
    if (!cur || eff(r) > eff(cur)) best.set(r.user_id, r);
  }
  return [...best.values()];
}

export async function rankingFor(db: Db, assessmentId: string) {
  const best = (await bestAttempts(db, assessmentId)).filter((r) => r.evaluation === 'complete');
  const ranked = rankScores(best.map((r) => ({ userId: r.user_id as string, attemptId: r.id as string, score: eff(r) })));
  return { ranked, total: ranked.length };
}

// ------------------------------------------------------------------ student result
export function correctAnswerOf(snap: any) {
  switch (snap.type) {
    case 'mcq_single': case 'mcq_multi': return snap.answer.correct;
    case 'numeric': return snap.answer.value;
    case 'short_text': return snap.answer.accepted;
    default: return undefined;
  }
}

export async function studentResult(db: Db, att: any, a: any, now: Date) {
  const settings = mergeSettings(a.settings);
  const base = { attempt: attemptDto(att, a, now), serverNow: now.toISOString() };
  if (att.evaluation !== 'complete') return { ...base, available: false, visibility: settings.resultVisibility, releaseAt: iso(a.closes_at), reason: 'EVALUATION_PENDING' };
  if (!resultReleased(a, now)) {
    return { ...base, available: false, visibility: settings.resultVisibility, releaseAt: settings.resultVisibility === 'after_close' ? iso(a.closes_at) : null, reason: settings.resultVisibility === 'manual' ? 'MANUAL' : 'AFTER_CLOSE' };
  }
  const { sections, questions } = await loadStructure(db, a.id);
  const answers = new Map((await db.query('SELECT * FROM assessment_answers WHERE attempt_id=$1', [att.id])).rows.map((r) => [r.aq_id, r]));
  const subs = (await db.query(`SELECT * FROM assessment_code_submissions WHERE attempt_id=$1 AND kind='submit' AND status='judged'`, [att.id])).rows;
  const score = eff(att);
  const maxScore = Number(att.max_score ?? a.total_marks);
  let rank: number | null = null; let percentile: number | null = null; let totalParticipants = 0;
  const ranking = !a.is_practice && settings.rankingEnabled;
  if (ranking) {
    const { ranked, total } = await rankingFor(db, a.id);
    totalParticipants = total;
    const mine = ranked.find((r) => r.userId === att.user_id);
    if (mine) {
      rank = mine.rank;
      percentile = total ? Math.round((1000 * ranked.filter((r) => r.score < mine.score).length) / total) / 10 : null;
    }
  } else if (!a.is_practice) {
    totalParticipants = (await rankingFor(db, a.id)).total;
  }
  const sectionScores = att.section_scores || {};
  const coding = questions.filter((q) => q.snapshot.type === 'coding').map((q) => {
    const b = bestSubmission(q, subs.filter((s) => s.aq_id === q.id));
    return {
      questionId: q.id, title: q.snapshot.title, verdict: b ? b.sub.verdict : answers.get(q.id)?.answer ? 'not_judged' : 'not_attempted',
      passed: b ? b.sub.passed : 0, total: b ? b.sub.total : (q.snapshot.coding.testCases as any[]).length, score: b ? b.score : 0, maxScore: num(q.marks), language: b ? b.sub.language : null,
    };
  });
  const result = {
    score, maxScore, percent: maxScore ? round2((score / maxScore) * 100) : 0, passed: att.passed, rank, totalParticipants, percentile,
    timeTakenSeconds: att.submitted_at ? Math.round((new Date(att.submitted_at).getTime() - new Date(att.started_at).getTime()) / 1000) : null,
    submitReason: att.submit_reason, evaluation: att.evaluation, warnings: att.warnings, overridden: att.score_override !== null,
    sections: sections.map((s) => ({
      id: s.id, title: s.title, score: sectionScores[s.id]?.score ?? 0, maxScore: sectionScores[s.id]?.maxScore ?? 0, cutoffMarks: num(s.cutoff_marks), cutoffMet: sectionScores[s.id]?.cutoffMet ?? null,
    })),
    coding,
  };
  let review: any[] | null = null;
  if (settings.allowReview || a.is_practice) {
    review = []; let n = 0;
    for (const s of sections) for (const q of questions.filter((x) => x.section_id === s.id)) {
      n++;
      const ans = answers.get(q.id);
      review.push({
        questionId: q.id, sectionId: s.id, number: n, type: q.snapshot.type, title: q.snapshot.title, body: q.snapshot.body, options: q.snapshot.options?.length ? q.snapshot.options : undefined,
        yourAnswer: ans?.answer ?? null, correctAnswer: correctAnswerOf(q.snapshot), correct: ans?.correct ?? 'unanswered', score: ans?.score === null || ans?.score === undefined ? 0 : Number(ans.score),
        maxScore: num(q.marks), explanation: q.snapshot.explanation,
      });
    }
  }
  return { ...base, available: true, result, review };
}

// ------------------------------------------------------------------ plagiarism-lite
const MIN_TOKENS = 15;
const PAIRWISE_CAP = 300;

export async function plagiarism(db: Db, a: any, threshold = 0.85) {
  const { questions } = await loadStructure(db, a.id);
  const codeQs = questions.filter((q) => q.snapshot.type === 'coding');
  const pairs: any[] = [];
  const flagged = new Set<string>();
  if (!codeQs.length || a.is_practice) return { threshold, pairs, flagged };
  const subs = (await db.query(
    `SELECT s.*, at.user_id AS att_user, u.name FROM assessment_code_submissions s JOIN assessment_attempts at ON at.id=s.attempt_id JOIN users u ON u.id=at.user_id
      WHERE at.assessment_id=$1 AND at.status='submitted' AND s.kind='submit' AND s.status='judged'`, [a.id])).rows;
  for (const q of codeQs) {
    const perUser = new Map<string, any>();
    const byUser = new Map<string, any[]>();
    for (const s of subs.filter((x) => x.aq_id === q.id)) (byUser.get(s.att_user) ?? byUser.set(s.att_user, []).get(s.att_user)!).push(s);
    for (const [uid, list] of byUser) {
      const b = bestSubmission(q, list);
      if (b && b.score > 0) perUser.set(uid, b.sub);
    }
    const entries = [...perUser.entries()].map(([uid, s]) => ({ uid, s, ...codeShingles(s.code) })).filter((e) => e.tokenCount >= MIN_TOKENS);
    const hashGroups = new Map<string, typeof entries>();
    for (const e of entries) (hashGroups.get(e.hash) ?? hashGroups.set(e.hash, []).get(e.hash)!).push(e);
    const seen = new Set<string>();
    const push = (x: (typeof entries)[0], y: (typeof entries)[0], similarity: number, identical: boolean) => {
      const key = [x.uid, y.uid].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      flagged.add(x.uid); flagged.add(y.uid);
      pairs.push({
        questionId: q.id, title: q.snapshot.title, similarity: round2(similarity), identical,
        a: { attemptId: x.s.attempt_id, studentId: x.uid, name: x.s.name }, b: { attemptId: y.s.attempt_id, studentId: y.uid, name: y.s.name },
      });
    };
    for (const g of hashGroups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) push(g[i], g[j], 1, true);
    if (entries.length <= PAIRWISE_CAP) {
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const x = entries[i]; const y = entries[j];
        if (x.hash === y.hash) continue;
        const ratio = Math.min(x.tokenCount, y.tokenCount) / Math.max(x.tokenCount, y.tokenCount);
        if (ratio < threshold * 0.8) continue;
        const sim = jaccard(x.shingles, y.shingles);
        if (sim >= threshold) push(x, y, sim, false);
      }
    }
  }
  pairs.sort((p, q) => q.similarity - p.similarity);
  return { threshold, pairs, flagged };
}

// ------------------------------------------------------------------ officer results
export interface ResultQuery { q?: string; status?: string; passed?: string; flagged?: string; sort?: string }

export async function resultRows(db: Db, a: any, now: Date) {
  const { sections } = await loadStructure(db, a.id);
  const audience = (await db.query(
    `SELECT u.id, u.name, u.email, p.data->'identity'->>'registrationNumber' AS reg
       FROM assessment_audience au JOIN users u ON u.id=au.user_id LEFT JOIN profiles p ON p.user_id=u.id WHERE au.assessment_id=$1`, [a.id])).rows;
  const attempts = (await db.query(`SELECT * FROM assessment_attempts WHERE assessment_id=$1 AND NOT is_practice ORDER BY user_id, attempt_no`, [a.id])).rows;
  const byUser = new Map<string, any[]>();
  for (const r of attempts) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);
  const plag = await plagiarism(db, a);
  const chosen = new Map<string, any>();
  for (const u of audience) {
    const list = byUser.get(u.id) || [];
    const sub = list.filter((x) => x.status === 'submitted');
    let pick: any = null;
    if (sub.length) pick = sub.reduce((b, x) => (eff(x) > eff(b) ? x : b));
    else if (list.length) pick = list[list.length - 1];
    chosen.set(u.id, pick);
  }
  const ranked = rankScores([...chosen.entries()].filter(([, at]) => at && at.status === 'submitted' && at.evaluation === 'complete').map(([uid, at]) => ({ uid, score: eff(at) })));
  const rankOf = new Map(ranked.map((r) => [r.uid, r.rank]));
  const rows = audience.map((u) => {
    const at = chosen.get(u.id);
    const status = !at ? 'not_attempted' : at.status === 'submitted' ? 'submitted' : 'in_progress';
    const maxScore = at ? Number(at.max_score ?? a.total_marks) : Number(a.total_marks);
    const score = at && at.status === 'submitted' ? eff(at) : null;
    return {
      rank: rankOf.get(u.id) ?? null, studentId: u.id, name: u.name, email: u.email, registrationNumber: u.reg ?? null,
      attemptId: at?.id ?? null, attemptNo: at?.attempt_no ?? null, status, submitReason: at?.submit_reason ?? null, evaluation: at?.evaluation ?? null,
      score, maxScore, percent: score !== null && maxScore ? round2((score / maxScore) * 100) : null, passed: at?.status === 'submitted' ? at.passed : null,
      timeTakenSeconds: at?.submitted_at ? Math.round((new Date(at.submitted_at).getTime() - new Date(at.started_at).getTime()) / 1000) : null,
      sections: sections.map((s) => ({ id: s.id, score: at?.section_scores?.[s.id]?.score ?? null })),
      proctorWarnings: at?.warnings ?? 0,
      flags: { plagiarism: plag.flagged.has(u.id), overridden: at?.score_override !== null && at?.score_override !== undefined, autoSubmitted: !!at?.submit_reason && at.submit_reason !== 'student', proctor: (at?.warnings ?? 0) > 0 },
      override: at && at.score_override !== null ? { score: Number(at.score_override), reason: at.override_reason } : null,
      submittedAt: iso(at?.submitted_at),
    };
  });
  const done = rows.filter((r) => r.status === 'submitted' && r.evaluation === 'complete' && r.score !== null);
  const scores = done.map((r) => r.score as number).sort((x, y) => x - y);
  const mid = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : null;
  const summary = {
    audience: rows.length, participants: rows.filter((r) => r.status === 'submitted').length, notAttempted: rows.filter((r) => r.status === 'not_attempted').length,
    inProgress: rows.filter((r) => r.status === 'in_progress').length, avg: scores.length ? round2(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    median: mid === null ? null : round2(mid), max: scores.length ? scores[scores.length - 1] : null, min: scores.length ? scores[0] : null,
    passCount: done.filter((r) => r.passed === true).length, passRate: done.some((r) => r.passed !== null) ? round2((done.filter((r) => r.passed === true).length / done.length) * 100) : null,
    pendingEvaluation: rows.filter((r) => r.status === 'submitted' && r.evaluation !== 'complete').length,
  };
  return { rows, summary, sections, released: resultReleased(a, now) };
}

export function filterSortRows(rows: any[], q: ResultQuery) {
  let out = rows;
  if (q.q) { const s = q.q.toLowerCase(); out = out.filter((r) => r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || (r.registrationNumber || '').toLowerCase().includes(s)); }
  if (q.status) out = out.filter((r) => r.status === q.status);
  if (q.passed === '1') out = out.filter((r) => r.passed === true);
  if (q.passed === '0') out = out.filter((r) => r.passed === false);
  if (q.flagged === '1') out = out.filter((r) => r.flags.plagiarism || r.flags.proctor || r.flags.overridden || r.flags.autoSubmitted);
  const cmp: Record<string, (x: any, y: any) => number> = {
    rank: (x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || x.name.localeCompare(y.name),
    score: (x, y) => (y.score ?? -1e9) - (x.score ?? -1e9) || x.name.localeCompare(y.name),
    name: (x, y) => x.name.localeCompare(y.name),
    time: (x, y) => (x.timeTakenSeconds ?? 1e9) - (y.timeTakenSeconds ?? 1e9) || x.name.localeCompare(y.name),
  };
  return out.slice().sort(cmp[q.sort || 'rank'] || cmp.rank);
}

export function csvForResults(rows: any[], sections: any[]) {
  const header = ['rank', 'name', 'email', 'registrationNumber', 'status', 'score', 'maxScore', 'percent', 'passed', 'timeTakenSeconds', ...sections.map((s) => s.title), 'proctorWarnings', 'flags', 'submittedAt'];
  const lines = rows.map((r) => [
    r.rank ?? '', r.name, r.email, r.registrationNumber ?? '', r.status, r.score ?? '', r.maxScore, r.percent ?? '', r.passed === null ? '' : r.passed ? 'yes' : 'no', r.timeTakenSeconds ?? '',
    ...r.sections.map((s: any) => s.score ?? ''), r.proctorWarnings,
    Object.entries(r.flags).filter(([, v]) => v).map(([k]) => k).join(' '), r.submittedAt ? formatIstStamp(new Date(r.submittedAt)) : '',
  ]);
  return toCsv(header, lines);
}

// ------------------------------------------------------------------ analytics
export async function analytics(db: Db, a: any, now: Date) {
  const { rows, summary, sections } = await resultRows(db, a, now);
  const done = rows.filter((r) => r.status === 'submitted' && r.score !== null);
  const percents = done.map((r) => r.percent as number);
  const mean = percents.length ? percents.reduce((s, x) => s + x, 0) / percents.length : 0;
  const sorted = percents.slice().sort((x, y) => x - y);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  const sd = percents.length ? Math.sqrt(percents.reduce((s, x) => s + (x - mean) ** 2, 0) / percents.length) : 0;
  const buckets = Array.from({ length: 10 }, (_, i) => ({ fromPercent: i * 10, toPercent: i === 9 ? 100 : i * 10 + 10, count: 0 }));
  for (const p of percents) buckets[Math.max(0, Math.min(9, Math.floor(Math.max(0, p) / 10)))].count++;
  const { questions } = await loadStructure(db, a.id);
  const answerRows = (await db.query(
    `SELECT an.* FROM assessment_answers an JOIN assessment_attempts at ON at.id=an.attempt_id
      WHERE at.assessment_id=$1 AND at.status='submitted' AND NOT at.is_practice`, [a.id])).rows;
  // one attempt per student (the one shown in results) for question analytics
  const chosenAttempts = new Set(done.map((r) => r.attemptId));
  const rowsByQ = new Map<string, any[]>();
  for (const r of answerRows) if (chosenAttempts.has(r.attempt_id)) (rowsByQ.get(r.aq_id) ?? rowsByQ.set(r.aq_id, []).get(r.aq_id)!).push(r);
  let n = 0;
  const outQs: any[] = [];
  for (const s of sections) for (const q of questions.filter((x) => x.section_id === s.id)) {
    n++;
    const list = rowsByQ.get(q.id) || [];
    const attempted = list.filter((r) => r.correct && r.correct !== 'unanswered').length;
    const correctCount = list.filter((r) => r.correct === 'correct').length;
    const times = list.filter((r) => r.time_spent_ms > 0).map((r) => r.time_spent_ms);
    outQs.push({
      id: q.id, sectionId: s.id, number: n, type: q.snapshot.type, title: q.snapshot.title, difficulty: q.snapshot.difficulty, marks: num(q.marks),
      attempted, attemptRate: done.length ? round2((attempted / done.length) * 100) : 0, correctCount, correctPercent: attempted ? round2((correctCount / attempted) * 100) : 0,
      partialCount: list.filter((r) => r.correct === 'partial').length, avgTimeSeconds: times.length ? Math.round(times.reduce((x, y) => x + y, 0) / times.length / 1000) : 0,
      difficultyIndex: attempted ? round2(correctCount / attempted) : 0,
    });
  }
  const secAvg = sections.map((s) => ({
    id: s.id, title: s.title, avgScore: done.length ? round2(done.reduce((t, r) => t + (r.sections.find((x: any) => x.id === s.id)?.score ?? 0), 0) / done.length) : 0,
    maxScore: round2(questions.filter((q) => q.section_id === s.id).reduce((t, q) => t + num(q.marks), 0)),
  }));
  return { summary, distribution: { bucketSize: 10, buckets, mean: round2(mean), median: round2(median), stdDev: round2(sd) }, sections: secAvg, questions: outQs };
}

// ------------------------------------------------------------------ regrade
export async function regradeAssessment(pool: Pool, tenantId: string, actorId: string, a: any, reason: string, rejudge: boolean, now = new Date()) {
  const attempts = (await pool.query(`SELECT id, score, score_override FROM assessment_attempts WHERE assessment_id=$1 AND status='submitted'`, [a.id])).rows;
  let queued = 0;
  if (rejudge) {
    const r = await pool.query(
      `UPDATE assessment_code_submissions SET status='pending_judge', next_try_at=$2, tries=0
        WHERE kind='submit' AND status='judged' AND attempt_id IN (SELECT id FROM assessment_attempts WHERE assessment_id=$1 AND status='submitted')`, [a.id, now]);
    queued = r.rowCount ?? 0;
  }
  let changed = 0;
  for (const at of attempts) {
    const before = at.score === null ? null : Number(at.score);
    const after = await regradeAttempt(pool, at.id, now);
    if (before === null || Math.abs(before - after.score) > 1e-9) changed++;
  }
  await audit(pool, tenantId, actorId, 'assessment.regraded', { assessmentId: a.id, reason, attempts: attempts.length, changed, rejudgeQueued: queued });
  return { regraded: attempts.length, changed, rejudgeQueued: queued };
}

// ------------------------------------------------------------------ shortlist
export interface ShortlistBody { minScore?: number; topN?: number; driveId?: string; toStatus: AppStatus; dryRun: boolean; note?: string }

const SHORTLIST_LABEL: Record<string, string> = {
  screening: 'is under screening', assessment: 'moved to the assessment round', interview: 'moved to the interview round', selected: 'has been shortlisted as selected',
  rejected: 'was not selected', offer_issued: 'has an offer issued',
};

export async function shortlist(pool: Pool, push: PushSender, tenantId: string, actorId: string, a: any, body: ShortlistBody, now = new Date()) {
  const driveId = body.driveId ?? a.drive_id;
  if (!driveId) throw new ApiError(400, 'VALIDATION_ERROR', 'driveId is required', { driveId: 'Choose the drive to shortlist for' });
  const drive = (await pool.query('SELECT id, role, company FROM drives WHERE id=$1 AND tenant_id=$2', [driveId, tenantId])).rows[0];
  if (!drive) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
  const best = await bestAttempts(pool, a.id);
  const pending = best.filter((r) => r.evaluation !== 'complete');
  if (!body.dryRun && pending.length) throw conflict('EVALUATION_PENDING', `${pending.length} attempt(s) are still being evaluated. Try again shortly.`);
  const done = best.filter((r) => r.evaluation === 'complete');
  const ranked = rankScores(done.map((r) => ({ userId: r.user_id as string, score: eff(r) })));
  const matched = ranked.filter((r) => (body.minScore !== undefined ? r.score >= body.minScore : r.rank <= (body.topN as number)));
  const names = new Map((await pool.query('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [matched.map((m) => m.userId)])).rows.map((r) => [r.id, r.name]));
  const apps = new Map((await pool.query(`SELECT id, user_id, status FROM applications WHERE drive_id=$1 AND tenant_id=$2 AND status <> 'withdrawn' AND user_id = ANY($3::uuid[])`, [driveId, tenantId, matched.map((m) => m.userId)])).rows.map((r) => [r.user_id, r]));
  const company = toCompany(drive.company).name;
  const items: any[] = []; const notify: string[] = [];
  for (const m of matched) {
    const app = apps.get(m.userId);
    const item: any = { studentId: m.userId, name: names.get(m.userId), score: m.score, rank: m.rank, applicationId: app?.id ?? null, from: app?.status ?? null, to: body.toStatus };
    if (!app) { items.push({ ...item, outcome: 'skipped', reason: 'NO_APPLICATION' }); continue; }
    if (app.status === body.toStatus) { items.push({ ...item, outcome: 'unchanged' }); continue; }
    if (!TRANSITIONS[app.status as AppStatus].includes(body.toStatus)) { items.push({ ...item, outcome: 'skipped', reason: 'INVALID_TRANSITION' }); continue; }
    if (body.dryRun) { items.push({ ...item, outcome: 'change' }); continue; }
    const res = await withTx(pool, async (c) => {
      const cur = (await c.query('SELECT status FROM applications WHERE id=$1 FOR UPDATE', [app.id])).rows[0];
      if (cur.status === body.toStatus) return 'unchanged';
      if (!TRANSITIONS[cur.status as AppStatus].includes(body.toStatus)) return 'invalid';
      await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [app.id, body.toStatus]);
      const note = body.note ?? `Assessment shortlist: ${a.title} (score ${m.score})`;
      await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [app.id, body.toStatus, note, actorId, 'officer']);
      await createNotification(c, tenantId, m.userId, 'application_status', `Application update: ${company}`,
        `Your application for ${drive.role} ${SHORTLIST_LABEL[body.toStatus] || body.toStatus}. ${note}`, { applicationId: app.id, driveId, status: body.toStatus, assessmentId: a.id });
      return 'changed';
    });
    if (res === 'changed') { items.push({ ...item, outcome: 'change' }); notify.push(m.userId); }
    else if (res === 'unchanged') items.push({ ...item, outcome: 'unchanged' });
    else items.push({ ...item, outcome: 'skipped', reason: 'INVALID_TRANSITION' });
  }
  const willChange = items.filter((i) => i.outcome === 'change').length;
  if (!body.dryRun) {
    await audit(pool, tenantId, actorId, 'assessment.shortlist', { assessmentId: a.id, driveId, toStatus: body.toStatus, minScore: body.minScore, topN: body.topN, changed: willChange });
    await pushToUsers(pool, push, notify, { title: `Application update: ${company}`, body: `Your application for ${drive.role} ${SHORTLIST_LABEL[body.toStatus] || body.toStatus}.`, data: { driveId, status: body.toStatus } }, now);
  }
  return {
    dryRun: body.dryRun, criteria: { minScore: body.minScore ?? null, topN: body.topN ?? null, toStatus: body.toStatus, driveId },
    matched: matched.length, willChange: body.dryRun ? willChange : 0, changed: body.dryRun ? 0 : willChange, unchanged: items.filter((i) => i.outcome === 'unchanged').length,
    pendingEvaluation: pending.length,
    skipped: items.filter((i) => i.outcome === 'skipped').map((i) => ({ studentId: i.studentId, name: i.name, reason: i.reason })), items,
  };
}

export { codeHash, unprocessable };
