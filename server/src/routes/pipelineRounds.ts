import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { ApiError, badRequest, forbidden, notFound, parse, wrap } from '../errors';
import {
  DriveAccess, getSettings, loadDriveAccess, officerOnly, PermissionKey, settingsSchema,
} from '../pipeline/access';
import {
  effectiveRubric, publishResults, putRubric, studentRounds, uploadResults,
} from '../pipeline/candidates';
import {
  addCandidates, advance, applyStatusUpdates, createAttendanceToken, createRound, deleteRound, funnel, listRounds, loadRound, MAX_ROUNDS,
  previewAdvance, promoteWaitlist, reorderRounds, revokeAttendanceToken, ROUND_KINDS, ROUND_STATUSES, RoundStatus, permissionForRoundStatus,
  roundDto, scanAttendance, setWaitlist, updateRound, Actor, RoundInput,
} from '../pipeline/rounds';
import { audit, isUuid, optionalText, plainBody, requiredText, uuidSchema } from '../pipeline/shared';
import { cleanString, validateHttpsUrl, validateScheduledAt, validateVenueOrLink } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const actorOf = (u: ReturnType<typeof me>): Actor => ({ id: u.id, tenantId: u.tenantId, role: u.role, name: u.name });

function parseRoundInput(body: Record<string, any>, partial: boolean): RoundInput {
  const fields: Record<string, string> = {};
  const out: RoundInput = {};
  if (body.name !== undefined || !partial) {
    const n = cleanString(body.name, 80);
    if (!n.ok) fields.name = n.message; else if (n.value.length < 2) fields.name = 'Name must be at least 2 characters'; else out.name = n.value;
  }
  if (body.kind !== undefined || !partial) {
    if (!(ROUND_KINDS as readonly string[]).includes(body.kind)) fields.kind = `Kind must be one of ${ROUND_KINDS.join(', ')}`; else out.kind = body.kind;
  }
  if (body.assessmentId !== undefined) {
    if (body.assessmentId === null) out.assessmentId = null;
    else if (!isUuid(body.assessmentId)) fields.assessmentId = 'assessmentId must be a UUID'; else out.assessmentId = body.assessmentId;
  }
  if (body.description !== undefined) {
    try { out.description = optionalText(body.description, 500, 'Description', 'description'); } catch (e) { fields.description = (e as ApiError).message; }
  }
  if (body.mode !== undefined) {
    if (body.mode === null) out.mode = null;
    else if (body.mode !== 'online' && body.mode !== 'in_person') fields.mode = 'Mode must be online or in_person'; else out.mode = body.mode;
  }
  if (body.venueOrLink !== undefined) {
    if (body.venueOrLink === null || body.venueOrLink === '') out.venueOrLink = null;
    else if (body.mode === 'online' || body.mode === 'in_person') {
      const v = validateVenueOrLink(body.mode, body.venueOrLink);
      if (!v.ok) fields.venueOrLink = v.message; else out.venueOrLink = v.value;
    } else {
      const v = cleanString(body.venueOrLink, 300);
      if (!v.ok) fields.venueOrLink = v.message; else out.venueOrLink = v.value;
    }
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) out.scheduledAt = null;
    else { const s = validateScheduledAt(body.scheduledAt); if (!s.ok) fields.scheduledAt = s.message; else out.scheduledAt = s.value; }
  }
  if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
  return out;
}

const idList = (max: number) => z.array(uuidSchema, { message: 'Must be a list of ids' }).min(1, 'Choose at least one').max(max, `At most ${max} at a time`);
const roundStatusSchema = z.enum([...ROUND_STATUSES], { message: `Status must be one of ${ROUND_STATUSES.join(', ')}` });

