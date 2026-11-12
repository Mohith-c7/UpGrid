import type { Pool } from 'pg';
import type { Db } from './db';
import { evaluateEligibility } from './eligibility';
import { createNotification, formatIst, getReminderSettings, inQuietHours, mergeSettings } from './notify';
import type { PushSender } from './push';
import { withTx } from './db';

export const REMINDER_KINDS = [
  { kind: 't60', minutes: 60 },
  { kind: 't30', minutes: 30 },
  { kind: 't15', minutes: 15 },
] as const;
export type ReminderKind = 't60' | 't30' | 't15';
/** Minutes before an interview/assessment at which the student is reminded. */
export const SCHEDULE_REMINDER_MINUTES = 60;

/** Pure: fire times strictly in the future relative to `now`, and before the deadline. */
export function reminderTimes(deadline: Date, now: Date): { kind: ReminderKind; fireAt: Date }[] {
  return REMINDER_KINDS.map((k) => ({ kind: k.kind as ReminderKind, fireAt: new Date(deadline.getTime() - k.minutes * 60000) })).filter(
    (r) => r.fireAt.getTime() > now.getTime(),
  );
}

export const REMINDER_COPY: Record<ReminderKind, (company: string, role: string, deadlineText: string) => { title: string; body: string }> = {
  t60: (c, r, d) => ({ title: 'Closing in 1 hour', body: `Applications for ${c} \u2014 ${r} close in 1 hour. Review your details and opt in before ${d}.` }),
  t30: (c) => ({ title: '30 minutes left', body: `30 minutes left to apply for ${c}. Your profile is ready. Complete any required questions and opt in.` }),
  t15: (c) => ({ title: 'Final reminder', body: `Final reminder: ${c} applications close in 15 minutes. Apply now if you intend to participate.` }),
};

interface DriveLite { id: string; tenant_id: string; deadline: Date; rules: any; }

/** Students (not deleted) in tenant with profile + verification, excluding those with an active application. */
async function candidates(db: Db, drive: DriveLite) {
  const r = await db.query(
    `SELECT u.id, p.data, p.verification
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.drive_id=$2 AND a.user_id=u.id AND a.status <> 'withdrawn')`,
    [drive.tenant_id, drive.id],
  );
  return r.rows.filter((row) => {
    const res = evaluateEligibility(drive.rules, { academics: row.data?.academics, verification: row.verification });
    return res.status !== 'not_eligible';
  });
}

async function upsert(db: Db, drive: DriveLite, userId: string, now: Date) {
  for (const t of reminderTimes(new Date(drive.deadline), now)) {
    await db.query(
      `INSERT INTO scheduled_reminders (tenant_id, drive_id, user_id, kind, fire_at, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT (drive_id, user_id, kind) DO UPDATE
         SET fire_at = EXCLUDED.fire_at, status='pending', processed_at=NULL
       WHERE scheduled_reminders.status = 'cancelled' OR scheduled_reminders.fire_at <> EXCLUDED.fire_at`,
      [drive.tenant_id, drive.id, userId, t.kind, t.fireAt],
    );
  }
}

/** Create reminders for every eligible-or-pending student of an open drive (idempotent). */
export async function scheduleForDrive(db: Db, driveId: string, now = new Date()): Promise<number> {
  const d = (await db.query(`SELECT id, tenant_id, deadline, rules, status FROM drives WHERE id=$1`, [driveId])).rows[0];
  if (!d || d.status !== 'open' || !d.deadline) return 0;
  const users = await candidates(db, d);
  for (const u of users) await upsert(db, d, u.id, now);
  return users.length;
}

/** Called when a student's profile changes: add or cancel reminders across open drives. */
export async function syncForUser(db: Db, tenantId: string, userId: string, now = new Date()) {
  const p = (await db.query('SELECT data, verification FROM profiles WHERE user_id=$1', [userId])).rows[0];
  const drives = (
    await db.query(
      `SELECT d.id, d.tenant_id, d.deadline, d.rules FROM drives d
        WHERE d.tenant_id=$1 AND d.status='open' AND d.deadline > $2
          AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.drive_id=d.id AND a.user_id=$3 AND a.status <> 'withdrawn')`,
      [tenantId, now, userId],
    )
  ).rows;
  for (const d of drives) {
    const res = evaluateEligibility(d.rules, { academics: p?.data?.academics, verification: p?.verification });
    if (res.status === 'not_eligible') {
      await db.query(
        `UPDATE scheduled_reminders SET status='cancelled', processed_at=now() WHERE drive_id=$1 AND user_id=$2 AND status='pending' AND kind IN ('t60','t30','t15')`,
        [d.id, userId],
      );
    } else {
      await upsert(db, d, userId, now);
    }
  }
}

