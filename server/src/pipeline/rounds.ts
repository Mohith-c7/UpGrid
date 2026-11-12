import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, badRequest, conflict, notFound, unprocessable } from '../errors';
import { toCompany } from '../drives';
import type { PushSender } from '../push';
import { audit, Outbox, STATUS_ACTIVE_FOR_ROUNDS } from './shared';

export const ROUND_KINDS = ['aptitude', 'assessment', 'coding', 'technical', 'hr', 'gd', 'custom'] as const;
export const ROUND_STATUSES = ['pending', 'invited', 'attended', 'absent', 'passed', 'failed', 'on_hold'] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];
export const MAX_ROUNDS = 12;

export const ROUND_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  pending: ['invited', 'attended', 'absent', 'passed', 'failed', 'on_hold'],
  invited: ['pending', 'attended', 'absent', 'passed', 'failed', 'on_hold'],
  attended: ['passed', 'failed', 'on_hold', 'absent'],
  absent: ['attended', 'invited', 'failed', 'on_hold'],
  on_hold: ['pending', 'invited', 'attended', 'absent', 'passed', 'failed'],
  passed: ['failed', 'on_hold'],
  failed: ['passed', 'on_hold'],
};
export const canRoundTransition = (from: RoundStatus, to: RoundStatus) => from === to || ROUND_TRANSITIONS[from].includes(to);

/** Which recruiter permission a target status needs (officers always pass). */
export function permissionForRoundStatus(s: RoundStatus): 'markAttendance' | 'uploadResults' | 'officer' {
  if (s === 'attended' || s === 'absent') return 'markAttendance';
  if (s === 'passed' || s === 'failed' || s === 'on_hold') return 'uploadResults';
  return 'officer';
}

const COUNT_KEYS = ['pending', 'invited', 'attended', 'absent', 'passed', 'failed', 'on_hold'] as const;
const emptyCounts = () => ({ pending: 0, invited: 0, attended: 0, absent: 0, passed: 0, failed: 0, onHold: 0, waitlisted: 0, total: 0 });

export const roundDto = (r: any, counts?: ReturnType<typeof emptyCounts>) => ({
  id: r.id, driveId: r.drive_id, seq: r.seq, name: r.name, kind: r.kind, assessmentId: r.assessment_id ?? null,
  description: r.description ?? null, mode: r.mode ?? null, venueOrLink: r.venue_or_link ?? null,
  scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
  resultsPublishedAt: r.results_published_at ? new Date(r.results_published_at).toISOString() : null,
  ...(counts ? { counts } : {}),
});

export async function roundCounts(db: Db, driveId: string): Promise<Map<string, ReturnType<typeof emptyCounts>>> {
  const rows = (await db.query(
    `SELECT rc.round_id, rc.status, rc.waitlisted, count(*)::int n FROM round_candidates rc JOIN applications a ON a.id=rc.application_id AND a.status <> 'withdrawn'
      WHERE rc.drive_id=$1 GROUP BY 1,2,3`, [driveId])).rows;
  const m = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const r of rows) {
    const c = m.get(r.round_id) ?? emptyCounts();
    if (r.waitlisted) c.waitlisted += r.n;
    else { (c as any)[r.status === 'on_hold' ? 'onHold' : r.status] += r.n; }
    c.total += r.n;
    m.set(r.round_id, c);
  }
  return m;
}

export async function listRounds(db: Db, driveId: string) {
  const rows = (await db.query('SELECT * FROM drive_rounds WHERE drive_id=$1 ORDER BY seq', [driveId])).rows;
  const counts = await roundCounts(db, driveId);
  return rows.map((r) => roundDto(r, counts.get(r.id) ?? emptyCounts()));
}

export async function loadRound(db: Db, tenantId: string, driveId: string, roundId: string, lock = false) {
  const r = (await db.query(`SELECT * FROM drive_rounds WHERE id=$1 AND drive_id=$2 AND tenant_id=$3 ${lock ? 'FOR UPDATE' : ''}`, [roundId, driveId, tenantId])).rows[0];
  if (!r) throw notFound('Round not found', 'ROUND_NOT_FOUND');
  return r;
}

