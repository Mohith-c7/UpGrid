import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, badRequest, conflict, forbidden, notFound, unprocessable } from '../errors';
import { toCompany } from '../drives';
import type { PushSender } from '../push';
import { TRANSITIONS, AppStatus } from '../routes/applications';
import { formatPhone } from '../validation';
import {
  DriveAccess, getSettings, getSharedCandidate, loadVisibleApplication, recruiterVisibleSql, resolveResume, SHARED_KEYS,
} from './access';
import { getApprovedQuestionSet, markQuestionSetAttached } from '../ai/questionSets';
import { applyOneStatus, RoundStatus } from './rounds';
import { audit, iso, officerIds, Outbox } from './shared';

// ------------------------------------------------------------------ list / detail
export const CANDIDATE_SORTS = ['newest', 'name', 'cgpa', 'score'] as const;

const sharedFieldsOut = (data: any, keys: string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if ((SHARED_KEYS as readonly string[]).includes(k)) out[k] = data?.[k] ?? null;
  if (typeof out.phone === 'string' && /^\d{10}$/.test(out.phone)) out.phoneDisplay = formatPhone(out.phone);
  return out;
};

export interface CandidateQuery {
  q?: string; status?: string; decision?: string; roundId?: string; roundStatus?: string; department?: string; minCgpa?: number;
  sort: (typeof CANDIDATE_SORTS)[number]; limit: number; offset: number;
}

export async function listCandidates(db: Db, access: DriveAccess, q: CandidateQuery) {
  const settings = await getSettings(db, access.drive.id);
  // Blind scorecards: a recruiter must not learn score-derived aggregates (or a score ranking) before submitting their own scorecard.
  const blind = access.role === 'recruiter' && settings.blindScorecards;
  if (blind && q.sort === 'score') throw badRequest('Sorting by score is not available while blind scorecards are enabled', { sort: 'Score sorting is disabled in blind scorecard mode' });
  const params: unknown[] = [access.drive.id, access.tenantId];
  let where = `a.drive_id=$1 AND a.tenant_id=$2 AND a.status <> 'withdrawn' AND ` + (access.role === 'recruiter' ? recruiterVisibleSql(settings.showUnscreened) : 'TRUE');
  const add = (sql: string, v: unknown) => { params.push(v); where += ` AND ${sql.replace('$$', '$' + params.length)}`; };
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    add(`(sf.data->>'name' ILIKE $$ OR sf.data->>'registrationNumber' ILIKE $$ OR sf.data->>'email' ILIKE $$)`, like);
  }
  if (q.status) add('a.status = $$', q.status);
  if (q.decision) add('cd.decision = $$', q.decision);
  if (q.department) add(`lower(sf.data->>'department') = lower($$)`, q.department);
  if (q.minCgpa !== undefined) add(`(CASE WHEN jsonb_typeof(sf.data->'cgpa')='number' THEN (sf.data->>'cgpa')::numeric END) >= $$`, q.minCgpa);
  if (q.roundId) {
    params.push(q.roundId);
    const rid = '$' + params.length;
    if (q.roundStatus) { params.push(q.roundStatus); where += ` AND EXISTS (SELECT 1 FROM round_candidates f WHERE f.application_id=a.id AND f.round_id=${rid} AND f.status=$${params.length})`; }
    else where += ` AND EXISTS (SELECT 1 FROM round_candidates f WHERE f.application_id=a.id AND f.round_id=${rid})`;
  } else if (q.roundStatus) {
    add('EXISTS (SELECT 1 FROM round_candidates f WHERE f.application_id=a.id AND f.status=$$)', q.roundStatus);
  }
  const from = `FROM applications a LEFT JOIN application_shared_fields sf ON sf.application_id=a.id LEFT JOIN candidate_decisions cd ON cd.application_id=a.id`;
  const order = {
    newest: 'a.submitted_at DESC, a.id',
    name: `lower(sf.data->>'name') ASC, a.id`,
    cgpa: `(CASE WHEN jsonb_typeof(sf.data->'cgpa')='number' THEN (sf.data->>'cgpa')::numeric END) DESC NULLS LAST, a.id`,
    score: 'avg_score DESC NULLS LAST, a.id',
  }[q.sort];
  const total = (await db.query(`SELECT count(*)::int n ${from} WHERE ${where}`, params)).rows[0].n;
  const rows = (await db.query(
    `SELECT a.id, a.reference, a.status, a.submitted_at, a.resume_snapshot, sf.data, sf.field_keys, cd.decision, cd.reason AS decision_reason,
            cr.round_id AS cur_round_id, cr.name AS cur_round_name, cr.seq AS cur_round_seq, cr.rc_status AS cur_round_status,
            (SELECT count(*)::int FROM scorecards s WHERE s.application_id=a.id) AS scorecard_count,
            (SELECT avg(overall) FROM scorecards s WHERE s.application_id=a.id${blind ? ` AND s.round_id IN (SELECT m.round_id FROM scorecards m WHERE m.application_id=a.id AND m.recruiter_id=$${params.length + 1})` : ''}) AS avg_score,
            EXISTS (SELECT 1 FROM offers o WHERE o.application_id=a.id AND o.status IN ('pending_approval','issued','accepted','joined')) AS has_offer
       ${from}
       LEFT JOIN LATERAL (SELECT r.id AS round_id, r.name, r.seq, rc.status AS rc_status FROM round_candidates rc JOIN drive_rounds r ON r.id=rc.round_id WHERE rc.application_id=a.id ORDER BY r.seq DESC LIMIT 1) cr ON true
      WHERE ${where} ORDER BY ${order} LIMIT ${q.limit + 1} OFFSET ${q.offset}`, blind ? [...params, access.userId] : params)).rows;
  const items = rows.slice(0, q.limit).map((r) => ({
    applicationId: r.id, reference: r.reference, status: r.status, submittedAt: iso(r.submitted_at),
    candidate: sharedFieldsOut(r.data, r.field_keys ?? []), resume: { label: r.resume_snapshot?.label ?? null },
    decision: r.decision ?? null, decisionReason: r.decision_reason ?? null,
    currentRound: r.cur_round_id ? { roundId: r.cur_round_id, name: r.cur_round_name, seq: r.cur_round_seq, status: r.cur_round_status } : null,
    scorecardCount: r.scorecard_count, avgScore: r.avg_score === null ? null : Number(Number(r.avg_score).toFixed(2)), hasOffer: r.has_offer,
  }));
  return { items, hasMore: rows.length > q.limit, total };
}

