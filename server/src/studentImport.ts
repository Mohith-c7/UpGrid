import type { Pool } from 'pg';
import { withTx } from './db';
import { applyPatch, getProfileRow, saveProfile } from './profile';
import { syncForUser } from './reminders';
import {
  normalizeEmail, normalizeRegNo, textSchema, validateBacklogs, validateBatchYear, validateCgpa, validateGapYears,
  validatePercent, validateSemester,
} from './validation';

export const MAX_IMPORT_ROWS = 500;

export const IMPORT_FIELDS = [
  'registrationNumber', 'email', 'department', 'program', 'batchYear', 'semester', 'cgpa', 'cgpaScale',
  'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'gapYears',
] as const;

/** Academic fields an import may set (and then marks `verified`). */
const ACADEMIC_IMPORT = ['department', 'program', 'batchYear', 'semester', 'cgpa', 'cgpaScale', 'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'gapYears'] as const;

export interface ValidRow {
  registrationNumber: string;
  email?: { email: string; uniqueKey: string };
  academics: Record<string, string | number>;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Pure per-row validation with the shared validators. Blank values mean "not provided". */
export function validateImportRow(raw: unknown): { ok: true; value: ValidRow } | { ok: false; fields: Record<string, string>; registrationNumber: string | null } {
  const fields: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, fields: { _: 'Row must be an object' }, registrationNumber: null };
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!(IMPORT_FIELDS as readonly string[]).includes(k)) fields[k] = 'Unknown field';

  let registrationNumber: string | null = typeof row.registrationNumber === 'string' ? row.registrationNumber.trim().toUpperCase().slice(0, 40) || null : null;
  if (isBlank(row.registrationNumber)) fields.registrationNumber = 'Registration number is required';
  else {
    const r = normalizeRegNo(row.registrationNumber);
    if (r.ok) registrationNumber = r.value; else fields.registrationNumber = r.message;
  }

  let email: ValidRow['email'];
  if (!isBlank(row.email)) {
    const e = normalizeEmail(row.email);
    if (e.ok) email = e.value; else fields.email = e.message;
  }

  const academics: Record<string, string | number> = {};
  const take = <T extends string | number>(key: string, check: (v: unknown) => { ok: true; value: T } | { ok: false; message: string }) => {
    if (isBlank(row[key])) return;
    const r = check(row[key]);
    if (r.ok) academics[key] = r.value; else fields[key] = r.message;
  };
  const text = (max: number) => (v: unknown) => {
    const p = textSchema(max, 1).safeParse(v);
    return p.success ? { ok: true as const, value: p.data as string } : { ok: false as const, message: p.error.issues[0]?.message || 'Invalid value' };
  };
  take('department', text(80));
  take('program', text(80));
  take('batchYear', validateBatchYear);
  take('semester', validateSemester);
  take('tenthPercent', validatePercent);
  take('twelfthPercent', validatePercent);
  take('activeBacklogs', validateBacklogs);
  take('gapYears', validateGapYears);
  if (!isBlank(row.cgpaScale)) {
    const n = typeof row.cgpaScale === 'string' ? Number(row.cgpaScale) : row.cgpaScale;
    if (n === 4 || n === 5 || n === 10) academics.cgpaScale = n; else fields.cgpaScale = 'CGPA scale must be 4, 5 or 10';
  }
  take('cgpa', (v) => validateCgpa(v, typeof academics.cgpaScale === 'number' ? academics.cgpaScale : 10));

  if (Object.keys(fields).length) return { ok: false, fields, registrationNumber };
  return { ok: true, value: { registrationNumber: registrationNumber!, email, academics } };
}

export interface ImportResult {
  total: number;
  updated: number;
  unchanged: number;
  unmatched: { row: number; registrationNumber: string; reason: string }[];
  invalid: { row: number; registrationNumber: string | null; fields: Record<string, string> }[];
}

class RowInvalid extends Error {
  constructor(public fields: Record<string, string>) { super('invalid'); }
}

/**
 * Applies an import. Rows are validated up front; each row is then matched and written in its own
 * transaction, so one bad row never blocks or rolls back the others.
 */
