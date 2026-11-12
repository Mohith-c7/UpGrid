import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { evaluateEligibility } from '../eligibility';
import { ApiError, badRequest, conflict, notFound, unprocessable } from '../errors';
import { createNotification, formatIst, getReminderSettings, inQuietHours } from '../notify';
import type { PushSender } from '../push';
import { toQuestion, num } from './bank';
import { getJudge } from './judge';
import { mergeSettings, questionInput, validateQuestionShape, type Audience, type Settings } from './schemas';

export const audit = (db: Db, tenantId: string, actorId: string | null, action: string, meta: Record<string, unknown>) =>
  db.query('INSERT INTO audit_events (tenant_id, actor_id, action, meta) VALUES ($1,$2,$3,$4)', [tenantId, actorId, action, JSON.stringify(meta)]);

// ------------------------------------------------------------------ audience
export class AudienceUnresolvedError extends Error {}
export type CohortResolver = (db: Db, tenantId: string, cohortId: string) => Promise<string[]>;
let cohortResolver: CohortResolver | null = null;
/** The ops/policy module registers its `resolveCohort` here; until then cohort audiences cannot be published. */
export const setCohortResolver = (fn: CohortResolver | null) => { cohortResolver = fn; };

export interface AudienceResolver { resolve(db: Db, ctx: { tenantId: string; driveId: string | null }, audience: Audience): Promise<string[]> }

export const defaultAudienceResolver: AudienceResolver = {
  async resolve(db, ctx, aud) {
    let ids: string[] = [];
    const driveId = ('driveId' in aud && aud.driveId) || ctx.driveId;
    switch (aud.type) {
      case 'all_students':
        ids = (await db.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL`, [ctx.tenantId])).rows.map((r) => r.id);
        break;
      case 'students':
        ids = (await db.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL AND id = ANY($2::uuid[])`, [ctx.tenantId, aud.studentIds])).rows.map((r) => r.id);
        break;
      case 'drive_applicants': {
        if (!driveId) throw new AudienceUnresolvedError('Link a drive to use drive applicants');
        ids = (await db.query(
          `SELECT DISTINCT a.user_id AS id FROM applications a JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL
            WHERE a.tenant_id=$1 AND a.drive_id=$2 AND a.status = ANY($3::text[])`, [ctx.tenantId, driveId, aud.statuses])).rows.map((r) => r.id);
        break;
      }
      case 'all_eligible': {
        if (!driveId) throw new AudienceUnresolvedError('Link a drive to use eligible students');
        const d = (await db.query('SELECT rules FROM drives WHERE id=$1 AND tenant_id=$2', [driveId, ctx.tenantId])).rows[0];
        if (!d) throw new AudienceUnresolvedError('Drive not found');
        const rows = (await db.query(
          `SELECT u.id, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id
            WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [ctx.tenantId])).rows;
        ids = rows.filter((r) => evaluateEligibility(d.rules, { academics: r.data?.academics, verification: r.verification }).status === 'eligible').map((r) => r.id);
        break;
      }
      case 'cohort': {
        if (!cohortResolver) throw new AudienceUnresolvedError('Cohort audiences are not available yet');
        const got = await cohortResolver(db, ctx.tenantId, aud.cohortId);
        ids = got.length
          ? (await db.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL AND id = ANY($2::uuid[])`, [ctx.tenantId, got])).rows.map((r) => r.id)
          : [];
        break;
      }
    }
    return Array.from(new Set(ids));
  },
};
let resolver: AudienceResolver = defaultAudienceResolver;
export const setAudienceResolver = (r: AudienceResolver | null) => { resolver = r ?? defaultAudienceResolver; };
export const getAudienceResolver = () => resolver;