async function checkAssessmentId(db: Db, tenantId: string, kind: string, assessmentId: string | null | undefined) {
  if (!assessmentId) return;
  if (!['aptitude', 'assessment', 'coding'].includes(kind)) throw new ApiError(400, 'VALIDATION_ERROR', 'assessmentId only applies to aptitude, assessment or coding rounds', { assessmentId: 'Not allowed for this round kind' });
  const t = (await db.query(`SELECT to_regclass('public.assessments') AS t`)).rows[0]?.t;
  if (!t) return; // assessments module not installed in this deployment
  const found = (await db.query('SELECT 1 FROM assessments WHERE id=$1 AND tenant_id=$2', [assessmentId, tenantId]).catch(() => ({ rowCount: 1 }))).rowCount;
  if (!found) throw new ApiError(400, 'VALIDATION_ERROR', 'Assessment not found', { assessmentId: 'Assessment not found' });
}

export interface RoundInput { name?: string; kind?: string; assessmentId?: string | null; description?: string | null; mode?: string | null; venueOrLink?: string | null; scheduledAt?: Date | null }

export async function createRound(pool: Pool, tenantId: string, actorId: string, driveId: string, i: Required<Pick<RoundInput, 'name' | 'kind'>> & RoundInput) {
  return withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rounds:${driveId}`]);
    const n = (await c.query('SELECT count(*)::int n, COALESCE(max(seq),0) m FROM drive_rounds WHERE drive_id=$1', [driveId])).rows[0];
    if (n.n >= MAX_ROUNDS) throw unprocessable('TOO_MANY_ROUNDS', `A drive can have at most ${MAX_ROUNDS} rounds`);
    await checkAssessmentId(c, tenantId, i.kind, i.assessmentId);
    const row = (await c.query(
      `INSERT INTO drive_rounds (tenant_id, drive_id, seq, name, kind, assessment_id, description, mode, venue_or_link, scheduled_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tenantId, driveId, n.m + 1, i.name, i.kind, i.assessmentId ?? null, i.description ?? null, i.mode ?? null, i.venueOrLink ?? null, i.scheduledAt ?? null, actorId])).rows[0];
    await audit(c, tenantId, actorId, 'round.create', { driveId, roundId: row.id, name: i.name, kind: i.kind });
    return roundDto(row, emptyCounts());
  });
}

export async function updateRound(pool: Pool, tenantId: string, actorId: string, driveId: string, roundId: string, i: RoundInput) {
  return withTx(pool, async (c) => {
    const cur = await loadRound(c, tenantId, driveId, roundId, true);
    const kind = i.kind ?? cur.kind;
    const assessmentId = i.assessmentId === undefined ? cur.assessment_id : i.assessmentId;
    if (i.kind && i.kind !== cur.kind && !['aptitude', 'assessment', 'coding'].includes(kind) && assessmentId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Remove assessmentId before changing to this kind', { assessmentId: 'Not allowed for this round kind' });
    }
    if (i.assessmentId !== undefined) await checkAssessmentId(c, tenantId, kind, i.assessmentId);
    const row = (await c.query(
      `UPDATE drive_rounds SET name=$2, kind=$3, assessment_id=$4, description=$5, mode=$6, venue_or_link=$7, scheduled_at=$8, updated_at=now() WHERE id=$1 RETURNING *`,
      [roundId, i.name ?? cur.name, kind, assessmentId ?? null, i.description === undefined ? cur.description : i.description,
        i.mode === undefined ? cur.mode : i.mode, i.venueOrLink === undefined ? cur.venue_or_link : i.venueOrLink,
        i.scheduledAt === undefined ? cur.scheduled_at : i.scheduledAt])).rows[0];
    await audit(c, tenantId, actorId, 'round.update', { driveId, roundId });
    const counts = await roundCounts(c, driveId);
    return roundDto(row, counts.get(roundId) ?? emptyCounts());
  });
}

