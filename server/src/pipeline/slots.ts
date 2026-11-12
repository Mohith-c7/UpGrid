import type { Pool } from 'pg';
import type { Db } from '../db';
import { withTx } from '../db';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../errors';
import { toCompany } from '../drives';
import { formatIst } from '../notify';
import type { PushSender } from '../push';
import { cancelScheduleReminder, upsertScheduleReminder } from '../reminders';
import { TRANSITIONS, AppStatus } from '../routes/applications';
import { DriveAccess, getSettings, normalizePermissions } from './access';
import { audit, iso, officerIds, Outbox, roundKindIsAssessment } from './shared';

export interface SlotInput { startsAt: Date; endsAt: Date; mode: 'online' | 'in_person'; venueOrLink: string; instructions: string | null; capacity: number; panelistIds?: string[] }
export const MIN_SLOT_MINUTES = 10;
export const MAX_SLOT_MINUTES = 480;

export function validateSlotTimes(startsAt: Date, endsAt: Date): string | null {
  const mins = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (mins <= 0) return 'End time must be after the start time';
  if (mins < MIN_SLOT_MINUTES) return `A slot must be at least ${MIN_SLOT_MINUTES} minutes`;
  if (mins > MAX_SLOT_MINUTES) return 'A slot can be at most 8 hours';
  return null;
}

const busy = () => conflict('PANELIST_BUSY', 'A panelist already has another slot at that time');

export async function slotsByIds(db: Db, ids: string[]) {
  if (!ids.length) return [];
  const slots = (await db.query('SELECT * FROM interview_slots WHERE id = ANY($1) ORDER BY starts_at, id', [ids])).rows;
  const panel = (await db.query(
    `SELECT sp.slot_id, sp.user_id, u.name, u.role FROM slot_panelists sp JOIN users u ON u.id=sp.user_id WHERE sp.slot_id = ANY($1) ORDER BY u.name`, [ids])).rows;
  const booked = (await db.query(`SELECT slot_id, count(*)::int n FROM slot_bookings WHERE slot_id = ANY($1) AND status='booked' GROUP BY 1`, [ids])).rows;
  const bm = new Map(booked.map((b) => [b.slot_id, b.n]));
  const proposers = new Map((await db.query('SELECT id, name FROM users WHERE id = ANY($1)', [slots.map((s) => s.proposed_by).filter(Boolean)])).rows.map((u) => [u.id, u.name]));
  return slots.map((s) => ({
    id: s.id, driveId: s.drive_id, roundId: s.round_id, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), mode: s.mode, venueOrLink: s.venue_or_link,
    instructions: s.instructions ?? null, capacity: s.capacity, booked: bm.get(s.id) ?? 0, status: s.status,
    panel: panel.filter((p) => p.slot_id === s.id).map((p) => ({ userId: p.user_id, name: p.name, role: p.role })),
    proposedBy: s.proposed_by ? { id: s.proposed_by, name: proposers.get(s.proposed_by) ?? null } : null, createdAt: iso(s.created_at),
  }));
}

