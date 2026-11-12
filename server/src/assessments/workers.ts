import type { Pool } from 'pg';
import { withTx } from '../db';
import { createNotification, formatIst, getReminderSettings, inQuietHours } from '../notify';
import type { PushSender } from '../push';
import { ANSWER_GRACE_MS, finalizeInTx } from './attempts';
import { runJudgeQueue } from './code';
import { getJudge, type Judge0Client } from './judge';

/** Finalises attempts whose deadline (plus the autosave grace) passed. Safe with several instances (SKIP LOCKED). */
export async function runAutoSubmit(pool: Pool, now = new Date(), max = 500): Promise<number> {
  let n = 0;
  const cutoff = new Date(now.getTime() - ANSWER_GRACE_MS);
  for (; n < max; n++) {
    const done = await withTx(pool, async (c) => {
      const att = (await c.query(
        `SELECT * FROM assessment_attempts WHERE status='in_progress' AND deadline_at <= $1 ORDER BY deadline_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [cutoff])).rows[0];
      if (!att) return false;
      const a = (await c.query('SELECT closes_at FROM assessments WHERE id=$1', [att.assessment_id])).rows[0];
      const closed = a?.closes_at && new Date(att.deadline_at).getTime() >= new Date(a.closes_at).getTime();
      await finalizeInTx(c, att, closed ? 'closed' : 'deadline', now);
      return true;
    });
    if (!done) break;
  }
  return n;
}

export const REMINDER_COPY = {
  t60: (title: string, at: string, mins: number) => ({ title: 'Test starts in 1 hour', body: `${title} opens at ${at}. Duration ${mins} minutes. Read the instructions and keep your device charged.` }),
  t15: (title: string, at: string) => ({ title: 'Test starts in 15 minutes', body: `${title} opens at ${at}. Get ready to begin.` }),
} as const;

export interface ReminderRun { sent: number; skipped: number; cancelled: number; pushes: number }

export async function runDueAssessmentReminders(pool: Pool, push: PushSender, now = new Date(), batch = 200): Promise<ReminderRun> {
  const res: ReminderRun = { sent: 0, skipped: 0, cancelled: 0, pushes: 0 };
  const outbox: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
  await withTx(pool, async (c) => {
    const due = (await c.query(
      `SELECT r.id, r.kind, r.user_id, r.tenant_id, r.assessment_id, a.title, a.status, a.opens_at, a.duration_minutes
         FROM assessment_reminders r JOIN assessments a ON a.id=r.assessment_id
        WHERE r.status='pending' AND r.fire_at <= $1 ORDER BY r.fire_at LIMIT $2 FOR UPDATE OF r SKIP LOCKED`, [now, batch])).rows;
    const set = (id: string, status: string) => c.query('UPDATE assessment_reminders SET status=$2, processed_at=$3 WHERE id=$1', [id, status, now]);
    for (const r of due) {
      if (r.status !== 'published' || !r.opens_at || new Date(r.opens_at).getTime() <= now.getTime()) { await set(r.id, 'cancelled'); res.cancelled++; continue; }
      const started = await c.query('SELECT 1 FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2', [r.assessment_id, r.user_id]);
      if (started.rowCount) { await set(r.id, 'cancelled'); res.cancelled++; continue; }
      const u = await c.query('SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL', [r.user_id]);
      const st = await getReminderSettings(c, r.user_id);
      const pushNow = st.push && !inQuietHours(st.quietHours, now);
      if (!u.rowCount || !st[r.kind as 't60' | 't15'] || (!st.inApp && !pushNow)) { await set(r.id, 'skipped'); res.skipped++; continue; }
      const at = formatIst(new Date(r.opens_at));
      const copy = r.kind === 't60' ? REMINDER_COPY.t60(r.title, at, r.duration_minutes) : REMINDER_COPY.t15(r.title, at);
      const data = { assessmentId: r.assessment_id, kind: r.kind, opensAt: new Date(r.opens_at).toISOString() };
      if (st.inApp) await createNotification(c, r.tenant_id, r.user_id, 'assessment_reminder', copy.title, copy.body, data);
      if (pushNow) for (const t of (await c.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [r.user_id])).rows) outbox.push({ to: t.expo_push_token, title: copy.title, body: copy.body, data });
      await set(r.id, 'sent');
      res.sent++;
    }
  });
  if (outbox.length) {
    const out = await push(outbox.map((m) => ({ ...m, sound: 'default' as const, channelId: 'assessments' })));
    res.pushes = outbox.length;
    if (out?.invalidTokens?.length) await pool.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [out.invalidTokens]);
  }
  return res;
}

export interface WorkerOptions { autoSubmitMs?: number; judgeMs?: number; reminderMs?: number; judge?: Judge0Client; log?: (m: string) => void }

/** Starts the three in-process loops; the returned function stops them and waits for in-flight runs. */
export function startAssessmentWorkers(pool: Pool, push: PushSender, o: WorkerOptions = {}) {
  const log = o.log ?? console.error;
  let stopped = false;
  const inflight = new Set<Promise<void>>();
  const loop = (name: string, ms: number, fn: () => Promise<unknown>) => {
    let running = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      const p = (async () => { try { await fn(); } catch (e) { log(`[assessments:${name}] ${(e as Error).message}`); } finally { running = false; } })();
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
      await p;
    };
    const t = setInterval(() => void tick(), ms);
    t.unref?.();
    void tick();
    return t;
  };
  const timers = [
    loop('auto-submit', o.autoSubmitMs ?? 30_000, () => runAutoSubmit(pool)),
    loop('judge', o.judgeMs ?? 10_000, () => runJudgeQueue(pool, o.judge ?? getJudge())),
    loop('reminders', o.reminderMs ?? 30_000, () => runDueAssessmentReminders(pool, push)),
  ];
  return async () => {
    stopped = true;
    timers.forEach(clearInterval);
    await Promise.allSettled([...inflight]);
  };
}
