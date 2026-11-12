import type { Pool } from 'pg';
import { evaluateEligibility } from '../eligibility';
import { composeExtra, buildConditionContext } from '../policy/conditions';
import { resolveCohort } from '../policy/cohorts';
import { createNotification, getReminderSettings, inQuietHours } from '../notify';
import type { Db } from '../db';
import type { PushSender } from '../push';
import { mailEnabled, sendMail } from '../mail';

export type Audience =
  | { type: 'all' }
  | { type: 'cohort'; cohortId: string }
  | { type: 'drive_participants'; driveId: string }
  | { type: 'eligible_not_applied'; driveId: string };

export type Mailer = (m: { to: string; subject: string; text: string }) => Promise<unknown>;
let customMailer: Mailer | null = null;
/** Hook: the mail module (or a test) registers how emails are sent. */
export function setAnnouncementMailer(m: Mailer | null) { customMailer = m; }
function resolveMailer(): Mailer | null {
  if (customMailer) return customMailer;
  // the mail module (src/mail): only when email can really be delivered (SMTP configured or an injected mailer)
  if (mailEnabled()) {
    return async (m) => {
      const ok = await sendMail(m.to, 'generic_notification', { title: m.subject, body: m.text });
      if (!ok) throw new Error('mail not accepted');
    };
  }
  return null;
}

export async function resolveAudience(db: Db, tenantId: string, a: Audience): Promise<string[]> {
  if (a.type === 'all') {
    return (await db.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL ORDER BY id`, [tenantId])).rows.map((x) => x.id);
  }
  if (a.type === 'cohort') return resolveCohort(db, a.cohortId, tenantId);
  const drive = (await db.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2`, [a.driveId, tenantId])).rows[0];
  if (!drive) return [];
  if (a.type === 'drive_participants') {
    return (await db.query(`SELECT DISTINCT user_id FROM applications WHERE drive_id=$1 AND tenant_id=$2 AND status<>'withdrawn'`, [a.driveId, tenantId])).rows.map((x) => x.user_id);
  }
  const studs = (await db.query(
    `SELECT u.id, p.data, p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM applications ap WHERE ap.user_id=u.id AND ap.drive_id=$2 AND ap.status<>'withdrawn') ORDER BY u.id`, [tenantId, a.driveId])).rows;
  return studs.filter((s) => {
    const base = evaluateEligibility(drive.rules, { academics: s.data?.academics, verification: s.verification });
    const res = composeExtra(base, drive.rules?.extra, buildConditionContext({ academics: s.data?.academics, contact: s.data?.contact, skills: s.data?.skills, verification: s.verification }));
    return res.status === 'eligible';
  }).map((s) => s.id);
}

export interface DeliverResult { delivered: number; skipped: boolean }