export async function deleteRound(pool: Pool, tenantId: string, actorId: string, driveId: string, roundId: string) {
  await withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rounds:${driveId}`]);
    const cur = await loadRound(c, tenantId, driveId, roundId, true);
    const n = (await c.query('SELECT count(*)::int n FROM round_candidates WHERE round_id=$1', [roundId])).rows[0].n;
    if (n > 0) throw conflict('ROUND_HAS_CANDIDATES', 'Remove or move the candidates before deleting this round');
    await c.query('DELETE FROM drive_rounds WHERE id=$1', [roundId]);
    // close the gap (constraint is deferred)
    await c.query(`UPDATE drive_rounds SET seq = seq - 1 WHERE drive_id=$1 AND seq > $2`, [driveId, cur.seq]);
    await audit(c, tenantId, actorId, 'round.delete', { driveId, roundId, name: cur.name });
  });
}

export async function reorderRounds(pool: Pool, tenantId: string, actorId: string, driveId: string, roundIds: string[]) {
  return withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rounds:${driveId}`]);
    const cur = (await c.query('SELECT id FROM drive_rounds WHERE drive_id=$1 AND tenant_id=$2', [driveId, tenantId])).rows.map((r) => r.id);
    const same = cur.length === roundIds.length && new Set(roundIds).size === roundIds.length && roundIds.every((x) => cur.includes(x));
    if (!same) throw new ApiError(400, 'VALIDATION_ERROR', 'roundIds must list every round of the drive exactly once', { roundIds: 'Must list every round exactly once' });
    for (let i = 0; i < roundIds.length; i++) await c.query('UPDATE drive_rounds SET seq=$2, updated_at=now() WHERE id=$1', [roundIds[i], i + 1]);
    await audit(c, tenantId, actorId, 'round.reorder', { driveId, roundIds });
    return listRounds(c, driveId);
  });
}

// ------------------------------------------------------------------ candidates in a round
export interface Actor { id: string; tenantId: string; role: string; name: string }