export async function runStudentImport(pool: Pool, tenantId: string, actorId: string, rows: unknown[], now = new Date()): Promise<ImportResult> {
  const result: ImportResult = { total: rows.length, updated: 0, unchanged: 0, unmatched: [], invalid: [] };
  const firstSeen = new Map<string, number>();
  const validated = rows.map((raw, i) => ({ n: i + 1, v: validateImportRow(raw) }));
  for (const { n, v } of validated) {
    if (!v.ok) {
      result.invalid.push({ row: n, registrationNumber: v.registrationNumber, fields: v.fields });
      continue;
    }
    const dupOf = firstSeen.get(v.value.registrationNumber);
    if (dupOf !== undefined) {
      result.invalid.push({ row: n, registrationNumber: v.value.registrationNumber, fields: { registrationNumber: `Duplicate of row ${dupOf} in this import` } });
      continue;
    }
    firstSeen.set(v.value.registrationNumber, n);
    try {
      const out = await withTx(pool, async (c) => {
        let student = (
          await c.query(
            `SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id
              WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL AND p.data->'identity'->>'registrationNumber'=$2
              ORDER BY u.created_at LIMIT 1`,
            [tenantId, v.value.registrationNumber],
          )
        ).rows[0];
        let viaEmail = false;
        if (!student && v.value.email) {
          student = (
            await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL AND email_key=$2`, [tenantId, v.value.email.uniqueKey])
          ).rows[0];
          viaEmail = !!student;
        }
        if (!student) return { kind: 'unmatched' as const, reason: v.value.email ? 'No student with this registration number or email' : 'No student with this registration number' };

        await c.query('INSERT INTO profiles (user_id, tenant_id) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING', [student.id, tenantId]);
        await c.query('SELECT 1 FROM profiles WHERE user_id=$1 FOR UPDATE', [student.id]);
        const cur = await getProfileRow(c, student.id);
        const curReg = cur.data.identity?.registrationNumber as string | undefined;
        if (viaEmail && curReg && curReg !== v.value.registrationNumber) {
          return { kind: 'unmatched' as const, reason: `Email belongs to a student with a different registration number (${curReg})` };
        }

        const patch: any = { academics: { ...v.value.academics } };
        if (viaEmail && !curReg) patch.identity = { registrationNumber: v.value.registrationNumber };
        const next = applyPatch(cur, patch);
        // CGPA against the resulting scale (a row may carry only one of cgpa / cgpaScale)
        const a = next.data.academics || {};
        if (a.cgpa !== undefined && a.cgpa !== null && ('cgpa' in v.value.academics || 'cgpaScale' in v.value.academics)) {
          const chk = validateCgpa(a.cgpa, a.cgpaScale || 10);
          if (!chk.ok) throw new RowInvalid({ [('cgpa' in v.value.academics ? 'cgpa' : 'cgpaScale')]: chk.message });
        }
        const verifyKeys = Object.keys(v.value.academics).map((k) => `academics.${k}`);
        if (patch.identity) verifyKeys.push('identity.registrationNumber');
        for (const k of verifyKeys) next.verification[k] = 'verified';

        const changed =
          JSON.stringify(next.data) !== JSON.stringify(cur.data) ||
          JSON.stringify(sortKeys(next.verification)) !== JSON.stringify(sortKeys(cur.verification));
        if (!changed) return { kind: 'unchanged' as const };
        await saveProfile(c, tenantId, student.id, next);
        await syncForUser(c, tenantId, student.id, now);
        return { kind: 'updated' as const };
      });
      if (out.kind === 'updated') result.updated++;
      else if (out.kind === 'unchanged') result.unchanged++;
      else result.unmatched.push({ row: n, registrationNumber: v.value.registrationNumber, reason: out.reason });
    } catch (e) {
      if (e instanceof RowInvalid) result.invalid.push({ row: n, registrationNumber: v.value.registrationNumber, fields: e.fields });
      else throw e;
    }
  }
  result.invalid.sort((x, y) => x.row - y.row);
  await pool.query(`INSERT INTO audit_events (tenant_id, actor_id, action, meta) VALUES ($1,$2,'students.import',$3)`, [
    tenantId, actorId,
    JSON.stringify({ total: result.total, updated: result.updated, unchanged: result.unchanged, unmatched: result.unmatched.length, invalid: result.invalid.length }),
  ]);
  return result;
}

const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
