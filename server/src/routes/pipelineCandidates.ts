import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { ApiError, notFound, parse, wrap } from '../errors';
import { loadDriveAccess, loadVisibleApplication, officerOnly, PermissionKey } from '../pipeline/access';
import {
  addNote, candidateDetail, candidateResume, CANDIDATE_SORTS, decideOutcome, deleteNote, listCandidates, listMessages, listNotes, listOutcomes,
  postMessage, proposeOutcome, RECOMMENDATIONS, listScorecards, setDecision, submitScorecard,
} from '../pipeline/candidates';
import { ROUND_STATUSES } from '../pipeline/rounds';
import { isUuid, plainBody, requiredText, uuidSchema } from '../pipeline/shared';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

export function registerPipelineCandidates(deps: Deps, r: Router) {
  const { pool, push } = deps;
  const auth = authenticate(deps);
  const staff = [auth, requireRole(['officer', 'recruiter'])];
  const officer = [auth, requireRole('officer')];
  const base = '/pipeline/drives/:id';
  const access = (req: any, perm?: PermissionKey) => loadDriveAccess(pool, me(req), pid(req), perm);
  const appId = (req: any) => {
    if (!isUuid(req.params.applicationId)) throw notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
    return String(req.params.applicationId);
  };

  // ------------------------------------------------------------------ list / profile
  r.get(`${base}/candidates`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const q = z.object({
      q: z.string().trim().max(100).optional(), status: z.string().max(30).optional(), decision: z.enum(['shortlisted', 'rejected', 'on_hold']).optional(),
      roundId: uuidSchema.optional(), roundStatus: z.enum([...ROUND_STATUSES]).optional(), department: z.string().trim().max(80).optional(),
      minCgpa: z.coerce.number().min(0).max(10).optional(), sort: z.enum([...CANDIDATE_SORTS]).default('newest'),
      cursor: z.string().max(100).optional(), limit: z.string().optional(),
    }).strict().parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const out = await listCandidates(pool, a, { ...q, limit, offset });
    res.json({ items: out.items, nextCursor: out.hasMore ? encodeCursor(offset + limit) : null, total: out.total });
  }));

  r.get(`${base}/candidates/:applicationId`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    res.json({ candidate: await candidateDetail(pool, a, appId(req)) });
  }));
  r.get(`${base}/candidates/:applicationId/resume`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    res.json(await candidateResume(pool, a, appId(req)));
  }));

  // ------------------------------------------------------------------ decisions
  const decisionSchema = z.object({
    decision: z.enum(['shortlisted', 'rejected', 'on_hold', 'clear'], { message: 'decision must be shortlisted, rejected, on_hold or clear' }),
    reason: z.string().trim().max(500).nullable().optional(),
  }).strict();
  const reasonFor = (d: { decision: string; reason?: string | null }) => {
    if (d.decision === 'rejected') return requiredText(d.reason, 3, 500, 'Reason', 'reason');
    return d.reason ? requiredText(d.reason, 1, 500, 'Reason', 'reason') : null;
  };
  r.post(`${base}/candidates/bulk-decision`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'shortlist');
    const body = parse<any>(decisionSchema.extend({ applicationIds: z.array(uuidSchema).min(1).max(100) }), req.body);
    res.json(await setDecision(pool, push, a, body.applicationIds, body.decision, reasonFor(body)));
  }));
  r.post(`${base}/candidates/:applicationId/decision`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'shortlist');
    const body = parse<any>(decisionSchema, req.body);
    const reason = reasonFor(body);
    const out = await setDecision(pool, push, a, [appId(req)], body.decision, reason);
    if (out.failed.length) throw notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
    res.json({ decision: body.decision === 'clear' ? null : body.decision, reason, at: new Date().toISOString() });
  }));

  // ------------------------------------------------------------------ notes
  r.get(`${base}/candidates/:applicationId/notes`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'notes');
    await loadVisibleApplication(pool, a, appId(req));
    res.json({ items: await listNotes(pool, a, appId(req)) });
  }));
  r.post(`${base}/candidates/:applicationId/notes`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'notes');
    const body = plainBody(req.body, ['body', 'visibility']);
    const text = requiredText(body.body, 1, 2000, 'Note', 'body');
    if (body.visibility !== 'team' && body.visibility !== 'private') throw new ApiError(400, 'VALIDATION_ERROR', 'visibility must be team or private', { visibility: 'visibility must be team or private' });
    res.status(201).json({ note: await addNote(pool, a, appId(req), text, body.visibility) });
  }));
  r.delete(`${base}/candidates/:applicationId/notes/:noteId`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'notes');
    if (!isUuid(req.params.noteId)) throw notFound('Note not found', 'NOTE_NOT_FOUND');
    await deleteNote(pool, a, appId(req), String(req.params.noteId));
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ scorecards
  r.put(`${base}/candidates/:applicationId/scorecards/:roundId`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'scorecards');
    if (!isUuid(req.params.roundId)) throw notFound('Round not found', 'ROUND_NOT_FOUND');
    const body = parse<any>(z.object({
      ratings: z.array(z.object({ itemId: z.string().min(1).max(40), rating: z.number({ message: 'Rating must be a number' }) }).strict()).min(1, 'Rate every rubric item').max(12),
      comments: z.string().trim().max(2000).nullable().optional(),
      recommendation: z.enum([...RECOMMENDATIONS], { message: `recommendation must be one of ${RECOMMENDATIONS.join(', ')}` }),
      questionSetId: uuidSchema.optional(),
    }).strict(), req.body);
    const out = await submitScorecard(pool, a, appId(req), String(req.params.roundId), { ratings: body.ratings, comments: body.comments || null, recommendation: body.recommendation, questionSetId: body.questionSetId ?? null });
    res.status(out.created ? 201 : 200).json({ scorecard: out.scorecard });
  }));
  r.get(`${base}/candidates/:applicationId/scorecards`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'scorecards');
    await loadVisibleApplication(pool, a, appId(req));
    const roundId = typeof req.query.roundId === 'string' ? req.query.roundId : undefined;
    if (roundId && !isUuid(roundId)) throw new ApiError(400, 'VALIDATION_ERROR', 'roundId must be a UUID', { roundId: 'Must be a UUID' });
    res.json(await listScorecards(pool, a, appId(req), roundId));
  }));

  // ------------------------------------------------------------------ outcomes
  r.post(`${base}/candidates/:applicationId/outcomes`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'proposeOutcomes');
    const body = plainBody(req.body, ['kind', 'reason', 'note']);
    if (body.kind !== 'select' && body.kind !== 'reject') throw new ApiError(400, 'VALIDATION_ERROR', 'kind must be select or reject', { kind: 'kind must be select or reject' });
    const reason = body.kind === 'reject' ? requiredText(body.reason, 3, 500, 'Reason', 'reason') : (body.reason ? requiredText(body.reason, 1, 500, 'Reason', 'reason') : null);
    const note = body.note ? requiredText(body.note, 1, 500, 'Note', 'note') : null;
    res.status(201).json({ outcome: await proposeOutcome(pool, push, a, appId(req), body.kind, reason, note) });
  }));
  r.get(`${base}/outcomes`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const q = z.object({ status: z.enum(['pending', 'approved', 'declined']).optional(), cursor: z.string().max(100).optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const out = await listOutcomes(pool, a, q.status, limit, offset);
    res.json({ items: out.items, nextCursor: out.hasMore ? encodeCursor(offset + limit) : null });
  }));
  r.post('/pipeline/outcomes/:id/decide', ...officer, wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ decision: 'approve' | 'decline'; note?: string }>(
      z.object({ decision: z.enum(['approve', 'decline'], { message: 'decision must be approve or decline' }), note: z.string().trim().max(500).optional() }).strict(), req.body);
    res.json(await decideOutcome(pool, push, u, pid(req), body.decision, body.note || null));
  }));

  // ------------------------------------------------------------------ messages
  r.get(`${base}/messages`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'message');
    const q = z.object({ cursor: z.string().max(100).optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const out = await listMessages(pool, a, limit, offset);
    res.json({ items: out.items, nextCursor: out.hasMore ? encodeCursor(offset + limit) : null });
  }));
  r.post(`${base}/messages`, ...staff, wrap(async (req, res) => {
    const a = await access(req, 'message');
    const body = plainBody(req.body, ['body', 'clientId']);
    const text = requiredText(body.body, 1, 2000, 'Message', 'body');
    if (body.clientId !== undefined && !isUuid(body.clientId)) throw new ApiError(400, 'VALIDATION_ERROR', 'clientId must be a UUID', { clientId: 'clientId must be a UUID' });
    const out = await postMessage(pool, push, a, text, body.clientId ?? null);
    res.status(out.replayed ? 200 : 201).json({ message: out.message, ...(out.replayed ? { replayed: true } : {}) });
  }));
  void officerOnly;
}
