import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { withTx } from '../db';
import { ApiError, notFound, parse, unprocessable, wrap } from '../errors';
import { createNotification, formatIst, getReminderSettings, inQuietHours } from '../notify';
import type { PushMessage } from '../push';
import { dispatchMail, MailJob, userMailJob } from '../mail';
import { toCompany } from '../drives';
import { upsertScheduleReminder } from '../reminders';
import { scheduleDto, ScheduleDto } from '../schedule';
import {
  cleanMultiline, SCHEDULE_MODES, SCHEDULE_TYPES, ScheduleMode, ScheduleType, validateScheduledAt, validateVenueOrLink,
} from '../validation';
import { AppStatus, TRANSITIONS } from './applications';

export const MAX_BULK_SCHEDULE = 200;

export interface ScheduleInput { type: ScheduleType; scheduledAt: Date; mode: ScheduleMode; venueOrLink: string; instructions: string | null }

/** Validates the shared schedule fields; collects every field error. */
export function parseScheduleFields(body: Record<string, any>, now = new Date()): ScheduleInput {
  const fields: Record<string, string> = {};
  const type = (SCHEDULE_TYPES as readonly string[]).includes(body.type) ? (body.type as ScheduleType) : null;
  if (!type) fields.type = 'Type must be assessment or interview';
  const mode = (SCHEDULE_MODES as readonly string[]).includes(body.mode) ? (body.mode as ScheduleMode) : null;
  if (!mode) fields.mode = 'Mode must be online or in_person';
  const at = validateScheduledAt(body.scheduledAt, now);
  if (!at.ok) fields.scheduledAt = at.message;
  let venue = '';
  if (mode) {
    const v = validateVenueOrLink(mode, body.venueOrLink);
    if (!v.ok) fields.venueOrLink = v.message; else venue = v.value;
  } else if (body.venueOrLink === undefined || body.venueOrLink === null || body.venueOrLink === '') {
    fields.venueOrLink = 'Enter the meeting link or venue';
  }
  let instructions: string | null = null;
  if (body.instructions !== undefined && body.instructions !== null && body.instructions !== '') {
    const i = cleanMultiline(body.instructions, 0, 500, 'Instructions');
    if (!i.ok) fields.instructions = i.message; else instructions = i.value || null;
  }
  if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
  return { type: type!, scheduledAt: (at as any).value, mode: mode!, venueOrLink: venue, instructions };
}

const SINGLE_KEYS = ['type', 'scheduledAt', 'mode', 'venueOrLink', 'instructions'];

function rejectUnknown(body: Record<string, any>, allowed: string[]) {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body)) if (!allowed.includes(k)) fields[k] = 'Unknown field';
  if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown field: ' + Object.keys(fields)[0], fields);
}

const plainBody = (b: unknown): Record<string, any> => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send a JSON object', { _: 'Send a JSON object' });
  return b as Record<string, any>;
};

interface Applied { status: AppStatus; schedule: ScheduleDto; rescheduled: boolean; push: PushMessage[]; mails: MailJob[] }