export async function addCandidates(pool: Pool, actor: Actor, driveId: string, round: any, ids: string[] | 'allScreened') {
  return withTx(pool, async (c) => {
    let appIds: string[];
    if (ids === 'allScreened') {
      appIds = (await c.query(
        `SELECT a.id FROM applications a JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL WHERE a.drive_id=$1 AND a.tenant_id=$2 AND a.status = ANY($3)`,
        [driveId, actor.tenantId, [...STATUS_ACTIVE_FOR_ROUNDS]])).rows.map((r) => r.id);
    } else appIds = Array.from(new Set(ids));
    let added = 0, alreadyIn = 0;
    const failed: { applicationId: string; reason: string }[] = [];
    for (const id of appIds) {
      const a = (await c.query(
        `SELECT a.id, a.status, u.deleted_at FROM applications a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND a.drive_id=$2 AND a.tenant_id=$3`, [id, driveId, actor.tenantId])).rows[0];
      if (!a) { failed.push({ applicationId: id, reason: 'Application not found in this drive' }); continue; }
      if (a.deleted_at) { failed.push({ applicationId: id, reason: 'Student account is no longer active' }); continue; }
      if (!(STATUS_ACTIVE_FOR_ROUNDS as readonly string[]).includes(a.status)) { failed.push({ applicationId: id, reason: `Application is ${a.status}` }); continue; }
      const ins = await c.query(
        `INSERT INTO round_candidates (tenant_id, drive_id, round_id, application_id) VALUES ($1,$2,$3,$4) ON CONFLICT (round_id, application_id) DO NOTHING RETURNING id`,
        [actor.tenantId, driveId, round.id, id]);
      if (!ins.rowCount) { alreadyIn++; continue; }
      added++;
      await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,NULL,'pending','Added to round',$4,$5)`,
        [actor.tenantId, round.id, id, actor.id, actor.role]);
    }
    if (added) await audit(c, actor.tenantId, actor.id, 'round.add_candidates', { driveId, roundId: round.id, added });
    return { added, alreadyIn, failed };
  });
}

export interface StatusUpdate { applicationId: string; status: RoundStatus; remark?: string | null; score?: number | null }
const NOTIFY_ON: Partial<Record<RoundStatus, (round: string, company: string) => { title: string; body: string }>> = {
  invited: (r, co) => ({ title: `Invited: ${r}`, body: `You have been invited to the ${r} round for ${co}. Check your applications for details.` }),
};

/** Applies one status change in its own transaction. Returns 'updated' | 'unchanged' or throws ApiError. */
export async function applyOneStatus(pool: Pool, actor: Actor, driveId: string, round: any, u: StatusUpdate, note: string | null, drive: any, outbox: Outbox[]): Promise<'updated' | 'unchanged'> {
  return withTx(pool, async (c) => {
    const rc = (await c.query(
      `SELECT rc.*, a.status AS app_status, a.user_id FROM round_candidates rc JOIN applications a ON a.id=rc.application_id
        WHERE rc.round_id=$1 AND rc.application_id=$2 AND rc.tenant_id=$3 FOR UPDATE OF rc`, [round.id, u.applicationId, actor.tenantId])).rows[0];
    if (!rc) throw notFound('Candidate is not in this round', 'NOT_IN_ROUND');
    if (rc.waitlisted) throw unprocessable('WAITLISTED', 'Promote the candidate from the waitlist first');
    if (rc.app_status === 'withdrawn') throw unprocessable('APPLICATION_INACTIVE', 'The application was withdrawn');
    const to = u.status;
    const sameRemark = (u.remark ?? null) === (rc.remark ?? null) || u.remark === undefined;
    const sameScore = u.score === undefined || (u.score !== null && Number(rc.score) === u.score) || (u.score === null && rc.score === null);
    if (rc.status === to && sameRemark && sameScore) return 'unchanged' as const;
    if (!canRoundTransition(rc.status, to)) throw unprocessable('INVALID_ROUND_TRANSITION', `Cannot move a candidate from ${rc.status} to ${to}`);
    if (rc.advanced_at && rc.status === 'passed' && to !== 'passed') throw unprocessable('ALREADY_ADVANCED', 'The candidate has already moved to the next round');
    await c.query(
      `UPDATE round_candidates SET status=$2, remark=COALESCE($3, remark), score=CASE WHEN $4::numeric IS NULL AND $5 THEN NULL WHEN $4::numeric IS NULL THEN score ELSE $4 END, updated_at=now() WHERE id=$1`,
      [rc.id, to, u.remark ?? null, u.score ?? null, u.score === null]);
    if (rc.status !== to) {
      await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [actor.tenantId, round.id, u.applicationId, rc.status, to, u.remark ?? note, actor.id, actor.role]);
    }
    const msg = NOTIFY_ON[to];
    if (msg && rc.status !== to) {
      const ob = new Outbox(c, actor.tenantId);
      const m = msg(round.name, toCompany(drive.company).name);
      await ob.send(rc.user_id, 'pipeline', m.title, m.body, { applicationId: u.applicationId, driveId, roundId: round.id });
      outbox.push(ob);
    }
    return rc.status === to ? ('unchanged' as const) : ('updated' as const);
  });
}

export async function applyStatusUpdates(
  pool: Pool, push: PushSender, actor: Actor, drive: any, round: any, updates: StatusUpdate[], auditAction = 'round.status',
) {
  const outbox: Outbox[] = [];
  let updated = 0, unchanged = 0;
  const failed: { applicationId: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    if (seen.has(u.applicationId)) { failed.push({ applicationId: u.applicationId, reason: 'Duplicate entry' }); continue; }
    seen.add(u.applicationId);
    try {
      const r = await applyOneStatus(pool, actor, drive.id, round, u, null, drive, outbox);
      if (r === 'updated') updated++; else unchanged++;
    } catch (e) {
      if (e instanceof ApiError) failed.push({ applicationId: u.applicationId, reason: e.message }); else throw e;
    }
  }
  if (updated) await audit(pool, actor.tenantId, actor.id, auditAction, { driveId: drive.id, roundId: round.id, updated, statuses: Array.from(new Set(updates.map((u) => u.status))) });
  for (const ob of outbox) await ob.flush(push, pool);
  return { updated, unchanged, failed };
}

// ------------------------------------------------------------------ waitlist
export async function setWaitlist(pool: Pool, actor: Actor, driveId: string, round: any, ids: string[], ranks: Record<string, number> = {}) {
  return withTx(pool, async (c) => {
    let updated = 0;
    let nextRank = ((await c.query('SELECT COALESCE(max(waitlist_rank),0) m FROM round_candidates WHERE round_id=$1', [round.id])).rows[0].m as number) + 1;
    for (const id of Array.from(new Set(ids))) {
      const rc = (await c.query('SELECT id, waitlisted, status FROM round_candidates WHERE round_id=$1 AND application_id=$2 AND tenant_id=$3 FOR UPDATE', [round.id, id, actor.tenantId])).rows[0];
      if (!rc) throw notFound('Candidate is not in this round', 'NOT_IN_ROUND');
      if (rc.waitlisted && ranks[id] === undefined) continue;
      await c.query('UPDATE round_candidates SET waitlisted=true, waitlist_rank=$2, updated_at=now() WHERE id=$1', [rc.id, ranks[id] ?? nextRank++]);
      if (!rc.waitlisted) {
        await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,$4,$4,'Waitlisted',$5,$6)`, [actor.tenantId, round.id, id, rc.status, actor.id, actor.role]);
      }
      updated++;
    }
    await audit(c, actor.tenantId, actor.id, 'round.waitlist', { driveId, roundId: round.id, updated });
    return { updated };
  });
}