/** Sends one announcement exactly once: claim (row lock) -> insert deliveries (unique) -> notifications -> mark sent. Push/email after commit. */
export async function deliverAnnouncement(pool: Pool, push: PushSender, id: string, opts: { onlyDue?: boolean } = {}): Promise<DeliverResult> {
  const client = await pool.connect();
  let newUsers: string[] = [];
  let ann: any;
  try {
    await client.query('BEGIN');
    ann = (await client.query(
      `SELECT * FROM announcements WHERE id=$1 AND status IN ('draft','scheduled') ${opts.onlyDue ? 'AND send_at <= now()' : ''} FOR UPDATE SKIP LOCKED`, [id])).rows[0];
    if (!ann) { await client.query('ROLLBACK'); return { delivered: 0, skipped: true }; }
    const ids = await resolveAudience(client, ann.tenant_id, ann.audience);
    const ch = ann.channels || {};
    if (ids.length) {
      const ins = await client.query(
        `INSERT INTO announcement_deliveries (announcement_id, user_id, tenant_id) SELECT $1, x, $3 FROM unnest($2::uuid[]) x ON CONFLICT DO NOTHING RETURNING user_id`, [ann.id, ids, ann.tenant_id]);
      newUsers = ins.rows.map((x) => x.user_id);
    }
    if (ch.inApp !== false) {
      for (const uid of newUsers) await createNotification(client, ann.tenant_id, uid, 'announcement', ann.title, ann.body, { announcementId: ann.id, ...(ann.audience?.driveId ? { driveId: ann.audience.driveId } : {}) });
    }
    const total = (await client.query('SELECT count(*)::int n FROM announcement_deliveries WHERE announcement_id=$1', [ann.id])).rows[0].n;
    await client.query(`UPDATE announcements SET status='sent', sent_at=now(), recipients=$2, updated_at=now() WHERE id=$1`, [ann.id, total]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  // after commit: push + email (best effort, at-most-once)
  const ch = ann.channels || {};
  if (ch.push && newUsers.length) {
    const msgs: any[] = [];
    const sentTo: string[] = []; const skippedTo: string[] = [];
    for (const uid of newUsers) {
      const s = await getReminderSettings(pool, uid);
      if (!s.push || inQuietHours(s.quietHours, new Date())) { skippedTo.push(uid); continue; }
      const toks = (await pool.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [uid])).rows;
      if (!toks.length) { skippedTo.push(uid); continue; }
      sentTo.push(uid);
      for (const t of toks) msgs.push({ to: t.expo_push_token, title: ann.title, body: ann.body.slice(0, 140), data: { announcementId: ann.id }, sound: 'default' });
    }
    if (msgs.length) await push(msgs).catch(() => undefined);
    if (sentTo.length) await pool.query(`UPDATE announcement_deliveries SET push_status='sent' WHERE announcement_id=$1 AND user_id = ANY($2::uuid[])`, [ann.id, sentTo]);
    if (skippedTo.length) await pool.query(`UPDATE announcement_deliveries SET push_status='skipped' WHERE announcement_id=$1 AND user_id = ANY($2::uuid[])`, [ann.id, skippedTo]);
  }
  if (ch.email && newUsers.length) {
    const mailer = resolveMailer();
    if (!mailer) {
      await pool.query(`UPDATE announcement_deliveries SET email_status='no_mailer' WHERE announcement_id=$1 AND user_id = ANY($2::uuid[])`, [ann.id, newUsers]);
    } else {
      const users = (await pool.query('SELECT id, email FROM users WHERE id = ANY($1::uuid[])', [newUsers])).rows;
      for (const u of users) {
        let st = 'sent';
        try { await mailer({ to: u.email, subject: ann.title, text: ann.body }); } catch { st = 'failed'; }
        await pool.query(`UPDATE announcement_deliveries SET email_status=$3 WHERE announcement_id=$1 AND user_id=$2`, [ann.id, u.id, st]);
      }
    }
  }
  return { delivered: newUsers.length, skipped: false };
}

/** One worker pass: deliver every scheduled announcement whose send_at has passed. */
export async function runDueAnnouncements(pool: Pool, push: PushSender): Promise<number> {
  const due = (await pool.query(`SELECT id FROM announcements WHERE status='scheduled' AND send_at <= now() ORDER BY send_at LIMIT 20`)).rows;
  let n = 0;
  for (const d of due) {
    const r = await deliverAnnouncement(pool, push, d.id, { onlyDue: true });
    if (!r.skipped) n++;
  }
  return n;
}

export function startAnnouncementWorker(pool: Pool, push: PushSender, intervalMs: number, log: (m: string) => void = console.error) {
  let running = false; let stopped = false; let inflight: Promise<void> = Promise.resolve();
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let done!: () => void;
    inflight = new Promise<void>((r) => { done = r; });
    try { await runDueAnnouncements(pool, push); } catch (e) { log(`[announcements] ${(e as Error).message}`); } finally { running = false; done(); }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return async (): Promise<void> => { stopped = true; clearInterval(timer); await inflight; };
}
