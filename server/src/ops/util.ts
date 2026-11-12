import { z } from 'zod';
import { ApiError } from '../errors';
import { decodeCursor, encodeCursor, pageLimit } from '../routes/drives';
import { textSchema } from '../validation';

export { decodeCursor, encodeCursor, pageLimit, textSchema };

export const uuid = z.string().uuid('Must be a valid id');
export const isoDate = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });

export function pageOf<T>(rows: T[], limit: number, offset: number): { items: T[]; nextCursor: string | null } {
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
}
export function paging(q: any) {
  const limit = pageLimit(q.limit);
  const offset = decodeCursor(q.cursor);
  return { limit, offset };
}

export function bad(message: string, fields?: Record<string, string>): never {
  throw new ApiError(400, 'VALIDATION_ERROR', message, fields);
}

export const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);

/** Escapes LIKE wildcards in user input. */
export const likeEscape = (s: string) => s.replace(/[%_\\]/g, (m) => '\\' + m);

export async function tableExists(db: { query: (q: string, p?: any[]) => Promise<any> }, name: string): Promise<boolean> {
  const r = await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return !!r.rows[0]?.ok;
}
export async function columnsOf(db: { query: (q: string, p?: any[]) => Promise<any> }, table: string): Promise<Set<string>> {
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Set(r.rows.map((x: any) => x.column_name));
}