export async function promoteWaitlist(pool: Pool, push: PushSender, actor: Actor, drive: any, round: any, ids: string[]) {
  const ob = { list: [] as Outbox[] };
  const out = await withTx(pool, async (c) => {
    let promoted = 0;
    const o = new Outbox(c, actor.tenantId);
    ob.list.push(o);
    for (const id of Array.from(new Set(ids))) {
      const rc = (await c.query(
        `SELECT rc.id, rc.waitlisted, rc.status, a.user_id FROM round_candidates rc JOIN applications a ON a.id=rc.application_id WHERE rc.round_id=$1 AND rc.application_id=$2 AND rc.tenant_id=$3 FOR UPDATE OF rc`,
        [round.id, id, actor.tenantId])).rows[0];
      if (!rc) throw notFound('Candidate is not in this round', 'NOT_IN_ROUND');
      if (!rc.waitlisted) continue;
      await c.query(`UPDATE round_candidates SET waitlisted=false, waitlist_rank=NULL, status='invited', updated_at=now() WHERE id=$1`, [rc.id]);
      await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,$4,'invited','Promoted from waitlist',$5,$6)`, [actor.tenantId, round.id, id, rc.status, actor.id, actor.role]);
      await o.send(rc.user_id, 'pipeline', `Invited: ${round.name}`, `A place opened up: you are invited to the ${round.name} round for ${toCompany(drive.company).name}.`, { applicationId: id, driveId: drive.id, roundId: round.id });
      promoted++;
    }
    await audit(c, actor.tenantId, actor.id, 'round.promote', { driveId: drive.id, roundId: round.id, promoted });
    return { promoted };
  });
  for (const o of ob.list) await o.flush(push, pool);
  return out;
}

// ------------------------------------------------------------------ advance
export interface AdvanceInput { applicationIds?: string[]; toRoundId?: string; capacity?: number }

/**
 * `blindViewerId` is set when the caller is a recruiter in a drive with blind scorecards. Scores of candidates in this round for which
 * that recruiter has not submitted their own scorecard are then hidden: no avgScore, and no score-based ordering/cut (400 instead).
 */
async function planAdvance(db: Db, tenantId: string, driveId: string, from: any, input: AdvanceInput, lock: boolean, blindViewerId: string | null = null) {
  const target = input.toRoundId
    ? await loadRound(db, tenantId, driveId, input.toRoundId)
    : (await db.query('SELECT * FROM drive_rounds WHERE drive_id=$1 AND seq > $2 ORDER BY seq LIMIT 1', [driveId, from.seq])).rows[0];
  if (!target) throw unprocessable('NO_NEXT_ROUND', 'This is the last round; there is nothing to move candidates to');
  if (target.seq <= from.seq) throw unprocessable('INVALID_TARGET_ROUND', 'The target round must come after this round');
  const rows = (await db.query(
    `SELECT rc.application_id, rc.status, rc.waitlisted, a.status AS app_status, a.submitted_at, a.user_id, u.name,
            (SELECT avg(overall) FROM scorecards s WHERE s.application_id=rc.application_id AND s.round_id=rc.round_id) AS avg_score,
            EXISTS (SELECT 1 FROM round_candidates t WHERE t.round_id=$3 AND t.application_id=rc.application_id) AS in_target,
            (u.deleted_at IS NOT NULL) AS deleted
       FROM round_candidates rc JOIN applications a ON a.id=rc.application_id JOIN users u ON u.id=a.user_id
      WHERE rc.round_id=$1 AND rc.tenant_id=$2 ${input.applicationIds ? 'AND rc.application_id = ANY($4)' : "AND rc.status='passed'"} ${lock ? 'FOR UPDATE OF rc' : ''}`,
    input.applicationIds ? [from.id, tenantId, target.id, input.applicationIds] : [from.id, tenantId, target.id])).rows;
  const skipped: { applicationId: string; reason: string }[] = [];
  const eligible: any[] = [];
  for (const r of rows) {
    if (r.in_target) skipped.push({ applicationId: r.application_id, reason: 'already_in_target' });
    else if (r.waitlisted) skipped.push({ applicationId: r.application_id, reason: 'waitlisted' });
    else if (r.status !== 'passed') skipped.push({ applicationId: r.application_id, reason: 'not_passed' });
    else if (r.deleted || !(STATUS_ACTIVE_FOR_ROUNDS as readonly string[]).includes(r.app_status)) skipped.push({ applicationId: r.application_id, reason: 'application_inactive' });
    else eligible.push(r);
  }
  for (const id of input.applicationIds ?? []) if (!rows.some((r) => r.application_id === id)) skipped.push({ applicationId: id, reason: 'not_in_round' });
  let scoresHidden = false;
  if (blindViewerId) {
    const hidden = await hiddenScoreApps(db, from.id, blindViewerId, eligible.map((r) => r.application_id));
    scoresHidden = hidden.size > 0;
  }
  if (scoresHidden) {
    // Ranking by score would reveal hidden aggregates (via order or via who makes the cut).
    if (input.capacity !== undefined && input.capacity < eligible.length) {
      throw badRequest('Ranking candidates by score is not available while blind scorecards are enabled; submit your own scorecards for every candidate in this round first, or ask an officer to advance with a capacity', { capacity: 'Score-based capacity cut is disabled in blind scorecard mode' });
    }
    eligible.sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
  } else {
    eligible.sort((a, b) => (Number(b.avg_score ?? -1) - Number(a.avg_score ?? -1)) || (new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()));
  }
  const cap = input.capacity ?? eligible.length;
  const toInvite = eligible.slice(0, cap);
  const toWaitlist = eligible.slice(cap);
  return { target, toInvite, toWaitlist, skipped };
}
/** Applications in `roundId` that have scorecards, none of which are the viewer's own (so the round aggregate must stay hidden from them). */
async function hiddenScoreApps(db: Db, roundId: string, viewerId: string, applicationIds: string[]): Promise<Set<string>> {
  if (!applicationIds.length) return new Set();
  const rows = (await db.query(
    `SELECT application_id, bool_or(recruiter_id=$2) AS own FROM scorecards WHERE round_id=$1 AND application_id = ANY($3) GROUP BY application_id`,
    [roundId, viewerId, applicationIds])).rows;
  return new Set(rows.filter((r) => !r.own).map((r) => r.application_id as string));
}

/** Strips hidden aggregates from an (possibly stored/replayed) advance result for a blind recruiter. */
async function blindAdvanceResult(db: Db, roundId: string, viewerId: string, result: any) {
  const lists = ['moved', 'waitlisted'] as const;
  const ids = lists.flatMap((k) => (result[k] ?? []).map((x: any) => x.applicationId as string));
  const hidden = await hiddenScoreApps(db, roundId, viewerId, ids);
  if (!hidden.size) return result;
  const out = { ...result };
  for (const k of lists) {
    out[k] = (result[k] ?? []).map((x: any) => (hidden.has(x.applicationId) ? { ...x, avgScore: null } : x))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)) || String(a.applicationId).localeCompare(String(b.applicationId)));
  }
  return out;
}
const candDto = (r: any) => ({ applicationId: r.application_id, name: r.name, avgScore: r.avg_score === null || r.avg_score === undefined ? null : Number(Number(r.avg_score).toFixed(2)) });

export async function previewAdvance(db: Db, tenantId: string, driveId: string, from: any, input: AdvanceInput, blindViewerId: string | null = null) {
  const p = await planAdvance(db, tenantId, driveId, from, input, false, blindViewerId);
  const hidden = blindViewerId ? await hiddenScoreApps(db, from.id, blindViewerId, [...p.toInvite, ...p.toWaitlist].map((r) => r.application_id)) : new Set<string>();
  const dto = (r: any) => (hidden.has(r.application_id) ? { ...candDto(r), avgScore: null } : candDto(r));
  return {
    fromRound: roundDto(from), toRound: roundDto(p.target), toInvite: p.toInvite.map(dto), toWaitlist: p.toWaitlist.map(dto), skipped: p.skipped,
    counts: { toInvite: p.toInvite.length, toWaitlist: p.toWaitlist.length, skipped: p.skipped.length },
  };
}

export async function advance(pool: Pool, push: PushSender, actor: Actor, drive: any, from: any, input: AdvanceInput, idempotencyKey: string, blindViewerId: string | null = null) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`advance:${from.id}`]);
    const scope = `advance:${from.id}`;
    const prior = (await c.query('SELECT result FROM pipeline_operations WHERE tenant_id=$1 AND scope=$2 AND key=$3', [actor.tenantId, scope, idempotencyKey])).rows[0];
    if (prior) return { ...prior.result, replayed: true };
    const p = await planAdvance(c, actor.tenantId, drive.id, from, input, true, blindViewerId);
    const o = new Outbox(c, actor.tenantId);
    ob.push(o);
    const company = toCompany(drive.company).name;
    let rank = ((await c.query('SELECT COALESCE(max(waitlist_rank),0) m FROM round_candidates WHERE round_id=$1', [p.target.id])).rows[0].m as number);
    const note = `Advanced from ${from.name}`;
    for (const r of p.toInvite) {
      await c.query(`INSERT INTO round_candidates (tenant_id, drive_id, round_id, application_id, status) VALUES ($1,$2,$3,$4,'invited')`, [actor.tenantId, drive.id, p.target.id, r.application_id]);
      await c.query(`UPDATE round_candidates SET advanced_at=now() WHERE round_id=$1 AND application_id=$2`, [from.id, r.application_id]);
      await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,NULL,'invited',$4,$5,$6)`, [actor.tenantId, p.target.id, r.application_id, note, actor.id, actor.role]);
      await o.send(r.user_id, 'pipeline', `You moved to the next round: ${p.target.name}`, `Congratulations! You have been shortlisted for the ${p.target.name} round of ${company}.`, { applicationId: r.application_id, driveId: drive.id, roundId: p.target.id });
    }
    for (const r of p.toWaitlist) {
      rank += 1;
      await c.query(`INSERT INTO round_candidates (tenant_id, drive_id, round_id, application_id, status, waitlisted, waitlist_rank) VALUES ($1,$2,$3,$4,'pending',true,$5)`, [actor.tenantId, drive.id, p.target.id, r.application_id, rank]);
      await c.query(`UPDATE round_candidates SET advanced_at=now() WHERE round_id=$1 AND application_id=$2`, [from.id, r.application_id]);
      await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,NULL,'pending',$4,$5,$6)`, [actor.tenantId, p.target.id, r.application_id, note + ' (waitlisted)', actor.id, actor.role]);
      await o.send(r.user_id, 'pipeline', `Waitlisted: ${p.target.name}`, `You are on the waitlist for the ${p.target.name} round of ${company}. We will notify you if a place opens up.`, { applicationId: r.application_id, driveId: drive.id, roundId: p.target.id });
    }
    const result = { moved: p.toInvite.map(candDto), waitlisted: p.toWaitlist.map(candDto), skipped: p.skipped, toRound: roundDto(p.target) };
    await c.query('INSERT INTO pipeline_operations (tenant_id, scope, key, result) VALUES ($1,$2,$3,$4)', [actor.tenantId, scope, idempotencyKey, JSON.stringify(result)]);
    await audit(c, actor.tenantId, actor.id, 'round.advance', { driveId: drive.id, fromRoundId: from.id, toRoundId: p.target.id, moved: p.toInvite.length, waitlisted: p.toWaitlist.length, idempotencyKey });
    return { ...result, replayed: false };
  });
  for (const o of ob) await o.flush(push, pool);
  return blindViewerId ? blindAdvanceResult(pool, from.id, blindViewerId, out) : out;
}

// ------------------------------------------------------------------ attendance QR
export const QR_PREFIX = 'POSATT1.';
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function createAttendanceToken(pool: Pool, actor: Actor, driveId: string, round: any, session: string, validFrom: Date, validMinutes: number) {
  return withTx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`att:${round.id}:${session}`]);
    await c.query(`UPDATE attendance_tokens SET revoked_at=now() WHERE round_id=$1 AND session=$2 AND revoked_at IS NULL`, [round.id, session]);
    const token = crypto.randomBytes(24).toString('base64url');
    const validUntil = new Date(validFrom.getTime() + validMinutes * 60000);
    await c.query(`INSERT INTO attendance_tokens (tenant_id, round_id, session, token_hash, valid_from, valid_until, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actor.tenantId, round.id, session, hashToken(token), validFrom, validUntil, actor.id]);
    await audit(c, actor.tenantId, actor.id, 'round.attendance_token', { driveId, roundId: round.id, session, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString() });
    return { token, qrPayload: QR_PREFIX + token, session, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString() };
  });
}