export async function cancelForDrive(db: Db, driveId: string) {
  await db.query(
    `UPDATE scheduled_reminders SET status='cancelled', processed_at=now() WHERE drive_id=$1 AND status='pending' AND kind IN ('t60','t30','t15')`,
    [driveId],
  );
}
export async function cancelForUserDrive(db: Db, driveId: string, userId: string) {
  await db.query(
    `UPDATE scheduled_reminders SET status='cancelled', processed_at=now() WHERE drive_id=$1 AND user_id=$2 AND status='pending' AND kind IN ('t60','t30','t15')`,
    [driveId, userId],
  );
}

/** Deadline edited: cancel pending reminders then recreate for the new deadline. */
export async function rescheduleForDrive(db: Db, driveId: string, now = new Date()) {
  await cancelForDrive(db, driveId);
  return scheduleForDrive(db, driveId, now);
}

export interface ScheduleReminderInput {
  tenantId: string; driveId: string; userId: string; applicationId: string; scheduleId: string; scheduledAt: Date;
}

/**
 * (Re)creates the single `sched60` reminder of an application. Idempotent: the row is keyed by
 * (drive, user, kind), so calling it again with the same schedule changes nothing, and a reschedule
 * overwrites the previous fire time. If the new fire time is already past, any pending reminder is cancelled instead.
 */
export async function upsertScheduleReminder(db: Db, i: ScheduleReminderInput, now = new Date()): Promise<boolean> {
  const fireAt = new Date(i.scheduledAt.getTime() - SCHEDULE_REMINDER_MINUTES * 60000);
  if (fireAt.getTime() <= now.getTime()) {
    await cancelScheduleReminder(db, i.applicationId);
    return false;
  }
  await db.query(
    `INSERT INTO scheduled_reminders (tenant_id, drive_id, user_id, kind, fire_at, status, application_id, schedule_id)
     VALUES ($1,$2,$3,'sched60',$4,'pending',$5,$6)
     ON CONFLICT (drive_id, user_id, kind) DO UPDATE
       SET fire_at=EXCLUDED.fire_at, status='pending', processed_at=NULL, application_id=EXCLUDED.application_id, schedule_id=EXCLUDED.schedule_id
     WHERE scheduled_reminders.schedule_id IS DISTINCT FROM EXCLUDED.schedule_id
        OR scheduled_reminders.fire_at <> EXCLUDED.fire_at
        OR scheduled_reminders.status = 'cancelled'`,
    [i.tenantId, i.driveId, i.userId, fireAt, i.applicationId, i.scheduleId],
  );
  return true;
}

export async function cancelScheduleReminder(db: Db, applicationId: string) {
  await db.query(
    `UPDATE scheduled_reminders SET status='cancelled', processed_at=now() WHERE application_id=$1 AND kind='sched60' AND status='pending'`,
    [applicationId],
  );
}

export function scheduleReminderCopy(type: string, company: string, role: string, whenText: string, mode: string, venueOrLink: string) {
  const label = type === 'assessment' ? 'Assessment' : 'Interview';
  return {
    title: `${label} in 1 hour`,
    body: `Your ${type} for ${role} at ${company} starts at ${whenText}. ${mode === 'online' ? 'Join' : 'Venue'}: ${venueOrLink}.`,
  };
}

export interface RunResult { sent: number; skipped: number; cancelled: number; pushes: number }

/**
 * Process due reminders. Safe to run from multiple workers (FOR UPDATE SKIP LOCKED) and idempotent
 * (a row leaves 'pending' exactly once inside the same transaction that creates the notification).
 */
