import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { ApiError, notFound, parse, wrap } from '../errors';
import { loadDriveAccess, PermissionKey } from '../pipeline/access';
import { loadRound } from '../pipeline/rounds';
import { isUuid, plainBody, requiredText, uuidSchema } from '../pipeline/shared';
import {
  bookingDto, bookSlot, cancelBooking, cancelSlot, createSlots, decideSlot, listSlots, SlotInput, SlotPatch, studentSlots, updateSlot, validateSlotTimes,
} from '../pipeline/slots';
import { cleanMultiline, SCHEDULE_MODES, validateScheduledAt, validateVenueOrLink } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const isoInstant = (raw: unknown, field: string, fields: Record<string, string>, future: boolean): Date | null => {
  if (future) {
    const r = validateScheduledAt(raw);
    if (!r.ok) { fields[field] = r.message; return null; }
    return r.value;
  }
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw)) || !/(Z|[+-]\d{2}:\d{2})$/.test(raw)) { fields[field] = 'Enter an ISO-8601 timestamp with Z or an offset'; return null; }
  return new Date(raw);
};

function parseSlot(raw: any, idx: number): SlotInput {
  const p = `slots.${idx}.`;
  const fields: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Each slot must be an object', { [`slots.${idx}`]: 'Must be an object' });
  const allowed = ['startsAt', 'endsAt', 'mode', 'venueOrLink', 'instructions', 'capacity', 'panelistIds'];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) fields[p + k] = 'Unknown field';
  const startsAt = isoInstant(raw.startsAt, p + 'startsAt', fields, true);
  const endsAt = isoInstant(raw.endsAt, p + 'endsAt', fields, false);
  if (startsAt && endsAt) { const e = validateSlotTimes(startsAt, endsAt); if (e) fields[p + 'endsAt'] = e; }
  if (!(SCHEDULE_MODES as readonly string[]).includes(raw.mode)) fields[p + 'mode'] = 'Mode must be online or in_person';
  let venue = '';
  const v = validateVenueOrLink(raw.mode, raw.venueOrLink);
  if (v.ok) venue = v.value; else fields[p + 'venueOrLink'] = v.message;
  let instructions: string | null = null;
  if (raw.instructions !== undefined && raw.instructions !== null && raw.instructions !== '') {
    const i = cleanMultiline(raw.instructions, 1, 500, 'Instructions');
    if (i.ok) instructions = i.value; else fields[p + 'instructions'] = i.message;
  }
  let capacity = 1;
  if (raw.capacity !== undefined) {
    if (!Number.isInteger(raw.capacity) || raw.capacity < 1 || raw.capacity > 50) fields[p + 'capacity'] = 'Capacity must be a whole number from 1 to 50'; else capacity = raw.capacity;
  }
  let panelistIds: string[] | undefined;
  if (raw.panelistIds !== undefined) {
    if (!Array.isArray(raw.panelistIds) || raw.panelistIds.length > 10 || raw.panelistIds.some((x: unknown) => !isUuid(x))) fields[p + 'panelistIds'] = 'panelistIds must be up to 10 user ids';
    else panelistIds = raw.panelistIds;
  }
  if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
  return { startsAt: startsAt!, endsAt: endsAt!, mode: raw.mode, venueOrLink: venue, instructions, capacity, panelistIds };
}