export function scheduleRouter(deps: Deps) {
  const { pool, push } = deps;
  const r = Router();
  // guard per route: this router is mounted at '/', so a router-wide guard would also hit later routers
  const officerOnly = [authenticate(deps), requireRole('officer')];

  /** Everything for one application inside the caller's transaction. */
  async function applyOne(c: any, tenantId: string, officerId: string, applicationId: string, input: ScheduleInput, driveId?: string): Promise<Applied> {
    const a = (
      await c.query(
        `SELECT a.*, d.company, d.role AS drive_role, u.deleted_at AS user_deleted
           FROM applications a JOIN drives d ON d.id=a.drive_id JOIN users u ON u.id=a.user_id
          WHERE a.id=$1 AND a.tenant_id=$2 FOR UPDATE OF a`,
        [applicationId, tenantId],
      )
    ).rows[0];
    if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    if (driveId && a.drive_id !== driveId) throw unprocessable('APPLICATION_NOT_IN_DRIVE', 'Application does not belong to this drive');
    if (a.user_deleted) throw unprocessable('STUDENT_INACTIVE', 'This student account is no longer active');
    const target = input.type as AppStatus;
    if (a.status !== target && !TRANSITIONS[a.status as AppStatus].includes(target)) {
      throw unprocessable('INVALID_TRANSITION', `Cannot move an application from ${a.status} to ${target}`);
    }
    // the instant must still be in the future when the row is written (bulk runs can take a while)
    const now = new Date((await c.query('SELECT clock_timestamp() AS n')).rows[0].n);
    if (input.scheduledAt.getTime() <= now.getTime()) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a date and time in the future', { scheduledAt: 'Choose a date and time in the future' });

    const prev = (await c.query('SELECT id FROM application_schedules WHERE application_id=$1 AND superseded_at IS NULL', [a.id])).rows[0];
    if (prev) await c.query('UPDATE application_schedules SET superseded_at=now() WHERE id=$1', [prev.id]);
    const sch = (
      await c.query(
        `INSERT INTO application_schedules (tenant_id, application_id, type, scheduled_at, mode, venue_or_link, instructions, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [tenantId, a.id, input.type, input.scheduledAt, input.mode, input.venueOrLink, input.instructions, officerId],
      )
    ).rows[0];

    const label = input.type === 'assessment' ? 'Assessment' : 'Interview';
    const whenText = formatIst(input.scheduledAt);
    const modeText = input.mode === 'online' ? 'online' : 'in person';
    const rescheduled = !!prev;
    await c.query('UPDATE applications SET status=$2, updated_at=now() WHERE id=$1', [a.id, target]);
    await c.query('INSERT INTO application_events (application_id,status,note,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5)', [
      a.id, target, `${label} ${rescheduled ? 'rescheduled' : 'scheduled'} for ${whenText} (${modeText})`, officerId, 'officer',
    ]);

    await upsertScheduleReminder(c, { tenantId, driveId: a.drive_id, userId: a.user_id, applicationId: a.id, scheduleId: sch.id, scheduledAt: input.scheduledAt }, now);

    const company = toCompany(a.company).name;
    const title = `${label} ${rescheduled ? 'rescheduled' : 'scheduled'}: ${company}`;
    const body =
      `Your ${input.type} for ${a.drive_role} is ${rescheduled ? 'now ' : ''}scheduled for ${whenText} (${modeText}). ` +
      `${input.mode === 'online' ? 'Link' : 'Venue'}: ${input.venueOrLink}.` +
      (input.instructions ? ` Instructions: ${input.instructions}` : '');
    const data = { applicationId: a.id, driveId: a.drive_id, scheduleType: input.type, scheduledAt: input.scheduledAt.toISOString() };
    await createNotification(c, tenantId, a.user_id, 'schedule', title, body, data);

    const settings = await getReminderSettings(c, a.user_id);
    const msgs: PushMessage[] = [];
    if (settings.push && !inQuietHours(settings.quietHours, now)) {
      const tokens = await c.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [a.user_id]);
      for (const t of tokens.rows) msgs.push({ to: t.expo_push_token, title, body, data, sound: 'default', channelId: 'default' });
    }
    const mail = await userMailJob(c, tenantId, a.user_id, 'schedule_notification', {
      company, role: a.drive_role, type: input.type, whenText, mode: input.mode, venueOrLink: input.venueOrLink, instructions: input.instructions, rescheduled,
    });
    return { status: target, schedule: scheduleDto(sch), rescheduled, push: msgs, mails: mail ? [mail] : [] };
  }

  /** Push after commit; never fails the request. */
  async function sendPush(msgs: PushMessage[]) {
    if (!msgs.length) return;
    try {
      const out = await push(msgs);
      if (out?.invalidTokens?.length) await pool.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [out.invalidTokens]);
    } catch {
      /* push is best effort */
    }
  }

  r.post('/applications/:id/schedule', ...officerOnly, wrap(async (req, res) => {
    const u = me(req);
    const body = plainBody(req.body);
    rejectUnknown(body, SINGLE_KEYS);
    const input = parseScheduleFields(body);
    const out = await withTx(pool, (c) => applyOne(c, u.tenantId, u.id, pid(req), input));
    await sendPush(out.push);
    dispatchMail(out.mails);
    res.json({ application: { id: pid(req), status: out.status }, schedule: out.schedule, rescheduled: out.rescheduled });
  }));

  r.post('/drives/:id/schedule-bulk', ...officerOnly, wrap(async (req, res) => {
    const u = me(req);
    const body = plainBody(req.body);
    rejectUnknown(body, ['applicationIds', ...SINGLE_KEYS]);
    const { applicationIds } = parse<{ applicationIds: string[] }>(
      z.object({
        applicationIds: z.array(z.string().uuid('Each applicationId must be a UUID'))
          .min(1, 'Choose at least one application').max(MAX_BULK_SCHEDULE, `Schedule at most ${MAX_BULK_SCHEDULE} applications at a time`),
      }).passthrough(),
      body,
    );
    const input = parseScheduleFields(body);
    const driveId = pid(req);
    const drive = (await pool.query(`SELECT id FROM drives WHERE id=$1 AND tenant_id=$2 AND status <> 'draft'`, [driveId, u.tenantId])).rows[0];
    if (!drive) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');

    const ids = Array.from(new Set(applicationIds));
    let scheduled = 0;
    const failed: { applicationId: string; reason: string }[] = [];
    const pushes: PushMessage[] = [];
    const mails: MailJob[] = [];
    for (const id of ids) {
      try {
        const out = await withTx(pool, (c) => applyOne(c, u.tenantId, u.id, id, input, driveId));
        scheduled++;
        pushes.push(...out.push);
        mails.push(...out.mails);
      } catch (e) {
        if (e instanceof ApiError) failed.push({ applicationId: id, reason: e.message });
        else throw e;
      }
    }
    await sendPush(pushes);
    dispatchMail(mails);
    res.json({ scheduled, failed });
  }));

  return r;
}