export async function runDueReminders(pool: Pool, push: PushSender, now = new Date(), batch = 200): Promise<RunResult> {
  const result: RunResult = { sent: 0, skipped: 0, cancelled: 0, pushes: 0 };
  const outbox: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];

  await withTx(pool, async (c) => {
    const due = (
      await c.query(
        `SELECT sr.id, sr.kind, sr.user_id, sr.tenant_id, sr.drive_id, sr.application_id, sr.schedule_id,
                d.status AS drive_status, d.deadline, d.role, d.company->>'name' AS company_name
           FROM scheduled_reminders sr JOIN drives d ON d.id = sr.drive_id
          WHERE sr.status='pending' AND sr.fire_at <= $1
          ORDER BY sr.fire_at
          LIMIT $2
          FOR UPDATE OF sr SKIP LOCKED`,
        [now, batch],
      )
    ).rows;

    const setStatus = async (id: string, status: string) =>
      c.query(`UPDATE scheduled_reminders SET status=$2, processed_at=$3 WHERE id=$1`, [id, status, now]);

    for (const r of due) {
      if (r.kind === 'sched60') {
        // interview / assessment reminder: independent of the drive deadline, tied to the live schedule
        const sch = (
          await c.query(
            `SELECT s.type, s.scheduled_at, s.mode, s.venue_or_link, s.superseded_at, a.status AS app_status
               FROM application_schedules s JOIN applications a ON a.id = s.application_id
              WHERE s.id=$1 AND s.application_id=$2`,
            [r.schedule_id, r.application_id],
          )
        ).rows[0];
        const startsAt = sch ? new Date(sch.scheduled_at) : null;
        if (!sch || sch.superseded_at || !['assessment', 'interview'].includes(sch.app_status) || !startsAt || startsAt.getTime() <= now.getTime()) {
          await setStatus(r.id, 'cancelled');
          result.cancelled++;
          continue;
        }
        const active = await c.query(`SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL`, [r.user_id]);
        const st = await getReminderSettings(c, r.user_id);
        const quietNow = inQuietHours(st.quietHours, now);
        const pushNow = st.push && !quietNow;
        if (!active.rowCount || (!st.inApp && !pushNow)) {
          await setStatus(r.id, 'skipped');
          result.skipped++;
          continue;
        }
        const msg = scheduleReminderCopy(sch.type, r.company_name || 'the company', r.role || 'the role', formatIst(startsAt), sch.mode, sch.venue_or_link);
        const payload = { applicationId: r.application_id, driveId: r.drive_id, kind: 'sched60', scheduleType: sch.type, scheduledAt: startsAt.toISOString() };
        if (st.inApp) await createNotification(c, r.tenant_id, r.user_id, 'schedule_reminder', msg.title, msg.body, payload);
        if (pushNow) {
          const tokens = await c.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [r.user_id]);
          for (const t of tokens.rows) outbox.push({ to: t.expo_push_token, title: msg.title, body: msg.body, data: payload });
        }
        await setStatus(r.id, 'sent');
        result.sent++;
        continue;
      }
      const deadline = r.deadline ? new Date(r.deadline) : null;
      if (r.drive_status !== 'open' || !deadline || deadline.getTime() <= now.getTime()) {
        await setStatus(r.id, 'cancelled');
        result.cancelled++;
        continue;
      }
      const applied = await c.query(
        `SELECT 1 FROM applications WHERE drive_id=$1 AND user_id=$2 AND status <> 'withdrawn'`,
        [r.drive_id, r.user_id],
      );
      if (applied.rowCount) {
        await setStatus(r.id, 'cancelled');
        result.cancelled++;
        continue;
      }
      const u = await c.query(`SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL`, [r.user_id]);
      const settings = await getReminderSettings(c, r.user_id);
      if (!u.rowCount || !settings[r.kind as ReminderKind]) {
        await setStatus(r.id, 'skipped');
        result.skipped++;
        continue;
      }
      const quiet = inQuietHours(settings.quietHours, now);
      const doPush = settings.push && !quiet;
      if (!settings.inApp && !doPush) {
        await setStatus(r.id, 'skipped');
        result.skipped++;
        continue;
      }
      const copy = REMINDER_COPY[r.kind as ReminderKind](r.company_name || 'Company', r.role || 'Drive', formatIst(deadline));
      const data = { driveId: r.drive_id, kind: r.kind };
      if (settings.inApp) await createNotification(c, r.tenant_id, r.user_id, 'reminder', copy.title, copy.body, data);
      if (doPush) {
        const tokens = await c.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [r.user_id]);
        for (const t of tokens.rows) outbox.push({ to: t.expo_push_token, title: copy.title, body: copy.body, data });
      }
      await setStatus(r.id, 'sent');
      result.sent++;
    }
  });

  if (outbox.length) {
    const out = await push(outbox.map((m) => ({ ...m, sound: 'default' as const, channelId: 'reminders' })));
    result.pushes = outbox.length;
    if (out?.invalidTokens?.length) {
      await pool.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [out.invalidTokens]);
    }
  }
  return result;
}

export function startReminderWorker(pool: Pool, push: PushSender, intervalMs: number, log: (m: string) => void = console.error) {
  let running = false;
  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let done!: () => void;
    inflight = new Promise<void>((r) => { done = r; });
    try {
      let res: RunResult;
      do {
        res = await runDueReminders(pool, push);
      } while (!stopped && res.sent + res.skipped + res.cancelled >= 200);
    } catch (e) {
      log(`[reminders] ${(e as Error).message}`);
    } finally {
      running = false;
      done();
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  /** Stops polling; the returned promise resolves once any in-flight run has finished. */
  return (): Promise<void> => {
    stopped = true;
    clearInterval(timer);
    return inflight;
  };
}

export { mergeSettings };