async function validatePanelists(db: Db, access: DriveAccess, ids: string[]) {
  const uniq = Array.from(new Set(ids));
  for (const id of uniq) {
    const u = (await db.query(`SELECT role FROM users WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, access.tenantId])).rows[0];
    let ok = false;
    if (u?.role === 'officer') ok = true;
    else if (u?.role === 'recruiter') ok = !!(await db.query('SELECT 1 FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 AND revoked_at IS NULL', [access.drive.id, id])).rowCount;
    if (!ok) throw new ApiError(400, 'VALIDATION_ERROR', 'Panelists must be officers or recruiters assigned to this drive', { panelistIds: 'Panelists must be officers or recruiters assigned to this drive' });
  }
  return uniq;
}

export async function createSlots(pool: Pool, push: PushSender, access: DriveAccess, round: any, inputs: SlotInput[]) {
  const settings = await getSettings(pool, access.drive.id);
  const ob: Outbox[] = [];
  const ids = await withTx(pool, async (c) => {
    const status = access.role === 'officer' || settings.autoAcceptSlotProposals ? 'open' : 'proposed';
    const o = new Outbox(c, access.tenantId);
    ob.push(o);
    const created: string[] = [];
    for (const s of inputs) {
      const panel = await validatePanelists(c, access, s.panelistIds?.length ? s.panelistIds : [access.userId]);
      const row = (await c.query(
        `INSERT INTO interview_slots (tenant_id, drive_id, round_id, starts_at, ends_at, mode, venue_or_link, instructions, capacity, status, proposed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [access.tenantId, access.drive.id, round.id, s.startsAt, s.endsAt, s.mode, s.venueOrLink, s.instructions, s.capacity, status, access.userId])).rows[0];
      for (const p of panel) {
        await c.query(`INSERT INTO slot_panelists (slot_id, user_id, tenant_id, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,$6)`,
          [row.id, p, access.tenantId, s.startsAt, s.endsAt, status === 'open']).catch((e: any) => { if (e?.code === '23P01') throw busy(); throw e; });
      }
      created.push(row.id);
      await audit(c, access.tenantId, access.userId, 'slot.create', { driveId: access.drive.id, roundId: round.id, slotId: row.id, status });
    }
    if (status === 'proposed') {
      const who = (await c.query('SELECT name FROM users WHERE id=$1', [access.userId])).rows[0]?.name ?? 'A recruiter';
      await o.sendMany(await officerIds(c, access.tenantId), 'slot', `Slots to approve: ${toCompany(access.drive.company).name}`,
        `${who} proposed ${created.length} interview slot${created.length === 1 ? '' : 's'} for ${round.name}.`, { driveId: access.drive.id, roundId: round.id });
    }
    return created;
  });
  for (const o of ob) await o.flush(push, pool);
  return slotsByIds(pool, ids);
}

export async function listSlots(db: Db, access: DriveAccess, f: { roundId?: string; status?: string; from?: Date; to?: Date; limit: number; offset: number }) {
  const params: unknown[] = [access.drive.id, access.tenantId];
  let where = 'drive_id=$1 AND tenant_id=$2';
  if (f.roundId) { params.push(f.roundId); where += ` AND round_id=$${params.length}`; }
  if (f.status) { params.push(f.status); where += ` AND status=$${params.length}`; }
  if (f.from) { params.push(f.from); where += ` AND starts_at >= $${params.length}`; }
  if (f.to) { params.push(f.to); where += ` AND starts_at <= $${params.length}`; }
  const ids = (await db.query(`SELECT id FROM interview_slots WHERE ${where} ORDER BY starts_at, id LIMIT ${f.limit + 1} OFFSET ${f.offset}`, params)).rows.map((r) => r.id);
  const items = await slotsByIds(db, ids.slice(0, f.limit));
  return { items, hasMore: ids.length > f.limit };
}

