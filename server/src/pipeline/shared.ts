import { z } from 'zod';
import type { Pool } from 'pg';
import type { Db } from '../db';
import { ApiError, parse } from '../errors';
import { createNotification, getReminderSettings, inQuietHours } from '../notify';
import type { PushMessage, PushSender } from '../push';
import { cleanMultiline } from '../validation';

export const uuidSchema = z.string().uuid('Must be a valid id');
export const isUuid = (v: unknown): v is string => typeof v === 'string' && uuidSchema.safeParse(v).success;

export const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);

export function plainBody(b: unknown, allowed?: string[]): Record<string, any> {
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send a JSON object', { _: 'Send a JSON object' });
  if (allowed) {
    const bad = Object.keys(b as object).filter((k) => !allowed.includes(k));
    if (bad.length) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown field: ${bad[0]}`, Object.fromEntries(bad.map((k) => [k, 'Unknown field'])));
  }
  return b as Record<string, any>;
}

export const parseBody = <T>(schema: { safeParse: (v: unknown) => any }, body: unknown): T => parse<T>(schema, body ?? {});

/** Optional free text: undefined/null/'' -> null, otherwise validated multiline text. */
export function optionalText(raw: unknown, max: number, label: string, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const r = cleanMultiline(raw, 1, max, label);
  if (!r.ok) throw new ApiError(400, 'VALIDATION_ERROR', r.message, { [field]: r.message });
  return r.value;
}
export function requiredText(raw: unknown, min: number, max: number, label: string, field: string): string {
  const r = cleanMultiline(raw, min, max, label);
  if (!r.ok) throw new ApiError(400, 'VALIDATION_ERROR', r.message, { [field]: r.message });
  return r.value;
}

export async function audit(db: Db, tenantId: string, actorId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_events (tenant_id, actor_id, action, meta) VALUES ($1,$2,$3,$4)', [tenantId, actorId, action, JSON.stringify(meta)]);
}

export async function officerIds(db: Db, tenantId: string): Promise<string[]> {
  return (await db.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='officer' AND deleted_at IS NULL`, [tenantId])).rows.map((r) => r.id);
}

/** Active recruiter members of a drive. */
export async function driveRecruiterIds(db: Db, driveId: string): Promise<string[]> {
  return (await db.query(
    `SELECT cr.user_id FROM company_recruiters cr JOIN users u ON u.id=cr.user_id AND u.deleted_at IS NULL WHERE cr.drive_id=$1 AND cr.revoked_at IS NULL`, [driveId],
  )).rows.map((r) => r.user_id);
}

/**
 * Notifications created inside the caller's transaction; push messages are collected and sent after commit
 * (respecting each user's push setting and quiet hours).
 */
export class Outbox {
  private pushes: PushMessage[] = [];
  constructor(private db: Db, private tenantId: string) {}

  async send(userId: string | null | undefined, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    if (!userId) return;
    await createNotification(this.db, this.tenantId, userId, type, title, body, data);
    const st = await getReminderSettings(this.db, userId);
    if (st.push && !inQuietHours(st.quietHours, new Date())) {
      const t = await this.db.query('SELECT expo_push_token FROM devices WHERE user_id=$1', [userId]);
      for (const row of t.rows) this.pushes.push({ to: row.expo_push_token, title, body, data, sound: 'default', channelId: 'default' });
    }
  }
  async sendMany(userIds: (string | null | undefined)[], type: string, title: string, body: string, data: Record<string, unknown> = {}) {
    for (const id of Array.from(new Set(userIds.filter(Boolean) as string[]))) await this.send(id, type, title, body, data);
  }
  async flush(push: PushSender, pool: Pool) {
    if (!this.pushes.length) return;
    const msgs = this.pushes;
    this.pushes = [];
    try {
      const out = await push(msgs);
      if (out?.invalidTokens?.length) await pool.query('DELETE FROM devices WHERE expo_push_token = ANY($1)', [out.invalidTokens]);
    } catch {
      /* push is best effort */
    }
  }
}

export interface CursorPage { limit: number; offset: number }

export const STATUS_ACTIVE_FOR_ROUNDS = ['screening', 'assessment', 'interview', 'selected'] as const;

export const roundKindIsAssessment = (kind: string) => kind === 'aptitude' || kind === 'assessment' || kind === 'coding';
