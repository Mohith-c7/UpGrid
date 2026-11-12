import type { Db } from './db';

export async function createNotification(
  db: Db, tenantId: string, userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {},
) {
  const r = await db.query(
    `INSERT INTO notifications (tenant_id, user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, userId, type, title, body, JSON.stringify(data)],
  );
  return r.rows[0].id as string;
}

export interface ReminderSettings {
  t60: boolean; t30: boolean; t15: boolean; push: boolean; inApp: boolean;
  /** email notifications (schedules, offer responses, ticket replies); default true */
  email: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  t60: true, t30: true, t15: true, push: true, inApp: true, email: true,
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
};

export function mergeSettings(stored: any): ReminderSettings {
  return {
    ...DEFAULT_REMINDER_SETTINGS,
    ...(stored || {}),
    quietHours: { ...DEFAULT_REMINDER_SETTINGS.quietHours, ...(stored?.quietHours || {}) },
  };
}

export async function getReminderSettings(db: Db, userId: string): Promise<ReminderSettings> {
  const r = await db.query('SELECT settings FROM reminder_settings WHERE user_id=$1', [userId]);
  return mergeSettings(r.rows[0]?.settings);
}

/** minutes since midnight in IST */
export function istMinutes(d: Date): number {
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export function inQuietHours(q: ReminderSettings['quietHours'], at: Date): boolean {
  if (!q.enabled) return false;
  const cur = istMinutes(at);
  const s = toMin(q.start);
  const e = toMin(q.end);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function formatIst(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d).replace(/\s?(am|pm)/i, (m) => ` ${m.trim().toUpperCase()}`) + ' IST'
  );
}