async function loadSlotFor(db: Db, user: { id: string; tenantId: string; role: string }, slotId: string, lock = true) {
  const s = (await db.query(`SELECT * FROM interview_slots WHERE id=$1 AND tenant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [slotId, user.tenantId])).rows[0];
  const nf = () => notFound('Slot not found', 'SLOT_NOT_FOUND');
  if (!s) throw nf();
  if (user.role === 'recruiter') {
    const m = (await db.query('SELECT permissions FROM company_recruiters WHERE drive_id=$1 AND user_id=$2 AND revoked_at IS NULL', [s.drive_id, user.id])).rows[0];
    if (!m) throw nf();
    if (!normalizePermissions(m.permissions).proposeSlots || s.proposed_by !== user.id) throw forbidden('Only the placement officer or the recruiter who proposed this slot can change it');
  } else if (user.role !== 'officer') throw forbidden('Access denied');
  return s;
}

export async function decideSlot(pool: Pool, push: PushSender, officer: { id: string; tenantId: string; role: string }, slotId: string, approve: boolean, reason: string | null) {
  const ob: Outbox[] = [];
  await withTx(pool, async (c) => {
    const s = await loadSlotFor(c, officer, slotId);
    if (s.status !== 'proposed') throw unprocessable('SLOT_NOT_PROPOSED', 'This slot is not waiting for approval');
    const o = new Outbox(c, officer.tenantId);
    ob.push(o);
    if (approve) {
      if (new Date(s.starts_at) <= new Date()) throw unprocessable('SLOT_STARTED', 'This slot has already started');
      await c.query(`UPDATE interview_slots SET status='open', decided_by=$2, updated_at=now() WHERE id=$1`, [s.id, officer.id]);
      await c.query(`UPDATE slot_panelists SET active=true WHERE slot_id=$1`, [s.id]).catch((e: any) => { if (e?.code === '23P01') throw busy(); throw e; });
    } else {
      await c.query(`UPDATE interview_slots SET status='declined', decided_by=$2, decision_reason=$3, updated_at=now() WHERE id=$1`, [s.id, officer.id, reason]);
    }
    await o.send(s.proposed_by, 'slot', approve ? 'Slot approved' : 'Slot declined', approve ? 'Your proposed interview slot is now open for booking.' : `Your proposed interview slot was declined.${reason ? ' ' + reason : ''}`, { driveId: s.drive_id, slotId: s.id });
    await audit(c, officer.tenantId, officer.id, approve ? 'slot.approve' : 'slot.decline', { driveId: s.drive_id, slotId: s.id, reason });
  });
  for (const o of ob) await o.flush(push, pool);
  return (await slotsByIds(pool, [slotId]))[0];
}

// ------------------------------------------------------------------ schedule bridge (reuses application_schedules + sched60 reminder)
async function writeSchedule(c: Db, tenantId: string, actorId: string, booking: any, slot: any, round: any, drive: any, o: Outbox, userId: string, kind: 'booked' | 'rescheduled') {
  const type = roundKindIsAssessment(round.kind) ? 'assessment' : 'interview';
  const startsAt = new Date(slot.starts_at);
  await c.query('UPDATE application_schedules SET superseded_at=now() WHERE application_id=$1 AND superseded_at IS NULL', [booking.application_id]);
  const sch = (await c.query(
    `INSERT INTO application_schedules (tenant_id, application_id, type, scheduled_at, mode, venue_or_link, instructions, created_by, slot_booking_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId, booking.application_id, type, startsAt, slot.mode, slot.venue_or_link, slot.instructions, actorId, booking.id])).rows[0];
  const a = (await c.query('SELECT status FROM applications WHERE id=$1 FOR UPDATE', [booking.application_id])).rows[0];
  const target = type as AppStatus;
  const whenText = formatIst(startsAt);
  if (a.status !== target && TRANSITIONS[a.status as AppStatus].includes(target)) {
    await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [booking.application_id, target]);
    await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)',
      [booking.application_id, target, `${type === 'assessment' ? 'Assessment' : 'Interview'} slot ${kind} for ${whenText}`, actorId, kind === 'booked' ? 'student' : 'officer']);
  }
  await upsertScheduleReminder(c as any, { tenantId, driveId: drive.id, userId, applicationId: booking.application_id, scheduleId: sch.id, scheduledAt: startsAt });
  return { schedule: { type, scheduledAt: startsAt.toISOString(), mode: slot.mode, venueOrLink: slot.venue_or_link, instructions: slot.instructions ?? null }, whenText };
}

async function notifyPanel(c: Db, o: Outbox, slot: any, title: string, body: string, extra: Record<string, unknown> = {}) {
  const panel = (await c.query('SELECT user_id FROM slot_panelists WHERE slot_id=$1', [slot.id])).rows.map((r) => r.user_id);
  await o.sendMany([...panel, ...(await officerIds(c, slot.tenant_id))], 'slot', title, body, { driveId: slot.drive_id, slotId: slot.id, ...extra });
}