// ------------------------------------------------------------------ loading / dto
export async function loadAssessment(db: Db, tenantId: string, id: string, lock = false) {
  const r = (await db.query(`SELECT * FROM assessments WHERE id=$1 AND tenant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, tenantId])).rows[0];
  if (!r) throw notFound('Assessment not found', 'ASSESSMENT_NOT_FOUND');
  return r;
}

export async function loadStructure(db: Db, assessmentId: string) {
  const sections = (await db.query('SELECT * FROM assessment_sections WHERE assessment_id=$1 ORDER BY ord', [assessmentId])).rows;
  const questions = (await db.query('SELECT * FROM assessment_questions WHERE assessment_id=$1 ORDER BY ord', [assessmentId])).rows;
  return { sections, questions };
}

export const iso = (d: any) => (d ? new Date(d).toISOString() : null);

export async function assessmentDto(db: Db, a: any, opts: { summary?: boolean } = {}) {
  const { sections, questions } = await loadStructure(db, a.id);
  const counts = (await db.query(
    `SELECT count(*)::int AS attempts, count(*) FILTER (WHERE status='submitted')::int AS submitted, count(*) FILTER (WHERE status='in_progress')::int AS in_progress
       FROM assessment_attempts WHERE assessment_id=$1`, [a.id])).rows[0];
  const aud = a.status === 'draft' ? null : Number((await db.query('SELECT count(*) FROM assessment_audience WHERE assessment_id=$1', [a.id])).rows[0].count);
  let drive: any = null;
  if (a.drive_id) {
    const d = (await db.query('SELECT id, company, role FROM drives WHERE id=$1', [a.drive_id])).rows[0];
    if (d) drive = { id: d.id, company: d.company?.name ?? null, role: d.role };
  }
  return {
    id: a.id, title: a.title, instructions: a.instructions, status: a.status, practice: a.is_practice,
    driveId: a.drive_id, drive, audience: Object.keys(a.audience || {}).length ? a.audience : null,
    opensAt: iso(a.opens_at), closesAt: iso(a.closes_at), durationMinutes: a.duration_minutes,
    settings: mergeSettings(a.settings),
    sections: opts.summary ? undefined : sections.map((s) => ({
      id: s.id, title: s.title, timeLimitMinutes: s.time_limit_minutes, cutoffMarks: num(s.cutoff_marks),
      questions: questions.filter((q) => q.section_id === s.id).map((q) => ({
        id: q.id, questionId: q.question_id, type: q.snapshot?.type, title: q.snapshot?.title, difficulty: q.snapshot?.difficulty,
        marks: num(q.marks), negativeMarks: num(q.negative_marks),
      })),
    })),
    totalMarks: num(a.total_marks), questionCount: a.question_count, sectionCount: sections.length,
    audienceCount: aud, resultsPublishedAt: iso(a.results_published_at), publishedAt: iso(a.published_at),
    createdBy: a.created_by, createdAt: iso(a.created_at), updatedAt: iso(a.updated_at),
    counts: { attempts: counts.attempts, submitted: counts.submitted, inProgress: counts.in_progress },
  };
}

export const snapshotOf = (q: any) => ({
  type: q.type, title: q.title, body: q.body, topic: q.topic, tags: q.tags, difficulty: q.difficulty, explanation: q.explanation,
  options: q.options, answer: q.answer, coding: q.coding, practice: q.practice,
});

/** Replaces sections + questions of a draft assessment. */
export async function saveStructure(db: Db, tenantId: string, assessmentId: string, sections: any[]) {
  const ids = Array.from(new Set(sections.flatMap((s) => s.questions.map((q: any) => q.questionId))));
  const bank = new Map<string, any>();
  if (ids.length) {
    for (const r of (await db.query('SELECT * FROM aq_questions WHERE tenant_id=$1 AND id = ANY($2::uuid[])', [tenantId, ids])).rows) bank.set(r.id, r);
  }
  const fields: Record<string, string> = {};
  sections.forEach((s, si) => s.questions.forEach((q: any, qi: number) => {
    const b = bank.get(q.questionId);
    if (!b) fields[`sections.${si}.questions.${qi}.questionId`] = 'Question not found';
    else if (b.status === 'archived') fields[`sections.${si}.questions.${qi}.questionId`] = 'Question is archived';
    else if (q.negativeMarks !== undefined && q.negativeMarks > (q.marks ?? Number(b.marks))) fields[`sections.${si}.questions.${qi}.negativeMarks`] = 'Cannot exceed marks';
  }));
  const dupe = new Set<string>();
  sections.forEach((s, si) => s.questions.forEach((q: any, qi: number) => {
    if (dupe.has(q.questionId)) fields[`sections.${si}.questions.${qi}.questionId`] = 'Question is used twice';
    dupe.add(q.questionId);
  }));
  if (Object.keys(fields).length) throw badRequest('Some questions are invalid', fields);

  const keepIds = sections.filter((s) => s.id).map((s) => s.id);
  await db.query('DELETE FROM assessment_questions WHERE assessment_id=$1', [assessmentId]);
  await db.query('DELETE FROM assessment_sections WHERE assessment_id=$1 AND NOT (id = ANY($2::uuid[]))', [assessmentId, keepIds]);
  let total = 0; let count = 0;
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    let sid: string | undefined;
    if (s.id) {
      const u = await db.query(`UPDATE assessment_sections SET title=$3, ord=$4, time_limit_minutes=$5, cutoff_marks=$6 WHERE id=$1 AND assessment_id=$2 RETURNING id`,
        [s.id, assessmentId, s.title, si, s.timeLimitMinutes ?? null, s.cutoffMarks ?? null]);
      sid = u.rows[0]?.id;
    }
    if (!sid) {
      sid = (await db.query(`INSERT INTO assessment_sections (tenant_id, assessment_id, title, ord, time_limit_minutes, cutoff_marks) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, assessmentId, s.title, si, s.timeLimitMinutes ?? null, s.cutoffMarks ?? null])).rows[0].id;
    }
    for (let qi = 0; qi < s.questions.length; qi++) {
      const q = s.questions[qi];
      const b = bank.get(q.questionId);
      const marks = q.marks ?? Number(b.marks);
      total += marks; count++;
      await db.query(
        `INSERT INTO assessment_questions (tenant_id, assessment_id, section_id, question_id, ord, marks, negative_marks, snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, assessmentId, sid, q.questionId, qi, marks, q.negativeMarks ?? Number(b.negative_marks), JSON.stringify(snapshotOf(b))]);
    }
  }
  await db.query('UPDATE assessments SET total_marks=$2, question_count=$3, updated_at=now() WHERE id=$1', [assessmentId, Math.round(total * 100) / 100, count]);
}

// ------------------------------------------------------------------ publish checks
export async function publishIssues(db: Db, a: any, now: Date, audienceCount: number | null, audienceError?: string): Promise<Record<string, string>> {
  const f: Record<string, string> = {};
  const { sections, questions } = await loadStructure(db, a.id);
  const settings: Settings = mergeSettings(a.settings);
  if (!a.title?.trim()) f.title = 'Title is required';
  if (!sections.length) f.sections = 'Add at least one section';
  if (!a.duration_minutes) f.durationMinutes = 'Set the duration';
  const bankIds = questions.map((q) => q.question_id).filter(Boolean);
  const bank = new Map<string, any>();
  if (bankIds.length) for (const r of (await db.query('SELECT * FROM aq_questions WHERE tenant_id=$1 AND id = ANY($2::uuid[])', [a.tenant_id, bankIds])).rows) bank.set(r.id, r);
  let total = 0;
  const judge = getJudge();
  sections.forEach((s, si) => {
    const qs = questions.filter((q) => q.section_id === s.id);
    if (!qs.length) f[`sections.${si}`] = 'Section has no questions';
    if (s.cutoff_marks !== null && qs.reduce((x, q) => x + Number(q.marks), 0) < Number(s.cutoff_marks)) f[`sections.${si}.cutoffMarks`] = 'Cutoff is higher than the section total';
    qs.forEach((q, qi) => {
      const b = bank.get(q.question_id);
      const path = `sections.${si}.questions.${qi}`;
      total += Number(q.marks);
      if (!b) { f[path] = 'Question no longer exists'; return; }
      if (b.status !== 'active') { f[path] = 'Question is archived'; return; }
      const parsed = questionInput.safeParse({
        type: b.type, title: b.title, body: b.body, topic: b.topic, tags: b.tags, difficulty: b.difficulty, marks: Number(b.marks), negativeMarks: Number(b.negative_marks),
        explanation: b.explanation, practice: b.practice, options: b.options, answer: b.answer, coding: b.coding,
      });
      if (!parsed.success) { f[path] = 'Question is invalid'; return; }
      const shape = validateQuestionShape(parsed.data);
      if (Object.keys(shape).length) { f[path] = `Question is invalid: ${Object.values(shape)[0]}`; return; }
      if (b.type === 'coding') {
        const tc = b.coding.testCases as any[];
        if (!tc.some((t) => t.kind === 'sample')) f[path] = 'Coding question needs at least 1 sample test';
        else if (tc.filter((t) => t.kind === 'hidden').length < 2) f[path] = 'Coding question needs at least 2 hidden tests';
        else if (!judge.isConfigured()) f[path] = 'Code execution is not configured, so coding questions cannot be published';
      }
    });
  });
  if (questions.length && total <= 0) f.totalMarks = 'Total marks must be greater than 0';
  if (!a.is_practice) {
    if (!a.opens_at) f.opensAt = 'Set the opening time';
    else if (new Date(a.opens_at).getTime() <= now.getTime()) f.opensAt = 'Opening time must be in the future';
    if (!a.closes_at) f.closesAt = 'Set the closing time';
    else if (a.opens_at && a.duration_minutes && new Date(a.closes_at).getTime() < new Date(a.opens_at).getTime() + a.duration_minutes * 60000) {
      f.closesAt = 'Window must be at least as long as the duration';
    }
  }
  if (settings.passCutoff) {
    const max = settings.passCutoff.type === 'marks' ? total : 100;
    if (settings.passCutoff.value > max) f['settings.passCutoff'] = 'Pass cutoff is higher than the maximum score';
  }
  if (audienceError) f.audience = audienceError;
  else if (!audienceCount) f.audience = 'The audience has no students';
  return f;
}

export async function resolveFor(db: Db, a: any): Promise<{ ids: string[]; error?: string }> {
  const aud: Audience | null = a.is_practice ? { type: 'all_students' } : Object.keys(a.audience || {}).length ? a.audience : null;
  if (!aud) return { ids: [], error: 'Choose who can take this test' };
  try {
    return { ids: await getAudienceResolver().resolve(db, { tenantId: a.tenant_id, driveId: a.drive_id }, aud) };
  } catch (e) {
    if (e instanceof AudienceUnresolvedError) return { ids: [], error: e.message };
    throw e;
  }
}

// ------------------------------------------------------------------ notifications and reminders
export async function pushToUsers(pool: Pool, push: PushSender, userIds: string[], msg: { title: string; body: string; data: Record<string, unknown> }, now = new Date()) {
  if (!userIds.length) return;
  const rows = (await pool.query(
    `SELECT d.expo_push_token, d.user_id FROM devices d WHERE d.user_id = ANY($1::uuid[])`, [userIds])).rows;
  const out: any[] = [];
  const cache = new Map<string, boolean>();
  for (const r of rows) {
    if (!cache.has(r.user_id)) {
      const st = await getReminderSettings(pool, r.user_id);
      cache.set(r.user_id, st.push && !inQuietHours(st.quietHours, now));
    }
    if (cache.get(r.user_id)) out.push({ to: r.expo_push_token, title: msg.title, body: msg.body, data: msg.data, sound: 'default' as const, channelId: 'assessments' });
  }
  if (!out.length) return;
  try {
    const res = await push(out);
    if (res?.invalidTokens?.length) await pool.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [res.invalidTokens]);
  } catch { /* push is best effort */ }
}

export const REMINDER_MINUTES = { t60: 60, t15: 15 } as const;

export async function scheduleStartReminders(db: Db, a: any, userIds: string[], now = new Date()) {
  if (a.is_practice || !a.opens_at || !userIds.length) return 0;
  let n = 0;
  for (const [kind, min] of Object.entries(REMINDER_MINUTES)) {
    const fireAt = new Date(new Date(a.opens_at).getTime() - min * 60000);
    if (fireAt.getTime() <= now.getTime()) continue;
    const r = await db.query(
      `INSERT INTO assessment_reminders (tenant_id, assessment_id, user_id, kind, fire_at)
       SELECT $1, $2, u, $3, $4 FROM unnest($5::uuid[]) AS u
       ON CONFLICT (assessment_id, user_id, kind) DO UPDATE SET fire_at=EXCLUDED.fire_at, status='pending', processed_at=NULL
         WHERE assessment_reminders.fire_at <> EXCLUDED.fire_at OR assessment_reminders.status='cancelled'`,
      [a.tenant_id, a.id, kind, fireAt, userIds]);
    n += r.rowCount ?? 0;
  }
  return n;
}

export const cancelReminders = (db: Db, assessmentId: string) =>
  db.query(`UPDATE assessment_reminders SET status='cancelled', processed_at=now() WHERE assessment_id=$1 AND status='pending'`, [assessmentId]);

export async function notifyPublished(db: Db, a: any, userIds: string[]) {
  if (a.is_practice) return;
  const title = `New test: ${a.title}`;
  const body = `Opens ${formatIst(new Date(a.opens_at))}. Duration ${a.duration_minutes} minutes.`;
  for (const uid of userIds) await createNotification(db, a.tenant_id, uid, 'assessment_published', title, body, { assessmentId: a.id, opensAt: iso(a.opens_at) });
}

/** Publish: validates, snapshots questions, materialises the audience, notifies, schedules reminders. Idempotent. */
export async function publishAssessment(pool: Pool, push: PushSender, tenantId: string, actorId: string, id: string, now = new Date()) {
  const out = await withTx(pool, async (c) => {
    const a = await loadAssessment(c, tenantId, id, true);
    if (a.status === 'published') return { replayed: true as const, a, notify: [] as string[], audienceCount: Number((await c.query('SELECT count(*) FROM assessment_audience WHERE assessment_id=$1', [id])).rows[0].count) };
    if (a.status === 'archived') throw conflict('ASSESSMENT_LOCKED', 'Archived assessments cannot be published');
    const { ids, error } = await resolveFor(c, a);
    const issues = await publishIssues(c, a, now, ids.length, error);
    if (Object.keys(issues).length) throw unprocessable('NOT_PUBLISHABLE', 'The assessment is not ready to publish', issues);
    // freeze the questions as they are now
    const qs = (await c.query('SELECT id, question_id FROM assessment_questions WHERE assessment_id=$1', [id])).rows;
    const bank = new Map((await c.query('SELECT * FROM aq_questions WHERE id = ANY($1::uuid[])', [qs.map((q) => q.question_id)])).rows.map((r) => [r.id, r]));
    for (const q of qs) await c.query('UPDATE assessment_questions SET snapshot=$2 WHERE id=$1', [q.id, JSON.stringify(snapshotOf(bank.get(q.question_id)))]);
    await c.query(`INSERT INTO assessment_audience (assessment_id, user_id, tenant_id) SELECT $1, u, $2 FROM unnest($3::uuid[]) AS u ON CONFLICT DO NOTHING`, [id, tenantId, ids]);
    const settings = mergeSettings(a.settings);
    const upd = (await c.query(
      `UPDATE assessments SET status='published', published_at=$2, updated_at=$2, settings=$3, audience=CASE WHEN is_practice THEN '{"type":"all_students"}'::jsonb ELSE audience END WHERE id=$1 RETURNING *`,
      [id, now, JSON.stringify(settings)])).rows[0];
    await notifyPublished(c, upd, ids);
    await scheduleStartReminders(c, upd, ids, now);
    await audit(c, tenantId, actorId, 'assessment.published', { assessmentId: id, audience: ids.length });
    return { replayed: false as const, a: upd, notify: ids, audienceCount: ids.length };
  });
  if (!out.replayed && !out.a.is_practice) {
    await pushToUsers(pool, push, out.notify, { title: `New test: ${out.a.title}`, body: `Opens ${formatIst(new Date(out.a.opens_at))}.`, data: { assessmentId: out.a.id, type: 'assessment_published' } }, now);
  }
  return out;
}

export { toQuestion, ApiError };
