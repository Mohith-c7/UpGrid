import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { ApiError, notFound, parse, wrap } from '../errors';
import { loadDriveAccess, PermissionKey } from '../pipeline/access';
import {
  approveOffer, createOffer, getOffer, listOffers, markJoined, policyCheck, rejectOffer, revokeOffer, studentOffer,
} from '../pipeline/offers';
import { isUuid, plainBody, requiredText, uuidSchema } from '../pipeline/shared';
import { validateHttpsUrl } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const lpa = (label: string) => z.number({ message: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(10_000_000, `${label} is too large`)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: `${label} can have at most 2 decimals` });
const ctcSchema = z.object({
  fixedLpa: lpa('Fixed CTC').refine((n) => n > 0, { message: 'Fixed CTC must be greater than 0' }),
  variableLpa: lpa('Variable').optional(), bonusLpa: lpa('Bonus').optional(), joiningBonusLpa: lpa('Joining bonus').optional(),
  esopNote: z.string().trim().max(200).nullable().optional(),
  other: z.array(z.object({ label: z.string().trim().min(1).max(60), amountLpa: lpa('Amount') }).strict()).max(5).optional(),
}).strict();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => new Date(s).toISOString().slice(0, 10) === s, 'Enter a valid date');
const offerSchema = z.object({
  ctc: ctcSchema,
  joiningDate: dateOnly.refine((s) => new Date(s + 'T23:59:59Z').getTime() > Date.now(), 'Joining date must be in the future'),
  location: z.string().trim().min(2, 'Location must be at least 2 characters').max(120, 'Location must be at most 120 characters'),
  expiresAt: z.string().datetime({ offset: true, message: 'expiresAt must be an ISO-8601 timestamp' }),
  letterFileId: uuidSchema.nullable().optional(),
  letterUrl: z.string().max(300).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  overrideReason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(300).optional(),
}).strict();

export function registerPipelineOffers(deps: Deps, r: Router) {
  const { pool, push } = deps;
  const auth = authenticate(deps);
  const staff = [auth, requireRole(['officer', 'recruiter'])];
  const officer = [auth, requireRole('officer')];
  const student = [auth, requireRole('student')];
  const access = (req: any, perm?: PermissionKey) => loadDriveAccess(pool, me(req), pid(req), perm);
  const appId = (req: any) => {
    if (!isUuid(req.params.applicationId)) throw notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
    return String(req.params.applicationId);
  };

  r.post('/pipeline/drives/:id/candidates/:applicationId/offers', ...staff, wrap(async (req, res) => {
    const a = await access(req, 'proposeOffers');
    const body = parse<z.infer<typeof offerSchema>>(offerSchema, req.body);
    const exp = new Date(body.expiresAt);
    const fields: Record<string, string> = {};
    if (exp.getTime() <= Date.now()) fields.expiresAt = 'Expiry must be in the future';
    else if (exp.getTime() > Date.now() + 90 * 86400_000) fields.expiresAt = 'Expiry can be at most 90 days ahead';
    let letterUrl: string | null = null;
    if (body.letterUrl) { const u = validateHttpsUrl(body.letterUrl); if (u.ok) letterUrl = u.value; else fields.letterUrl = u.message; }
    if (body.letterFileId && body.letterUrl) fields.letterUrl = 'Send either letterFileId or letterUrl';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    const out = await createOffer(pool, push, a, appId(req), {
      ctc: body.ctc, joiningDate: body.joiningDate, location: body.location, expiresAt: exp, letterFileId: body.letterFileId ?? null, letterUrl,
      notes: body.notes || null, overrideReason: body.overrideReason ?? null,
    });
    res.status(201).json(out);
  }));

  r.post('/pipeline/offers/policy-check', ...staff, wrap(async (req, res) => {
    const body = parse<{ applicationId: string; ctc: z.infer<typeof ctcSchema> }>(z.object({ applicationId: uuidSchema, ctc: ctcSchema }).strict(), req.body);
    const ap = (await pool.query('SELECT drive_id FROM applications WHERE id=$1 AND tenant_id=$2', [body.applicationId, me(req).tenantId])).rows[0];
    if (!ap) throw notFound('Candidate not found', 'CANDIDATE_NOT_FOUND');
    const a = await loadDriveAccess(pool, me(req), ap.drive_id, 'proposeOffers');
    res.json(await policyCheck(pool, a, body.applicationId, body.ctc));
  }));

  r.get('/pipeline/drives/:id/offers', ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const q = z.object({ status: z.enum(['pending_approval', 'rejected', 'issued', 'accepted', 'declined', 'expired', 'revoked', 'joined']).optional(), cursor: z.string().max(100).optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const out = await listOffers(pool, a, q.status, limit, offset);
    res.json({ items: out.items, nextCursor: out.hasMore ? encodeCursor(offset + limit) : null });
  }));

  r.get('/pipeline/offers/:id', ...staff, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Offer not found', 'OFFER_NOT_FOUND');
    res.json(await getOffer(pool, me(req), pid(req)));
  }));

  const idGuard = (req: any) => { if (!isUuid(req.params.id)) throw notFound('Offer not found', 'OFFER_NOT_FOUND'); };
  r.post('/pipeline/offers/:id/approve', ...officer, wrap(async (req, res) => {
    idGuard(req);
    const body = plainBody(req.body, ['overrideReason']);
    const reason = body.overrideReason ? requiredText(body.overrideReason, 10, 300, 'Override reason', 'overrideReason') : null;
    res.json(await approveOffer(pool, push, me(req), pid(req), reason));
  }));
  r.post('/pipeline/offers/:id/reject', ...officer, wrap(async (req, res) => {
    idGuard(req);
    const body = plainBody(req.body, ['reason']);
    res.json(await rejectOffer(pool, push, me(req), pid(req), requiredText(body.reason, 3, 300, 'Reason', 'reason')));
  }));
  r.post('/pipeline/offers/:id/revoke', ...officer, wrap(async (req, res) => {
    idGuard(req);
    const body = plainBody(req.body, ['reason']);
    res.json(await revokeOffer(pool, push, me(req), pid(req), requiredText(body.reason, 3, 300, 'Reason', 'reason')));
  }));
  r.post('/pipeline/offers/:id/joined', ...officer, wrap(async (req, res) => {
    idGuard(req);
    const body = plainBody(req.body, ['joinedOn', 'note']);
    if (body.joinedOn !== undefined && !dateOnly.safeParse(body.joinedOn).success) throw new ApiError(400, 'VALIDATION_ERROR', 'joinedOn must be YYYY-MM-DD', { joinedOn: 'Use YYYY-MM-DD' });
    const note = body.note ? requiredText(body.note, 1, 300, 'Note', 'note') : (body.joinedOn ? `Joined on ${body.joinedOn}` : null);
    res.json(await markJoined(pool, push, me(req), pid(req), note));
  }));

  r.get('/pipeline/applications/:id/offer', ...student, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    res.json(await studentOffer(pool, me(req), pid(req)));
  }));
}