export function registerPipelineSlots(deps: Deps, r: Router) {
  const { pool, push } = deps;
  const auth = authenticate(deps);
  const staff = [auth, requireRole(['officer', 'recruiter'])];
  const officer = [auth, requireRole('officer')];
  const student = [auth, requireRole('student')];
  const access = (req: any, perm?: PermissionKey) => loadDriveAccess(pool, me(req), pid(req), perm);
  const actor = () => null;
  void actor;

  r.post('/pipeline/drives/:id/rounds/:roundId/slots', ...staff, wrap(async (req, res) => {
    const a = await access(req, 'proposeSlots');
    if (!isUuid(req.params.roundId)) throw notFound('Round not found', 'ROUND_NOT_FOUND');
    const round = await loadRound(pool, a.tenantId, a.drive.id, String(req.params.roundId));
    const body = plainBody(req.body, ['slots']);
    if (!Array.isArray(body.slots) || body.slots.length < 1 || body.slots.length > 50) throw new ApiError(400, 'VALIDATION_ERROR', 'Send 1-50 slots', { slots: 'Send 1-50 slots' });
    const inputs = body.slots.map((s: unknown, i: number) => parseSlot(s, i));
    res.status(201).json({ items: await createSlots(pool, push, a, round, inputs) });
  }));

  r.get('/pipeline/drives/:id/slots', ...staff, wrap(async (req, res) => {
    const a = await access(req, 'viewCandidates');
    const q = z.object({
      roundId: uuidSchema.optional(), status: z.enum(['proposed', 'open', 'cancelled', 'declined']).optional(),
      from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
      cursor: z.string().max(100).optional(), limit: z.string().optional(),
    }).strict().parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const out = await listSlots(pool, a, { roundId: q.roundId, status: q.status, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, limit, offset });
    res.json({ items: out.items, nextCursor: out.hasMore ? encodeCursor(offset + limit) : null });
  }));

  r.post('/pipeline/slots/:id/approve', ...officer, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    res.json({ slot: await decideSlot(pool, push, me(req), pid(req), true, null) });
  }));
  r.post('/pipeline/slots/:id/decline', ...officer, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const body = plainBody(req.body, ['reason']);
    res.json({ slot: await decideSlot(pool, push, me(req), pid(req), false, requiredText(body.reason, 3, 300, 'Reason', 'reason')) });
  }));

  r.patch('/pipeline/slots/:id', ...staff, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const body = plainBody(req.body, ['startsAt', 'endsAt', 'mode', 'venueOrLink', 'instructions', 'panelistIds']);
    const fields: Record<string, string> = {};
    const patch: SlotPatch = {};
    if (body.startsAt !== undefined) { const d = isoInstant(body.startsAt, 'startsAt', fields, true); if (d) patch.startsAt = d; }
    if (body.endsAt !== undefined) { const d = isoInstant(body.endsAt, 'endsAt', fields, false); if (d) patch.endsAt = d; }
    if (body.mode !== undefined) { if (!(SCHEDULE_MODES as readonly string[]).includes(body.mode)) fields.mode = 'Mode must be online or in_person'; else patch.mode = body.mode; }
    if (body.venueOrLink !== undefined) {
      let mode = patch.mode;
      if (!mode) mode = (await pool.query('SELECT mode FROM interview_slots WHERE id=$1 AND tenant_id=$2', [pid(req), me(req).tenantId])).rows[0]?.mode;
      const v = validateVenueOrLink(mode, body.venueOrLink);
      if (v.ok) patch.venueOrLink = v.value; else fields.venueOrLink = v.message;
    }
    if (body.instructions !== undefined) {
      if (body.instructions === null || body.instructions === '') patch.instructions = null;
      else { const i = cleanMultiline(body.instructions, 1, 500, 'Instructions'); if (i.ok) patch.instructions = i.value; else fields.instructions = i.message; }
    }
    if (body.panelistIds !== undefined) {
      if (!Array.isArray(body.panelistIds) || !body.panelistIds.length || body.panelistIds.length > 10 || body.panelistIds.some((x: unknown) => !isUuid(x))) fields.panelistIds = 'panelistIds must be 1-10 user ids';
      else patch.panelistIds = body.panelistIds;
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    if (!Object.keys(patch).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Send at least one field to change', { _: 'Nothing to update' });
    res.json({ slot: await updateSlot(pool, push, me(req), null, pid(req), patch) });
  }));

  r.post('/pipeline/slots/:id/cancel', ...staff, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const body = plainBody(req.body, ['reason']);
    res.json(await cancelSlot(pool, push, me(req), pid(req), requiredText(body.reason, 3, 300, 'Reason', 'reason')));
  }));

  // ------------------------------------------------------------------ student
  r.get('/pipeline/applications/:id/slots', ...student, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    res.json(await studentSlots(pool, me(req), pid(req)));
  }));
  r.post('/pipeline/applications/:id/slots/:slotId/book', ...student, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    if (!isUuid(req.params.slotId)) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const out = await bookSlot(pool, push, me(req), pid(req), String(req.params.slotId));
    if (out.replayed) {
      const sch = (await pool.query('SELECT type, scheduled_at, mode, venue_or_link, instructions FROM application_schedules WHERE slot_booking_id=$1 AND superseded_at IS NULL', [out.booking.id])).rows[0];
      return res.json({ booking: bookingDto(out.booking, out.slot), schedule: sch ? { type: sch.type, scheduledAt: new Date(sch.scheduled_at).toISOString(), mode: sch.mode, venueOrLink: sch.venue_or_link, instructions: sch.instructions ?? null } : null, replayed: true });
    }
    res.status(201).json({ booking: bookingDto(out.booking, out.slot), schedule: out.schedule });
  }));
  r.post('/pipeline/applications/:id/rounds/:roundId/booking/cancel', ...student, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    if (!isUuid(req.params.roundId)) throw notFound('Round not found', 'ROUND_NOT_FOUND');
    const body = plainBody(req.body, ['reason']);
    const reason = body.reason ? requiredText(body.reason, 1, 300, 'Reason', 'reason') : null;
    res.json(await cancelBooking(pool, push, me(req), pid(req), String(req.params.roundId), reason));
  }));
}