export function registerPipelineRounds(deps: Deps, r: Router) {
  const { pool, push } = deps;
  const auth = authenticate(deps);
  const staff = [auth, requireRole(['officer', 'recruiter'])];
  const student = [auth, requireRole('student')];
  const base = '/pipeline/drives/:id';

  const access = (req: any, perm?: PermissionKey) => loadDriveAccess(pool, me(req), pid(req), perm);
  const roundOf = async (a: DriveAccess, req: any) => {
    if (!isUuid(req.params.roundId)) throw notFound('Round not found', 'ROUND_NOT_FOUND');
    return loadRound(pool, a.tenantId, a.drive.id, req.params.roundId);
  };

  // ------------------------------------------------------------------ settings
  r.get(`${base}/settings`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    res.json({ settings: await getSettings(pool, a.drive.id) });
  }));
  r.put(`${base}/settings`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const patch = parse<Record<string, unknown>>(settingsSchema, plainBody(req.body));
    const next = { ...(await getSettings(pool, a.drive.id)), ...patch };
    await pool.query(
      `INSERT INTO drive_pipeline_settings (drive_id, tenant_id, settings, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (drive_id) DO UPDATE SET settings=EXCLUDED.settings, updated_by=EXCLUDED.updated_by, updated_at=now()`, [a.drive.id, a.tenantId, JSON.stringify(next), a.userId]);
    await audit(pool, a.tenantId, a.userId, 'pipeline.settings', { driveId: a.drive.id, settings: next });
    res.json({ settings: next });
  }));

  // ------------------------------------------------------------------ rounds
  r.get(`${base}/rounds`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    res.json({ items: await listRounds(pool, a.drive.id) });
  }));
  r.post(`${base}/rounds`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    if (a.drive.status === 'closed' && false) throw new ApiError(409, 'DRIVE_CLOSED', 'Drive is closed');
    const input = parseRoundInput(plainBody(req.body, ['name', 'kind', 'assessmentId', 'description', 'mode', 'venueOrLink', 'scheduledAt']), false);
    res.status(201).json({ round: await createRound(pool, a.tenantId, a.userId, a.drive.id, input as any) });
  }));
  r.post(`${base}/rounds/reorder`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const { roundIds } = parse<{ roundIds: string[] }>(z.object({ roundIds: z.array(uuidSchema).min(1).max(MAX_ROUNDS) }).strict(), req.body);
    res.json({ items: await reorderRounds(pool, a.tenantId, a.userId, a.drive.id, roundIds) });
  }));
  r.patch(`${base}/rounds/:roundId`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    const input = parseRoundInput(plainBody(req.body, ['name', 'kind', 'assessmentId', 'description', 'mode', 'venueOrLink', 'scheduledAt']), true);
    res.json({ round: await updateRound(pool, a.tenantId, a.userId, a.drive.id, round.id, input) });
  }));
  r.delete(`${base}/rounds/:roundId`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    await deleteRound(pool, a.tenantId, a.userId, a.drive.id, round.id);
    res.json({ ok: true });
  }));
  r.post(`${base}/rounds/:roundId/publish-results`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    res.json(await publishResults(pool, push, { id: a.userId, tenantId: a.tenantId }, a.drive, round));
  }));

  // ------------------------------------------------------------------ rubric
  r.get(`${base}/rubric`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    const roundId = typeof req.query.roundId === 'string' ? req.query.roundId : null;
    if (roundId && !isUuid(roundId)) throw new ApiError(400, 'VALIDATION_ERROR', 'roundId must be a UUID', { roundId: 'Must be a UUID' });
    res.json({ rubric: await effectiveRubric(pool, a.drive.id, roundId), effective: true });
  }));
  r.put(`${base}/rubric`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const body = parse<{ roundId?: string; items: { id?: string; label: string; description?: string | null }[] }>(
      z.object({
        roundId: uuidSchema.optional(),
        items: z.array(z.object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Item id may use letters, numbers, _ and -').optional(),
          label: z.string().trim().min(2, 'Label must be at least 2 characters').max(80, 'Label must be at most 80 characters'),
          description: z.string().trim().max(300).nullable().optional(),
        }).strict()).min(1, 'Add at least one item').max(12, 'At most 12 items'),
      }).strict(), req.body);
    if (body.roundId) await loadRound(pool, a.tenantId, a.drive.id, body.roundId);
    res.json({ rubric: await putRubric(pool, a.tenantId, a.userId, a.drive.id, body.roundId ?? null, body.items) });
  }));

  // ------------------------------------------------------------------ round candidates
  r.get(`${base}/rounds/:roundId/candidates`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const round = await roundOf(a, req);
    const q = z.object({
      status: roundStatusSchema.optional(), waitlisted: z.enum(['0', '1']).optional(), q: z.string().max(100).optional(),
      cursor: z.string().max(100).optional(), limit: z.string().optional(),
    }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const settings = await getSettings(pool, a.drive.id);
    const hideUnscreened = a.role === 'recruiter' && !settings.showUnscreened;
    const blind = a.role === 'recruiter' && settings.blindScorecards;
    if (blind && /score/i.test(String(req.query.sort ?? ''))) throw badRequest('Sorting by score is not available while blind scorecards are enabled', { sort: 'Score sorting is disabled in blind scorecard mode' });
    const params: unknown[] = [round.id, a.tenantId];
    let where = `rc.round_id=$1 AND rc.tenant_id=$2 AND ap.status <> 'withdrawn' ${hideUnscreened ? "AND ap.status <> 'submitted'" : ''}`;
    if (q.status) { params.push(q.status); where += ` AND rc.status=$${params.length}`; }
    if (q.waitlisted) { params.push(q.waitlisted === '1'); where += ` AND rc.waitlisted=$${params.length}`; }
    if (q.q) { params.push(`%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`); where += ` AND (sf.data->>'name' ILIKE $${params.length} OR sf.data->>'registrationNumber' ILIKE $${params.length})`; }
    // Blind mode: the round aggregate is shown only once this recruiter has submitted their own scorecard for the candidate in this round.
    const avgSql = blind
      ? `(SELECT avg(overall) FROM scorecards s WHERE s.application_id=rc.application_id AND s.round_id=rc.round_id
            AND EXISTS (SELECT 1 FROM scorecards m WHERE m.application_id=rc.application_id AND m.round_id=rc.round_id AND m.recruiter_id=$${params.length + 1}))`
      : '(SELECT avg(overall) FROM scorecards s WHERE s.application_id=rc.application_id AND s.round_id=rc.round_id)';
    const rows = (await pool.query(
      `SELECT rc.*, ap.reference, ap.status AS app_status, sf.data,
              ${avgSql} AS avg_score
         FROM round_candidates rc JOIN applications ap ON ap.id=rc.application_id LEFT JOIN application_shared_fields sf ON sf.application_id=ap.id
        WHERE ${where} ORDER BY rc.waitlisted, rc.waitlist_rank NULLS FIRST, rc.created_at, rc.id LIMIT ${limit + 1} OFFSET ${offset}`, blind ? [...params, a.userId] : params)).rows;
    const counts = (await listRounds(pool, a.drive.id)).find((x) => x.id === round.id)?.counts;
    res.json({
      items: rows.slice(0, limit).map((x) => ({
        applicationId: x.application_id, reference: x.reference, name: x.data?.name ?? null, department: x.data?.department ?? null, cgpa: x.data?.cgpa ?? null,
        applicationStatus: x.app_status, status: x.status, waitlisted: x.waitlisted, waitlistRank: x.waitlist_rank, remark: x.remark ?? null,
        score: x.score === null ? null : Number(x.score), avgScore: x.avg_score === null ? null : Number(Number(x.avg_score).toFixed(2)), updatedAt: new Date(x.updated_at).toISOString(),
      })),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null, counts,
    });
  }));

  r.post(`${base}/rounds/:roundId/candidates`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    const body = plainBody(req.body, ['applicationIds', 'allScreened']);
    let input: string[] | 'allScreened';
    if (body.allScreened === true) input = 'allScreened';
    else input = parse<{ applicationIds: string[] }>(z.object({ applicationIds: idList(200) }), body).applicationIds;
    res.json(await addCandidates(pool, actorOf(me(req)), a.drive.id, round, input));
  }));

  const updatesSchema = z.object({
    updates: z.array(z.object({
      applicationId: uuidSchema, status: roundStatusSchema,
      remark: z.string().trim().max(300).nullable().optional(),
    }).strict()).min(1, 'Send at least one update').max(200, 'At most 200 updates at a time'),
  }).strict();

  r.post(`${base}/rounds/:roundId/status`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    const round = await roundOf(a, req);
    const body = parse<{ updates: { applicationId: string; status: RoundStatus; remark?: string | null }[] }>(updatesSchema, req.body);
    if (a.role === 'recruiter') {
      for (const u of body.updates) {
        const need = permissionForRoundStatus(u.status);
        if (need === 'officer') throw new ApiError(403, 'PERMISSION_DENIED', 'Only a placement officer can invite or reset candidates', { permission: 'officer' });
        if (!a.permissions![need]) throw new ApiError(403, 'PERMISSION_DENIED', 'Your access to this drive does not include this action', { permission: need });
      }
    }
    res.json(await applyStatusUpdates(pool, push, actorOf(me(req)), a.drive, round, body.updates));
  }));

  r.post(`${base}/rounds/:roundId/attendance`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'markAttendance');
    const round = await roundOf(a, req);
    const body = parse<{ marks: { applicationId: string; present: boolean }[] }>(
      z.object({ marks: z.array(z.object({ applicationId: uuidSchema, present: z.boolean({ message: 'present must be true or false' }) }).strict()).min(1).max(200) }).strict(), req.body);
    res.json(await applyStatusUpdates(pool, push, actorOf(me(req)), a.drive, round,
      body.marks.map((m) => ({ applicationId: m.applicationId, status: (m.present ? 'attended' : 'absent') as RoundStatus })), 'round.attendance'));
  }));

  r.post(`${base}/rounds/:roundId/waitlist`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    const body = parse<{ applicationIds: string[]; ranks?: Record<string, number> }>(
      z.object({ applicationIds: idList(200), ranks: z.record(uuidSchema, z.number().int().min(1).max(10000)).optional() }).strict(), req.body);
    res.json(await setWaitlist(pool, actorOf(me(req)), a.drive.id, round, body.applicationIds, body.ranks));
  }));
  r.post(`${base}/rounds/:roundId/promote`, ...staff, wrap(async (req, res) => {
    const a = await access(req);
    officerOnly(a);
    const round = await roundOf(a, req);
    const body = parse<{ applicationIds: string[] }>(z.object({ applicationIds: idList(200) }).strict(), req.body);
    res.json(await promoteWaitlist(pool, push, actorOf(me(req)), a.drive, round, body.applicationIds));
  }));

  // ------------------------------------------------------------------ advance
  /** Recruiter id when blind scorecards hide other recruiters' scores from them, else null (officers always see everything). */
  const blindViewerId = async (a: any): Promise<string | null> =>
    a.role === 'recruiter' && (await getSettings(pool, a.drive.id)).blindScorecards ? (a.userId as string) : null;
  const advanceFields = { applicationIds: idList(500).optional(), toRoundId: uuidSchema.optional(), capacity: z.number().int().min(1).max(5000).optional() };
  r.post(`${base}/rounds/:roundId/advance/preview`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'uploadResults');
    const round = await roundOf(a, req);
    const body = parse<any>(z.object(advanceFields).strict(), req.body);
    res.json(await previewAdvance(pool, a.tenantId, a.drive.id, round, body, await blindViewerId(a)));
  }));
  r.post(`${base}/rounds/:roundId/advance`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'uploadResults');
    const round = await roundOf(a, req);
    const body = parse<any>(z.object({
      ...advanceFields, confirm: z.literal(true, { message: 'Send confirm:true to move candidates' }), idempotencyKey: z.string().uuid('idempotencyKey must be a UUID'),
    }).strict(), req.body);
    const { confirm, idempotencyKey, ...input } = body;
    void confirm;
    res.json(await advance(pool, push, actorOf(me(req)), a.drive, round, input, idempotencyKey, await blindViewerId(a)));
  }));

  // ------------------------------------------------------------------ attendance QR
  r.post(`${base}/rounds/:roundId/attendance-token`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'markAttendance');
    const round = await roundOf(a, req);
    const body = parse<{ session: string; validFrom?: string; validMinutes: number }>(
      z.object({
        session: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} _.-]+$/u, 'Session may use letters, numbers, spaces, _ . -').default('default'),
        validFrom: z.string().datetime({ offset: true, message: 'validFrom must be an ISO-8601 timestamp' }).optional(),
        validMinutes: z.number().int().min(5, 'validMinutes must be 5-720').max(720, 'validMinutes must be 5-720').default(60),
      }).strict(), req.body ?? {});
    const from = body.validFrom ? new Date(body.validFrom) : new Date();
    res.status(201).json(await createAttendanceToken(pool, actorOf(me(req)), a.drive.id, round, body.session, from, body.validMinutes));
  }));
  r.delete(`${base}/rounds/:roundId/attendance-token/:session`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'markAttendance');
    const round = await roundOf(a, req);
    res.json(await revokeAttendanceToken(pool, actorOf(me(req)), a.drive.id, round, String(req.params.session).slice(0, 40)));
  }));
  r.post('/pipeline/attendance/scan', ...student, wrap(async (req, res) => {
    const body = parse<{ token: string }>(z.object({ token: z.string().min(8, 'Scan the QR code again').max(200) }).strict(), req.body);
    res.json(await scanAttendance(pool, actorOf(me(req)), body.token));
  }));

  // ------------------------------------------------------------------ results upload
  r.post(`${base}/rounds/:roundId/results`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'uploadResults');
    const round = await roundOf(a, req);
    const body = parse<{ rows: any[] }>(z.object({
      rows: z.array(z.object({
        applicationId: uuidSchema.optional(), reference: z.string().trim().min(3).max(40).optional(),
        result: z.enum(['passed', 'failed', 'absent', 'on_hold'], { message: 'result must be passed, failed, absent or on_hold' }),
        score: z.number().min(0, 'score must be 0-100').max(100, 'score must be 0-100').optional(),
        remark: z.string().trim().max(300).nullable().optional(),
      }).strict().refine((x) => x.applicationId || x.reference, { message: 'applicationId or reference is required', path: ['applicationId'] })).min(1).max(500),
    }).strict(), req.body);
    res.json(await uploadResults(pool, push, a, round, body.rows));
  }));

  // ------------------------------------------------------------------ funnel + student round view
  r.get(`${base}/funnel`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const st = await getSettings(pool, a.drive.id);
    res.json(await funnel(pool, a.drive.id, a.role === 'officer' || st.showUnscreened));
  }));
  r.get('/pipeline/applications/:id/rounds', ...student, wrap(async (req, res) => {
    const u = me(req);
    const ap = (await pool.query('SELECT id FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [pid(req), u.tenantId, u.id])).rows[0];
    if (!ap) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    res.json({ items: await studentRounds(pool, ap.id) });
  }));
  void forbidden; void roundDto; void requiredText; void validateHttpsUrl;
}