export async function bookSlot(pool: Pool, push: PushSender, student: { id: string; tenantId: string; name: string }, applicationId: string, slotId: string) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const a = (await c.query('SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE', [applicationId, student.tenantId, student.id])).rows[0];
    if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    const slot = (await c.query('SELECT * FROM interview_slots WHERE id=$1 AND tenant_id=$2 AND drive_id=$3 FOR UPDATE', [slotId, student.tenantId, a.drive_id])).rows[0];
    if (!slot) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const round = (await c.query('SELECT * FROM drive_rounds WHERE id=$1', [slot.round_id])).rows[0];
    const drive = (await c.query('SELECT * FROM drives WHERE id=$1', [a.drive_id])).rows[0];
    const rc = (await c.query('SELECT status, waitlisted FROM round_candidates WHERE round_id=$1 AND application_id=$2', [slot.round_id, a.id])).rows[0];
    if (!rc || rc.waitlisted || !['pending', 'invited', 'attended', 'passed'].includes(rc.status)) throw new ApiError(403, 'NOT_IN_ROUND', 'You are not shortlisted for this round');
    if (!['screening', 'assessment', 'interview', 'selected'].includes(a.status)) throw unprocessable('APPLICATION_INACTIVE', 'This application is no longer active');
    const mine = (await c.query(`SELECT * FROM slot_bookings WHERE application_id=$1 AND round_id=$2 AND status='booked'`, [a.id, slot.round_id])).rows[0];
    if (mine && mine.slot_id === slot.id) return { replayed: true, booking: mine, slot, schedule: null as any };
    if (mine) throw conflict('ALREADY_BOOKED', 'You already have a slot for this round. Cancel it first to pick another.');
    if (slot.status !== 'open') throw unprocessable('SLOT_NOT_OPEN', 'This slot is not open for booking');
    const now = new Date((await c.query('SELECT clock_timestamp() n')).rows[0].n);
    if (new Date(slot.starts_at) <= now) throw unprocessable('SLOT_STARTED', 'This slot has already started');
    const taken = (await c.query(`SELECT count(*)::int n FROM slot_bookings WHERE slot_id=$1 AND status='booked'`, [slot.id])).rows[0].n;
    if (taken >= slot.capacity) throw conflict('SLOT_FULL', 'This slot has just been taken. Please pick another.');
    const booking = (await c.query(
      `INSERT INTO slot_bookings (tenant_id, slot_id, round_id, application_id, user_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [student.tenantId, slot.id, slot.round_id, a.id, student.id, slot.starts_at, slot.ends_at]).catch((e: any) => {
        if (e?.code === '23P01') throw conflict('CANDIDATE_BUSY', 'You already have another interview at that time');
        if (e?.code === '23505') throw conflict('ALREADY_BOOKED', 'You already have a slot for this round');
        throw e;
      })).rows[0];
    const o = new Outbox(c, student.tenantId);
    ob.push(o);
    const { schedule, whenText } = await writeSchedule(c, student.tenantId, student.id, booking, slot, round, drive, o, student.id, 'booked');
    const company = toCompany(drive.company).name;
    await o.send(student.id, 'schedule', `Slot confirmed: ${company}`, `${round.name} on ${whenText} (${slot.mode === 'online' ? 'online' : 'in person'}). ${slot.mode === 'online' ? 'Link' : 'Venue'}: ${slot.venue_or_link}.`, { applicationId: a.id, driveId: drive.id, slotId: slot.id, scheduledAt: new Date(slot.starts_at).toISOString() });
    await notifyPanel(c, o, slot, `Slot booked: ${round.name}`, `${student.name} booked ${whenText}.`, { applicationId: a.id });
    await audit(c, student.tenantId, student.id, 'slot.book', { driveId: drive.id, slotId: slot.id, applicationId: a.id, bookingId: booking.id });
    return { replayed: false, booking, slot, schedule };
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

export const bookingDto = (b: any, slot: any) => ({
  id: b.id, slotId: b.slot_id, roundId: b.round_id, startsAt: iso(b.starts_at), endsAt: iso(b.ends_at), mode: slot?.mode ?? slot?.mode, venueOrLink: slot?.venue_or_link ?? null, status: b.status,
});

export async function cancelBooking(pool: Pool, push: PushSender, student: { id: string; tenantId: string; name: string }, applicationId: string, roundId: string, reason: string | null) {
  const ob: Outbox[] = [];
  const out = await withTx(pool, async (c) => {
    const a = (await c.query('SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE', [applicationId, student.tenantId, student.id])).rows[0];
    if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    const b = (await c.query(`SELECT * FROM slot_bookings WHERE application_id=$1 AND round_id=$2 AND status='booked' FOR UPDATE`, [a.id, roundId])).rows[0];
    if (!b) return { ok: true, cancelled: false };
    const slot = (await c.query('SELECT * FROM interview_slots WHERE id=$1', [b.slot_id])).rows[0];
    const cutoff = (await getSettings(c, a.drive_id)).slotCancelCutoffMinutes;
    const now = new Date((await c.query('SELECT clock_timestamp() n')).rows[0].n);
    if (new Date(slot.starts_at).getTime() - now.getTime() < cutoff * 60000) {
      throw unprocessable('CANCEL_WINDOW_CLOSED', `Slots can only be cancelled at least ${cutoff} minutes before they start. Contact the placement cell.`);
    }
    await c.query(`UPDATE slot_bookings SET status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 WHERE id=$1`, [b.id, student.id, reason]);
    await c.query('UPDATE application_schedules SET superseded_at=now() WHERE slot_booking_id=$1 AND superseded_at IS NULL', [b.id]);
    await cancelScheduleReminder(c as any, a.id);
    const o = new Outbox(c, student.tenantId);
    ob.push(o);
    await notifyPanel(c, o, slot, 'Booking cancelled', `${student.name} cancelled the ${formatIst(new Date(slot.starts_at))} booking.${reason ? ' Reason: ' + reason : ''}`, { applicationId: a.id });
    await audit(c, student.tenantId, student.id, 'slot.booking_cancel', { driveId: a.drive_id, slotId: slot.id, applicationId: a.id, reason });
    return { ok: true, cancelled: true };
  });
  for (const o of ob) await o.flush(push, pool);
  return out;
}

export interface SlotPatch { startsAt?: Date; endsAt?: Date; mode?: 'online' | 'in_person'; venueOrLink?: string; instructions?: string | null; panelistIds?: string[] }

export async function updateSlot(pool: Pool, push: PushSender, user: { id: string; tenantId: string; role: string; name: string }, access: DriveAccess | null, slotId: string, p: SlotPatch) {
  const ob: Outbox[] = [];
  await withTx(pool, async (c) => {
    const s = await loadSlotFor(c, user, slotId);
    if (!['proposed', 'open'].includes(s.status)) throw unprocessable('SLOT_NOT_EDITABLE', `A ${s.status} slot cannot be changed`);
    const now = new Date();
    if (new Date(s.starts_at) <= now) throw unprocessable('SLOT_STARTED', 'This slot has already started');
    const startsAt = p.startsAt ?? new Date(s.starts_at);
    const endsAt = p.endsAt ?? new Date(s.ends_at);
    const err = validateSlotTimes(startsAt, endsAt);
    if (err) throw new ApiError(400, 'VALIDATION_ERROR', err, { endsAt: err });
    if (startsAt <= now) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a time in the future', { startsAt: 'Choose a time in the future' });
    const timeChanged = startsAt.getTime() !== new Date(s.starts_at).getTime() || endsAt.getTime() !== new Date(s.ends_at).getTime();
    const mode = p.mode ?? s.mode;
    const venue = p.venueOrLink ?? s.venue_or_link;
    const instr = p.instructions === undefined ? s.instructions : p.instructions;
    await c.query(`UPDATE interview_slots SET starts_at=$2, ends_at=$3, mode=$4, venue_or_link=$5, instructions=$6, updated_at=now() WHERE id=$1`, [s.id, startsAt, endsAt, mode, venue, instr]);
    if (p.panelistIds) {
      const drive = (await c.query('SELECT * FROM drives WHERE id=$1', [s.drive_id])).rows[0];
      const acc = access ?? ({ drive, tenantId: user.tenantId, userId: user.id, role: user.role } as any);
      const panel = await validatePanelists(c, acc, p.panelistIds);
      await c.query('DELETE FROM slot_panelists WHERE slot_id=$1', [s.id]);
      for (const pid of panel) {
        await c.query(`INSERT INTO slot_panelists (slot_id, user_id, tenant_id, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,$6)`, [s.id, pid, user.tenantId, startsAt, endsAt, s.status === 'open']).catch((e: any) => { if (e?.code === '23P01') throw busy(); throw e; });
      }
    } else if (timeChanged) {
      await c.query(`UPDATE slot_panelists SET starts_at=$2, ends_at=$3, reminded_at=NULL WHERE slot_id=$1`, [s.id, startsAt, endsAt]).catch((e: any) => { if (e?.code === '23P01') throw busy(); throw e; });
    }
    const changed = timeChanged || mode !== s.mode || venue !== s.venue_or_link || instr !== s.instructions;
    if (changed) {
      const fresh = (await c.query('SELECT * FROM interview_slots WHERE id=$1', [s.id])).rows[0];
      const round = (await c.query('SELECT * FROM drive_rounds WHERE id=$1', [s.round_id])).rows[0];
      const drive = (await c.query('SELECT * FROM drives WHERE id=$1', [s.drive_id])).rows[0];
      const o = new Outbox(c, user.tenantId);
      ob.push(o);
      if (timeChanged) {
        await c.query(`UPDATE slot_bookings SET starts_at=$2, ends_at=$3 WHERE slot_id=$1 AND status='booked'`, [s.id, startsAt, endsAt]).catch((e: any) => {
          if (e?.code === '23P01') throw conflict('CANDIDATE_BUSY', 'A booked candidate would have another interview at the new time');
          throw e;
        });
      }
      const bookings = (await c.query(`SELECT * FROM slot_bookings WHERE slot_id=$1 AND status='booked'`, [s.id])).rows;
      for (const b of bookings) {
        const { whenText } = await writeSchedule(c, user.tenantId, user.id, b, fresh, round, drive, o, b.user_id, 'rescheduled');
        await o.send(b.user_id, 'schedule', `Interview rescheduled: ${toCompany(drive.company).name}`, `Your ${round.name} slot is now ${whenText} (${mode === 'online' ? 'online' : 'in person'}). ${mode === 'online' ? 'Link' : 'Venue'}: ${venue}.`, { applicationId: b.application_id, driveId: s.drive_id, slotId: s.id, scheduledAt: startsAt.toISOString() });
      }
      await notifyPanel(c, o, fresh, 'Slot updated', `The ${round.name} slot was moved to ${formatIst(startsAt)}.`);
    }
    await audit(c, user.tenantId, user.id, 'slot.update', { driveId: s.drive_id, slotId: s.id, timeChanged });
  });
  for (const o of ob) await o.flush(push, pool);
  return (await slotsByIds(pool, [slotId]))[0];
}

export async function cancelSlot(pool: Pool, push: PushSender, user: { id: string; tenantId: string; role: string }, slotId: string, reason: string) {
  const ob: Outbox[] = [];
  const cancelled = await withTx(pool, async (c) => {
    const s = await loadSlotFor(c, user, slotId);
    if (s.status === 'cancelled') return 0;
    if (!['proposed', 'open'].includes(s.status)) throw unprocessable('SLOT_NOT_EDITABLE', `A ${s.status} slot cannot be cancelled`);
    const drive = (await c.query('SELECT company FROM drives WHERE id=$1', [s.drive_id])).rows[0];
    const bookings = (await c.query(`SELECT * FROM slot_bookings WHERE slot_id=$1 AND status='booked' FOR UPDATE`, [s.id])).rows;
    const o = new Outbox(c, user.tenantId);
    ob.push(o);
    for (const b of bookings) {
      await c.query(`UPDATE slot_bookings SET status='cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3 WHERE id=$1`, [b.id, user.id, `Slot cancelled: ${reason}`]);
      await c.query('UPDATE application_schedules SET superseded_at=now() WHERE slot_booking_id=$1 AND superseded_at IS NULL', [b.id]);
      await cancelScheduleReminder(c as any, b.application_id);
      await o.send(b.user_id, 'schedule', `Interview slot cancelled: ${toCompany(drive.company).name}`, `Your slot on ${formatIst(new Date(s.starts_at))} was cancelled. ${reason} Please pick a new slot.`, { applicationId: b.application_id, driveId: s.drive_id, slotId: s.id });
    }
    await c.query(`UPDATE interview_slots SET status='cancelled', decision_reason=$2, updated_at=now() WHERE id=$1`, [s.id, reason]);
    await c.query(`UPDATE slot_panelists SET active=false WHERE slot_id=$1`, [s.id]);
    await notifyPanel(c, o, s, 'Slot cancelled', `The slot on ${formatIst(new Date(s.starts_at))} was cancelled. ${reason}`);
    await audit(c, user.tenantId, user.id, 'slot.cancel', { driveId: s.drive_id, slotId: s.id, reason, bookings: bookings.length });
    return bookings.length;
  });
  for (const o of ob) await o.flush(push, pool);
  return { slot: (await slotsByIds(pool, [slotId]))[0], cancelledBookings: cancelled };
}

