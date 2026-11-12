import type { Db } from '../db';

export interface AuditInput {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

/** Appends one row to audit_events. Other modules may import this (offers, overrides, invites, ...). */
export async function recordAudit(db: Db, e: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (tenant_id, actor_id, action, entity_type, entity_id, meta) VALUES ($1,$2,$3,$4,$5,$6)`,
    [e.tenantId, e.actorId ?? null, e.action, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.meta ?? {})],
  );
}

const SECRET_KEY = /(password|token|secret|hash|otp|authorization|apikey|api_key)/i;

export function maskEmail(v: string): string {
  const at = v.indexOf('@');
  if (at < 1) return '***';
  return `${v[0]}***${v.slice(at)}`;
}
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `${d.slice(0, 2)}${'*'.repeat(d.length - 4)}${d.slice(-2)}`;
}

/** Deep-masks sensitive keys in an audit meta object. Pure. */
export function maskMeta(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => maskMeta(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) out[k] = '***';
      else if (/email/i.test(k) && typeof v === 'string') out[k] = maskEmail(v);
      else if (/phone|mobile/i.test(k) && typeof v === 'string') out[k] = maskPhone(v);
      else out[k] = maskMeta(v, depth + 1);
    }
    return out;
  }
  return value;
}