export async function revokeAttendanceToken(pool: Pool, actor: Actor, driveId: string, round: any, session: string) {
  const r = await pool.query(`UPDATE attendance_tokens SET revoked_at=now() WHERE round_id=$1 AND session=$2 AND revoked_at IS NULL`, [round.id, session]);
  await audit(pool, actor.tenantId, actor.id, 'round.attendance_token_revoke', { driveId, roundId: round.id, session });
  return { ok: true, revoked: r.rowCount ?? 0 };
}

export async function scanAttendance(pool: Pool, student: Actor, rawToken: string) {
  const token = rawToken.startsWith(QR_PREFIX) ? rawToken.slice(QR_PREFIX.length) : rawToken;
  if (token.length < 16 || token.length > 200) throw notFound('This QR code is not valid', 'TOKEN_INVALID');
  return withTx(pool, async (c) => {
    const t = (await c.query(
      `SELECT t.*, clock_timestamp() AS now, r.name AS round_name, r.drive_id, r.kind FROM attendance_tokens t JOIN drive_rounds r ON r.id=t.round_id
        WHERE t.token_hash=$1 AND t.tenant_id=$2`, [hashToken(token), student.tenantId])).rows[0];
    if (!t || t.revoked_at) throw notFound('This QR code is not valid', 'TOKEN_INVALID');
    const now = new Date(t.now);
    if (now < new Date(t.valid_from)) throw unprocessable('TOKEN_NOT_STARTED', 'Attendance has not opened yet');
    if (now > new Date(t.valid_until)) throw unprocessable('TOKEN_EXPIRED', 'This attendance code has expired');
    const rc = (await c.query(
      `SELECT rc.*, a.status AS app_status FROM round_candidates rc JOIN applications a ON a.id=rc.application_id
        WHERE rc.round_id=$1 AND a.user_id=$2 AND a.status <> 'withdrawn' AND rc.tenant_id=$3 FOR UPDATE OF rc`, [t.round_id, student.id, student.tenantId])).rows[0];
    if (!rc || rc.waitlisted) throw new ApiError(403, 'NOT_SHORTLISTED', 'You are not shortlisted for this round');
    if (rc.status === 'attended') return { attended: true, replayed: true, round: { id: t.round_id, name: t.round_name }, driveId: t.drive_id, markedAt: new Date(rc.updated_at).toISOString() };
    if (!['pending', 'invited', 'absent', 'on_hold'].includes(rc.status)) throw unprocessable('ALREADY_DECIDED', 'Your result for this round is already recorded');
    await c.query(`UPDATE round_candidates SET status='attended', updated_at=$2 WHERE id=$1`, [rc.id, now]);
    await c.query(`INSERT INTO round_events (tenant_id, round_id, application_id, from_status, to_status, note, actor_id, actor_role) VALUES ($1,$2,$3,$4,'attended',$5,$6,'student')`,
      [student.tenantId, t.round_id, rc.application_id, rc.status, `QR attendance (${t.session})`, student.id]);
    await audit(c, student.tenantId, student.id, 'attendance.scan', { roundId: t.round_id, applicationId: rc.application_id, session: t.session });
    return { attended: true, replayed: false, round: { id: t.round_id, name: t.round_name }, driveId: t.drive_id, markedAt: now.toISOString() };
  });
}