export const noteDto = (n: any) => ({ id: n.id, body: n.body, visibility: n.visibility, author: { id: n.author_id, name: n.author_name, role: n.author_role }, createdAt: iso(n.created_at) });
export const outcomeDto = (o: any) => ({
  id: o.id, applicationId: o.application_id, kind: o.kind, reason: o.reason ?? null, note: o.note ?? null, status: o.status,
  proposedBy: o.proposed_by ? { id: o.proposed_by, name: o.proposer_name ?? null } : null, decidedBy: o.decided_by ?? null,
  decidedAt: iso(o.decided_at), decisionNote: o.decision_note ?? null, createdAt: iso(o.created_at),
});

export async function listNotes(db: Db, access: DriveAccess, applicationId: string) {
  return (await db.query(
    `SELECT n.*, u.name AS author_name, u.role AS author_role FROM candidate_notes n JOIN users u ON u.id=n.author_id
      WHERE n.application_id=$1 AND n.tenant_id=$2 AND (n.visibility='team' OR n.author_id=$3 ${access.role === 'officer' ? '' : ''}) ORDER BY n.created_at, n.id`,
    [applicationId, access.tenantId, access.userId])).rows.map(noteDto);
}

export async function candidateDetail(db: Db, access: DriveAccess, applicationId: string) {
  const a = await loadVisibleApplication(db, access, applicationId);
  const shared = await getSharedCandidate(a.id, db);
  if (!shared) throw notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
  const resumeView = await resolveResume(a.resume_snapshot, { applicationId: a.id, viewerId: access.userId });
  const events = (await db.query('SELECT status, note, actor_role, created_at FROM application_events WHERE application_id=$1 ORDER BY id', [a.id])).rows;
  const rounds = (await db.query(
    `SELECT r.id, r.name, r.seq, r.kind, rc.status, rc.waitlisted FROM round_candidates rc JOIN drive_rounds r ON r.id=rc.round_id WHERE rc.application_id=$1 ORDER BY r.seq`, [a.id])).rows;
  const dec = (await db.query('SELECT decision, reason FROM candidate_decisions WHERE application_id=$1', [a.id])).rows[0];
  const notes = await listNotes(db, access, a.id);
  const sc = await listScorecards(db, access, a.id, undefined);
  // Blind mode: aggregates only cover rounds in which this recruiter has submitted their own scorecard (same rule as listScorecards).
  const blind = access.role === 'recruiter' && (await getSettings(db, access.drive.id)).blindScorecards;
  const vis = blind ? 's.round_id IN (SELECT m.round_id FROM scorecards m WHERE m.application_id=$1 AND m.recruiter_id=$2)' : 'TRUE';
  const aggParams = blind ? [a.id, access.userId] : [a.id];
  const summary = (await db.query(`SELECT count(*)::int n, avg(overall) FILTER (WHERE ${vis}) av FROM scorecards s WHERE s.application_id=$1`, aggParams)).rows[0];
  const byRec: Record<string, number> = {};
  for (const r of (await db.query(`SELECT recommendation, count(*)::int n FROM scorecards s WHERE s.application_id=$1 AND ${vis} GROUP BY 1`, aggParams)).rows) byRec[r.recommendation] = r.n;
  const schedule = (await db.query(`SELECT type, scheduled_at, mode, venue_or_link, instructions FROM application_schedules WHERE application_id=$1 AND superseded_at IS NULL`, [a.id])).rows[0];
  const outcome = (await db.query(`SELECT o.*, u.name AS proposer_name FROM outcome_proposals o LEFT JOIN users u ON u.id=o.proposed_by WHERE o.application_id=$1 ORDER BY o.created_at DESC LIMIT 1`, [a.id])).rows[0];
  const offer = (await db.query(`SELECT id, status, total_lpa, expires_at FROM offers WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1`, [a.id])).rows[0];
  if (access.role === 'recruiter') await audit(db, access.tenantId, access.userId, 'candidate.view', { driveId: access.drive.id, applicationId: a.id });
  return {
    applicationId: a.id, reference: a.reference, status: a.status, submittedAt: iso(a.submitted_at),
    fields: shared.fields, fieldKeys: shared.fieldKeys, verification: shared.verification,
    resume: resumeView, answers: shared.answers,
    events: events.map((e) => ({ status: e.status, note: e.note, actorRole: e.actor_role, createdAt: iso(e.created_at) })),
    rounds: rounds.map((r) => ({ roundId: r.id, name: r.name, seq: r.seq, kind: r.kind, status: r.status, waitlisted: r.waitlisted })),
    decision: dec?.decision ?? null, decisionReason: dec?.reason ?? null,
    notes, scorecards: sc.items,
    scoreSummary: { count: summary.n, avg: summary.av === null ? null : Number(Number(summary.av).toFixed(2)), byRecommendation: byRec, ...(blind ? { hiddenCount: sc.hiddenCount } : {}) },
    schedule: schedule ? { type: schedule.type, scheduledAt: iso(schedule.scheduled_at), mode: schedule.mode, venueOrLink: schedule.venue_or_link, instructions: schedule.instructions ?? null } : null,
    outcome: outcome ? outcomeDto(outcome) : null,
    offer: offer ? { id: offer.id, status: offer.status, totalLpa: Number(offer.total_lpa), expiresAt: iso(offer.expires_at) } : null,
  };
}