// ------------------------------------------------------------------ student view
export async function studentSlots(db: Db, student: { id: string; tenantId: string }, applicationId: string) {
  const a = (await db.query('SELECT * FROM applications WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [applicationId, student.tenantId, student.id])).rows[0];
  if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
  const rows = (await db.query(
    `SELECT s.*, r.name AS round_name, (SELECT count(*)::int FROM slot_bookings b WHERE b.slot_id=s.id AND b.status='booked') AS booked
       FROM interview_slots s JOIN drive_rounds r ON r.id=s.round_id JOIN round_candidates rc ON rc.round_id=s.round_id AND rc.application_id=$1
      WHERE s.drive_id=$2 AND s.status='open' AND s.starts_at > now() AND NOT rc.waitlisted AND rc.status IN ('pending','invited','attended','passed')
      ORDER BY s.starts_at, s.id`, [a.id, a.drive_id])).rows;
  const bookings = (await db.query(
    `SELECT b.*, s.mode, s.venue_or_link FROM slot_bookings b JOIN interview_slots s ON s.id=b.slot_id WHERE b.application_id=$1 AND b.status='booked' ORDER BY b.starts_at`, [a.id])).rows;
  return {
    items: rows.filter((s) => s.booked < s.capacity).map((s) => ({
      id: s.id, roundId: s.round_id, roundName: s.round_name, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), mode: s.mode, venueOrLink: s.venue_or_link,
      instructions: s.instructions ?? null, remaining: s.capacity - s.booked,
    })),
    booking: bookings[0] ? bookingDto(bookings[0], bookings[0]) : null,
    bookings: bookings.map((b) => bookingDto(b, b)),
  };
}

// ------------------------------------------------------------------ worker: panel reminders
export async function sendPanelReminders(pool: Pool, push: PushSender, now = new Date()): Promise<number> {
  const ob: Outbox[] = [];
  const n = await withTx(pool, async (c) => {
    const rows = (await c.query(
      `SELECT sp.slot_id, sp.user_id, s.tenant_id, s.drive_id, s.starts_at, s.mode, s.venue_or_link, r.name AS round_name,
              (SELECT count(*)::int FROM slot_bookings b WHERE b.slot_id=s.id AND b.status='booked') AS booked
         FROM slot_panelists sp JOIN interview_slots s ON s.id=sp.slot_id JOIN drive_rounds r ON r.id=s.round_id
        WHERE sp.active AND sp.reminded_at IS NULL AND s.status='open' AND s.starts_at > $1 AND s.starts_at <= $1::timestamptz + interval '60 minutes'
        FOR UPDATE OF sp SKIP LOCKED`, [now])).rows;
    let sent = 0;
    for (const r of rows) {
      await c.query('UPDATE slot_panelists SET reminded_at=$3 WHERE slot_id=$1 AND user_id=$2', [r.slot_id, r.user_id, now]);
      if (!r.booked) continue;
      const o = new Outbox(c, r.tenant_id);
      ob.push(o);
      await o.send(r.user_id, 'slot_reminder', `Interview in under an hour: ${r.round_name}`, `${r.booked} candidate${r.booked === 1 ? '' : 's'} booked for ${formatIst(new Date(r.starts_at))}. ${r.mode === 'online' ? 'Link' : 'Venue'}: ${r.venue_or_link}.`, { driveId: r.drive_id, slotId: r.slot_id });
      sent++;
    }
    return sent;
  });
  for (const o of ob) await o.flush(push, pool);
  return n;
}