// ------------------------------------------------------------------ funnel
export async function funnel(db: Db, driveId: string, canSeeSubmitted: boolean) {
  const apps = (await db.query(
    `SELECT status, count(*)::int n FROM applications WHERE drive_id=$1 AND status <> 'withdrawn' ${canSeeSubmitted ? '' : "AND status <> 'submitted'"} GROUP BY status`, [driveId])).rows;
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of apps) { byStatus[r.status] = r.n; total += r.n; }
  const rounds = (await db.query('SELECT * FROM drive_rounds WHERE drive_id=$1 ORDER BY seq', [driveId])).rows;
  const counts = await roundCounts(db, driveId);
  const decisions = { shortlisted: 0, rejected: 0, on_hold: 0 } as Record<string, number>;
  for (const r of (await db.query(
    `SELECT cd.decision, count(*)::int n FROM candidate_decisions cd JOIN applications a ON a.id=cd.application_id AND a.status <> 'withdrawn' WHERE cd.drive_id=$1 GROUP BY 1`, [driveId])).rows) decisions[r.decision] = r.n;
  const offers: Record<string, number> = { pending_approval: 0, issued: 0, accepted: 0, declined: 0, expired: 0, revoked: 0, rejected: 0, joined: 0 };
  for (const r of (await db.query('SELECT status, count(*)::int n FROM offers WHERE drive_id=$1 GROUP BY 1', [driveId])).rows) offers[r.status] = r.n;
  return {
    applications: { total, byStatus },
    rounds: rounds.map((r) => ({ roundId: r.id, name: r.name, seq: r.seq, kind: r.kind, ...(counts.get(r.id) ?? emptyCounts()) })),
    decisions, offers,
  };
}
void COUNT_KEYS;