export async function candidateResume(db: Db, access: DriveAccess, applicationId: string) {
  const a = await loadVisibleApplication(db, access, applicationId);
  const v = await resolveResume(a.resume_snapshot, { applicationId: a.id, viewerId: access.userId });
  if (access.role === 'recruiter') await audit(db, access.tenantId, access.userId, 'candidate.resume_view', { driveId: access.drive.id, applicationId: a.id });
  return { url: v.url, signed: v.signed, expiresAt: v.expiresAt, label: v.label };
}

// ------------------------------------------------------------------ decisions
export type Decision = 'shortlisted' | 'rejected' | 'on_hold' | 'clear';
export async function setDecision(pool: Pool, push: PushSender, access: DriveAccess, applicationIds: string[], decision: Decision, reason: string | null) {
  const failed: { applicationId: string; reason: string }[] = [];
  let updated = 0;
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const o = new Outbox(c, access.tenantId);
    ob.push(o);
    const done: string[] = [];
    for (const id of Array.from(new Set(applicationIds))) {
      try { await loadVisibleApplication(c, access, id, { lock: true }); } catch (e) { if (e instanceof ApiError) { failed.push({ applicationId: id, reason: e.message }); continue; } throw e; }
      if (decision === 'clear') await c.query('DELETE FROM candidate_decisions WHERE application_id=$1', [id]);
      else {
        await c.query(
          `INSERT INTO candidate_decisions (application_id, tenant_id, drive_id, decision, reason, decided_by) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (application_id) DO UPDATE SET decision=EXCLUDED.decision, reason=EXCLUDED.reason, decided_by=EXCLUDED.decided_by, decided_at=now()`,
          [id, access.tenantId, access.drive.id, decision, reason, access.userId]);
      }
      await audit(c, access.tenantId, access.userId, 'candidate.decision', { driveId: access.drive.id, applicationId: id, decision, reason });
      done.push(id); updated++;
    }
    if (done.length && access.role === 'recruiter' && decision !== 'clear') {
      const who = (await c.query('SELECT name FROM users WHERE id=$1', [access.userId])).rows[0]?.name ?? 'A recruiter';
      await o.sendMany(await officerIds(c, access.tenantId), 'pipeline', `${toCompany(access.drive.company).name}: ${decision.replace('_', ' ')}`,
        `${who} marked ${done.length} candidate${done.length === 1 ? '' : 's'} as ${decision.replace('_', ' ')}.`, { driveId: access.drive.id, applicationIds: done.slice(0, 20), decision });
    }
    return { updated, failed };
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

// ------------------------------------------------------------------ notes
export async function addNote(db: Db, access: DriveAccess, applicationId: string, body: string, visibility: 'team' | 'private') {
  const a = await loadVisibleApplication(db, access, applicationId);
  const n = (await db.query(
    `INSERT INTO candidate_notes (tenant_id, drive_id, application_id, author_id, body, visibility) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [access.tenantId, access.drive.id, a.id, access.userId, body, visibility])).rows[0];
  await audit(db, access.tenantId, access.userId, 'candidate.note', { driveId: access.drive.id, applicationId: a.id, noteId: n.id, visibility });
  const u = (await db.query('SELECT name, role FROM users WHERE id=$1', [access.userId])).rows[0];
  return noteDto({ id: n.id, body, visibility, author_id: access.userId, author_name: u.name, author_role: u.role, created_at: n.created_at });
}
export async function deleteNote(db: Db, access: DriveAccess, applicationId: string, noteId: string) {
  const n = (await db.query('SELECT * FROM candidate_notes WHERE id=$1 AND application_id=$2 AND drive_id=$3 AND tenant_id=$4', [noteId, applicationId, access.drive.id, access.tenantId])).rows[0];
  if (!n || (n.visibility === 'private' && n.author_id !== access.userId)) throw notFound('Note not found', 'NOTE_NOT_FOUND');
  if (n.author_id !== access.userId && access.role !== 'officer') throw forbidden('Only the author or a placement officer can delete this note');
  await db.query('DELETE FROM candidate_notes WHERE id=$1', [noteId]);
  await audit(db, access.tenantId, access.userId, 'candidate.note_delete', { driveId: access.drive.id, applicationId, noteId });
}

// ------------------------------------------------------------------ rubric + scorecards
export interface RubricItem { id: string; label: string; description: string | null }
export interface RubricRow { id: string; roundId: string | null; version: number; items: RubricItem[] }
const rubricDto = (r: any): RubricRow => ({ id: r.id, roundId: r.round_id ?? null, version: r.version, items: r.items });

export async function effectiveRubric(db: Db, driveId: string, roundId: string | null): Promise<RubricRow | null> {
  if (roundId) {
    const r = (await db.query('SELECT * FROM drive_rubrics WHERE drive_id=$1 AND round_id=$2', [driveId, roundId])).rows[0];
    if (r) return rubricDto(r);
  }
  const d = (await db.query('SELECT * FROM drive_rubrics WHERE drive_id=$1 AND round_id IS NULL', [driveId])).rows[0];
  return d ? rubricDto(d) : null;
}

export async function putRubric(db: Db, tenantId: string, actorId: string, driveId: string, roundId: string | null, items: { id?: string; label: string; description?: string | null }[]) {
  const seen = new Set<string>();
  const clean: RubricItem[] = items.map((i) => {
    const id = i.id ?? 'i_' + crypto.randomBytes(4).toString('hex');
    if (seen.has(id)) throw new ApiError(400, 'VALIDATION_ERROR', 'Duplicate item id', { items: 'Duplicate item id' });
    seen.add(id);
    return { id, label: i.label, description: i.description ?? null };
  });
  const row = (await db.query(
    roundId
      ? `INSERT INTO drive_rubrics (tenant_id, drive_id, round_id, items, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (drive_id, round_id) WHERE round_id IS NOT NULL DO UPDATE SET items=EXCLUDED.items, version=drive_rubrics.version+1, updated_by=EXCLUDED.updated_by, updated_at=now() RETURNING *`
      : `INSERT INTO drive_rubrics (tenant_id, drive_id, round_id, items, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (drive_id) WHERE round_id IS NULL DO UPDATE SET items=EXCLUDED.items, version=drive_rubrics.version+1, updated_by=EXCLUDED.updated_by, updated_at=now() RETURNING *`,
    [tenantId, driveId, roundId, JSON.stringify(clean), actorId])).rows[0];
  await audit(db, tenantId, actorId, 'rubric.update', { driveId, roundId, version: row.version, items: clean.length });
  return rubricDto(row);
}

export const RECOMMENDATIONS = ['strong_hire', 'hire', 'no_hire', 'strong_no_hire'] as const;
export const scorecardDto = (s: any) => ({
  id: s.id, roundId: s.round_id, applicationId: s.application_id, recruiter: { id: s.recruiter_id, name: s.recruiter_name ?? null },
  ratings: s.ratings, overall: Number(s.overall), comments: s.comments ?? null, recommendation: s.recommendation,
  rubricVersion: s.rubric_version, revision: s.revision, submittedAt: iso(s.submitted_at), updatedAt: iso(s.updated_at),
});

export async function submitScorecard(
  pool: Pool, access: DriveAccess, applicationId: string, roundId: string,
  input: { ratings: { itemId: string; rating: number }[]; comments: string | null; recommendation: string; questionSetId?: string | null },
) {
  return withTx(pool, async (c) => {
    const a = await loadVisibleApplication(c, access, applicationId, { lock: true });
    if (input.questionSetId) {
      // only a human-approved AI question set for THIS application may be attached
      const qs = await getApprovedQuestionSet(c, access.tenantId, input.questionSetId);
      if (!qs || qs.applicationId !== a.id) throw unprocessable('QUESTION_SET_NOT_APPROVED', 'Attach an approved AI question set generated for this candidate');
    }
    const round = (await c.query('SELECT id FROM drive_rounds WHERE id=$1 AND drive_id=$2', [roundId, access.drive.id])).rows[0];
    if (!round) throw notFound('Round not found', 'ROUND_NOT_FOUND');
    const inRound = (await c.query('SELECT 1 FROM round_candidates WHERE round_id=$1 AND application_id=$2', [roundId, a.id])).rowCount;
    if (!inRound) throw unprocessable('NOT_IN_ROUND', 'The candidate is not in this round');
    const rubric = await effectiveRubric(c, access.drive.id, roundId);
    if (!rubric) throw unprocessable('NO_RUBRIC', 'The placement officer has not defined a rubric for this drive yet');
    const fields: Record<string, string> = {};
    const byId = new Map<string, number>();
    for (const r of input.ratings) {
      const key = `ratings.${r.itemId}`;
      if (!rubric.items.some((i) => i.id === r.itemId)) fields[key] = 'Unknown rubric item';
      else if (byId.has(r.itemId)) fields[key] = 'Rated more than once';
      else if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) fields[key] = 'Rating must be a whole number from 1 to 5';
      else byId.set(r.itemId, r.rating);
    }
    for (const i of rubric.items) if (!byId.has(i.id) && !fields[`ratings.${i.id}`]) fields[`ratings.${i.id}`] = `Rate "${i.label}"`;
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    const ratings = rubric.items.map((i) => ({ itemId: i.id, label: i.label, rating: byId.get(i.id)! }));
    const overall = Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 100) / 100;
    const row = (await c.query(
      `INSERT INTO scorecards (tenant_id, drive_id, round_id, application_id, recruiter_id, ratings, overall, comments, recommendation, rubric_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (round_id, application_id, recruiter_id) DO UPDATE SET ratings=EXCLUDED.ratings, overall=EXCLUDED.overall, comments=EXCLUDED.comments,
         recommendation=EXCLUDED.recommendation, rubric_version=EXCLUDED.rubric_version, revision=scorecards.revision+1, updated_at=now()
       RETURNING *, (xmax = 0) AS created`,
      [access.tenantId, access.drive.id, roundId, a.id, access.userId, JSON.stringify(ratings), overall, input.comments, input.recommendation, rubric.version])).rows[0];
    if (input.questionSetId) await markQuestionSetAttached(c, access.tenantId, input.questionSetId, row.id);
    await audit(c, access.tenantId, access.userId, 'scorecard.submit', { driveId: access.drive.id, applicationId: a.id, roundId, overall, recommendation: input.recommendation, revision: row.revision, ...(input.questionSetId ? { questionSetId: input.questionSetId } : {}) });
    const u = (await c.query('SELECT name FROM users WHERE id=$1', [access.userId])).rows[0];
    return { created: row.created as boolean, scorecard: scorecardDto({ ...row, recruiter_name: u.name }) };
  });
}

export async function listScorecards(db: Db, access: DriveAccess, applicationId: string, roundId: string | undefined) {
  const params: unknown[] = [applicationId, access.tenantId];
  let where = 's.application_id=$1 AND s.tenant_id=$2';
  if (roundId) { params.push(roundId); where += ` AND s.round_id=$${params.length}`; }
  const rows = (await db.query(`SELECT s.*, u.name AS recruiter_name FROM scorecards s JOIN users u ON u.id=s.recruiter_id WHERE ${where} ORDER BY s.submitted_at, s.id`, params)).rows;
  if (access.role === 'officer') return { items: rows.map(scorecardDto), hiddenCount: 0 };
  const blind = (await getSettings(db, access.drive.id)).blindScorecards;
  if (!blind) return { items: rows.map(scorecardDto), hiddenCount: 0 };
  const mineRounds = new Set(rows.filter((r) => r.recruiter_id === access.userId).map((r) => r.round_id));
  const visible = rows.filter((r) => r.recruiter_id === access.userId || mineRounds.has(r.round_id));
  return { items: visible.map(scorecardDto), hiddenCount: rows.length - visible.length };
}

// ------------------------------------------------------------------ outcomes
export async function proposeOutcome(pool: Pool, push: PushSender, access: DriveAccess, applicationId: string, kind: 'select' | 'reject', reason: string | null, note: string | null) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const a = await loadVisibleApplication(c, access, applicationId, { lock: true });
    const target: AppStatus = kind === 'select' ? 'selected' : 'rejected';
    if (!TRANSITIONS[a.status as AppStatus].includes(target)) throw unprocessable('INVALID_STATE', `An application that is ${a.status} cannot be moved to ${target}`);
    const o = (await c.query(
      `INSERT INTO outcome_proposals (tenant_id, drive_id, application_id, kind, reason, note, proposed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [access.tenantId, access.drive.id, a.id, kind, reason, note, access.userId]).catch((e: any) => {
        if (e?.code === '23505') throw conflict('OUTCOME_PENDING', 'An outcome proposal for this candidate is already waiting for approval');
        throw e;
      })).rows[0];
    await audit(c, access.tenantId, access.userId, 'outcome.propose', { driveId: access.drive.id, applicationId: a.id, outcomeId: o.id, kind });
    const ox = new Outbox(c, access.tenantId);
    ob.push(ox);
    const who = (await c.query('SELECT name FROM users WHERE id=$1', [access.userId])).rows[0]?.name ?? 'A recruiter';
    if (access.role === 'recruiter') {
      await ox.sendMany(await officerIds(c, access.tenantId), 'pipeline', `Outcome to approve: ${toCompany(access.drive.company).name}`,
        `${who} proposes to ${kind === 'select' ? 'select' : 'reject'} a candidate (${a.reference}).`, { driveId: access.drive.id, applicationId: a.id, outcomeId: o.id });
    }
    return outcomeDto({ ...o, proposer_name: who });
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

export async function listOutcomes(db: Db, access: DriveAccess, status: string | undefined, limit: number, offset: number) {
  const params: unknown[] = [access.drive.id, access.tenantId];
  let where = 'o.drive_id=$1 AND o.tenant_id=$2';
  if (status) { params.push(status); where += ` AND o.status=$${params.length}`; }
  const rows = (await db.query(
    `SELECT o.*, pu.name AS proposer_name, a.reference, a.status AS app_status, sf.data FROM outcome_proposals o JOIN applications a ON a.id=o.application_id
       LEFT JOIN users pu ON pu.id=o.proposed_by LEFT JOIN application_shared_fields sf ON sf.application_id=a.id
      WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
  return {
    items: rows.slice(0, limit).map((r) => ({ ...outcomeDto(r), reference: r.reference, applicationStatus: r.app_status, candidate: { name: r.data?.name ?? null, department: r.data?.department ?? null } })),
    hasMore: rows.length > limit,
  };
}

const STATUS_TEXT: Record<string, string> = { selected: 'has been shortlisted as selected', rejected: 'was not selected' };
export async function decideOutcome(pool: Pool, push: PushSender, officer: { id: string; tenantId: string; name: string }, outcomeId: string, decision: 'approve' | 'decline', note: string | null) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const o = (await c.query('SELECT * FROM outcome_proposals WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [outcomeId, officer.tenantId])).rows[0];
    if (!o) throw notFound('Outcome not found', 'OUTCOME_NOT_FOUND');
    const want = decision === 'approve' ? 'approved' : 'declined';
    if (o.status === want) return { replayed: true, o, appStatus: (await c.query('SELECT status FROM applications WHERE id=$1', [o.application_id])).rows[0].status as string };
    if (o.status !== 'pending') throw conflict('OUTCOME_DECIDED', `This outcome was already ${o.status}`);
    const a = (await c.query('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [o.application_id])).rows[0];
    const ox = new Outbox(c, officer.tenantId);
    ob.push(ox);
    const dr = (await c.query('SELECT company, role FROM drives WHERE id=$1', [a.drive_id])).rows[0];
    let appStatus = a.status as string;
    if (decision === 'approve') {
      const to: AppStatus = o.kind === 'select' ? 'selected' : 'rejected';
      if (!TRANSITIONS[a.status as AppStatus].includes(to)) throw unprocessable('INVALID_STATE', `The application is now ${a.status}; it cannot move to ${to}`);
      await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [a.id, to]);
      await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)',
        [a.id, to, [o.reason, note].filter(Boolean).join(' - ') || 'Approved by placement cell', officer.id, 'officer']);
      await ox.send(a.user_id, 'application_status', `Application update: ${toCompany(dr.company).name}`, `Your application for ${dr.role} ${STATUS_TEXT[to]}.`, { applicationId: a.id, driveId: a.drive_id, status: to });
      appStatus = to;
    }
    const upd = (await c.query(`UPDATE outcome_proposals SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [o.id, want, officer.id, note])).rows[0];
    await ox.send(o.proposed_by, 'pipeline', `Outcome ${want}`, `Your ${o.kind} proposal for ${a.reference} was ${want}.${note ? ' ' + note : ''}`, { driveId: a.drive_id, applicationId: a.id, outcomeId: o.id });
    await audit(c, officer.tenantId, officer.id, 'outcome.decide', { driveId: a.drive_id, applicationId: a.id, outcomeId: o.id, decision, kind: o.kind });
    return { replayed: false, o: upd, appStatus };
  });
  for (const o of ob) await o.flush(push, pool);
  return { outcome: outcomeDto(out.o), application: { id: out.o.application_id, status: out.appStatus }, replayed: out.replayed };
}

// ------------------------------------------------------------------ results upload
export interface ResultRow { applicationId?: string; reference?: string; result: RoundStatus; score?: number; remark?: string | null }
export async function uploadResults(pool: Pool, push: PushSender, access: DriveAccess, round: any, rows: ResultRow[]) {
  const actor = { id: access.userId, tenantId: access.tenantId, role: access.role, name: '' };
  let updated = 0, unchanged = 0;
  const failed: { row: number; reference: string | null; reason: string }[] = [];
  const outbox: Outbox[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let appId = r.applicationId ?? null;
    if (!appId && r.reference) {
      appId = (await pool.query('SELECT id FROM applications WHERE reference=$1 AND drive_id=$2 AND tenant_id=$3', [r.reference, access.drive.id, access.tenantId])).rows[0]?.id ?? null;
    }
    if (!appId) { failed.push({ row: i + 1, reference: r.reference ?? null, reason: 'Candidate not found in this drive' }); continue; }
    if (seen.has(appId)) { failed.push({ row: i + 1, reference: r.reference ?? null, reason: 'Duplicate row for this candidate' }); continue; }
    seen.add(appId);
    try {
      await loadVisibleApplication(pool, access, appId);
      const res = await applyOneStatus(pool, actor, access.drive.id, round, { applicationId: appId, status: r.result, remark: r.remark ?? undefined, score: r.score }, 'Result uploaded', access.drive, outbox);
      if (res === 'updated') updated++; else unchanged++;
    } catch (e) {
      if (e instanceof ApiError) failed.push({ row: i + 1, reference: r.reference ?? null, reason: e.message }); else throw e;
    }
  }
  await audit(pool, access.tenantId, access.userId, 'round.results_upload', { driveId: access.drive.id, roundId: round.id, total: rows.length, updated, unchanged, failed: failed.length });
  for (const o of outbox) await o.flush(push, pool);
  return { total: rows.length, updated, unchanged, failed };
}

export async function publishResults(pool: Pool, push: PushSender, officer: { id: string; tenantId: string }, drive: any, round: any) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const r = (await c.query('SELECT results_published_at FROM drive_rounds WHERE id=$1 FOR UPDATE', [round.id])).rows[0];
    if (r.results_published_at) return { ok: true, notified: 0 };
    await c.query('UPDATE drive_rounds SET results_published_at=now() WHERE id=$1', [round.id]);
    const rows = (await c.query(
      `SELECT rc.application_id, rc.status, a.user_id FROM round_candidates rc JOIN applications a ON a.id=rc.application_id
        WHERE rc.round_id=$1 AND rc.status IN ('passed','failed') AND NOT rc.waitlisted AND a.status <> 'withdrawn'`, [round.id])).rows;
    const o = new Outbox(c, officer.tenantId);
    ob.push(o);
    for (const x of rows) {
      await o.send(x.user_id, 'pipeline', `Result: ${round.name}`, `Your result for the ${round.name} round of ${toCompany(drive.company).name} is available.`, { applicationId: x.application_id, driveId: drive.id, roundId: round.id });
    }
    await audit(c, officer.tenantId, officer.id, 'round.publish_results', { driveId: drive.id, roundId: round.id, notified: rows.length });
    return { ok: true, notified: rows.length };
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

export async function studentRounds(db: Db, applicationId: string) {
  const rows = (await db.query(
    `SELECT r.id, r.name, r.kind, r.seq, r.results_published_at, rc.status, rc.waitlisted FROM round_candidates rc JOIN drive_rounds r ON r.id=rc.round_id
      WHERE rc.application_id=$1 ORDER BY r.seq`, [applicationId])).rows;
  return rows.map((r) => ({
    roundId: r.id, name: r.name, kind: r.kind, seq: r.seq, waitlisted: r.waitlisted,
    status: ['passed', 'failed', 'on_hold'].includes(r.status) && !r.results_published_at ? 'pending_results' : r.status,
  }));
}

// ------------------------------------------------------------------ messages
export const messageDto = (m: any) => ({ id: m.id, body: m.body, author: { id: m.author_id, name: m.author_name, role: m.author_role }, createdAt: iso(m.created_at) });

export async function listMessages(db: Db, access: DriveAccess, limit: number, offset: number) {
  const rows = (await db.query(
    `SELECT m.*, u.name AS author_name, u.role AS author_role FROM drive_messages m JOIN users u ON u.id=m.author_id WHERE m.drive_id=$1 AND m.tenant_id=$2 ORDER BY m.seq DESC LIMIT ${limit + 1} OFFSET ${offset}`,
    [access.drive.id, access.tenantId])).rows;
  return { items: rows.slice(0, limit).map(messageDto), hasMore: rows.length > limit };
}

export async function postMessage(pool: Pool, push: PushSender, access: DriveAccess, body: string, clientId: string | null) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    if (clientId) {
      const prior = (await c.query(`SELECT m.*, u.name AS author_name, u.role AS author_role FROM drive_messages m JOIN users u ON u.id=m.author_id WHERE m.drive_id=$1 AND m.author_id=$2 AND m.client_id=$3`, [access.drive.id, access.userId, clientId])).rows[0];
      if (prior) return { replayed: true, message: messageDto(prior) };
    }
    const m = (await c.query(`INSERT INTO drive_messages (tenant_id, drive_id, author_id, body, client_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [access.tenantId, access.drive.id, access.userId, body, clientId])).rows[0];
    const u = (await c.query('SELECT name, role FROM users WHERE id=$1', [access.userId])).rows[0];
    const recipients = [...(await officerIds(c, access.tenantId)), ...(await c.query(
      `SELECT cr.user_id FROM company_recruiters cr JOIN users x ON x.id=cr.user_id AND x.deleted_at IS NULL WHERE cr.drive_id=$1 AND cr.revoked_at IS NULL`, [access.drive.id])).rows.map((r) => r.user_id)]
      .filter((id) => id !== access.userId);
    const o = new Outbox(c, access.tenantId);
    ob.push(o);
    await o.sendMany(recipients, 'pipeline_message', `${toCompany(access.drive.company).name}: new message`, `${u.name}: ${body.length > 120 ? body.slice(0, 117) + '...' : body}`, { driveId: access.drive.id, messageId: m.id });
    await audit(c, access.tenantId, access.userId, 'message.post', { driveId: access.drive.id, messageId: m.id });
    return { replayed: false, message: messageDto({ ...m, author_name: u.name, author_role: u.role }) };
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}
