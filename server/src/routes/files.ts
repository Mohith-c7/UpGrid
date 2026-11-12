import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { authenticate, AuthUser, Deps, me, pid, requireRole } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, unprocessable, wrap } from '../errors';
import { integ } from '../integrations';
import { FILE_PURPOSES, FILE_RULES, FilePurpose, ObjectStorage } from '../storage';
import { hasControlChars } from '../validation';

export const FILE_QUOTA = 20;
export const PRESIGN_EXPIRES = 600;
export const URL_EXPIRES = 300;
const PENDING_PER_HOUR = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FileRow {
  id: string; tenant_id: string; owner_id: string; purpose: FilePurpose; key: string; file_name: string | null;
  content_type: string; size: string | number; status: 'pending' | 'ready' | 'deleted'; created_at: Date;
}
export interface FileAccessContext { db: Pool | PoolClient; user: AuthUser | { id: string; tenantId: string; role: string }; file: FileRow }
export type FileAccessRule = (ctx: FileAccessContext) => Promise<boolean>;

const extraRules: FileAccessRule[] = [];
/** Other modules (e.g. recruiter access to shortlisted applicants' resumes) register extra read-access rules here. */
export function registerFileAccessRule(rule: FileAccessRule): void { extraRules.push(rule); }

export const fileDto = (f: FileRow, publicBaseUrl: string | null = null) => ({
  id: f.id, purpose: f.purpose, fileName: f.file_name, contentType: f.content_type, size: Number(f.size), status: f.status,
  createdAt: new Date(f.created_at).toISOString(),
  ...(f.purpose === 'company_logo' && publicBaseUrl ? { publicUrl: `${publicBaseUrl}/${f.key}` } : {}),
});

const mb = (n: number) => `${n / (1024 * 1024)} MB`;
const extOf = (purpose: FilePurpose, ct: string) => (FILE_RULES[purpose].types as Record<string, string>)[ct];
const baseType = (ct: string | null | undefined) => (ct || '').split(';')[0].trim().toLowerCase();

export async function canReadFile(db: Pool | PoolClient, user: AuthUser, file: FileRow): Promise<boolean> {
  if (file.status !== 'ready') return false;
  if (file.owner_id === user.id) return true;
  if (file.tenant_id !== user.tenantId) return false;
  if (user.role === 'officer') {
    if (file.purpose === 'company_logo') return true;
    if (file.purpose === 'resume') {
      const r = await db.query(`SELECT 1 FROM applications WHERE tenant_id=$1 AND resume_snapshot->>'fileId' = $2 LIMIT 1`, [user.tenantId, file.id]);
      if (r.rowCount) return true;
    }
    if (file.purpose === 'document') {
      const r = await db.query(`SELECT 1 FROM applications WHERE tenant_id=$1 AND user_id=$2 AND status <> 'withdrawn' LIMIT 1`, [user.tenantId, file.owner_id]);
      if (r.rowCount) return true;
    }
  }
  for (const rule of extraRules) if (await rule({ db, user, file })) return true;
  return false;
}

export function filesRouter(deps: Deps) {
  const { pool } = deps;
  const i = integ(deps);
  const r = Router();
  const auth = authenticate(deps);
  const storageOn = (_req: any, _res: any, next: any) =>
    i.storage ? next() : next(new ApiError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'File storage is not configured on this server'));
  const storage = () => i.storage as ObjectStorage;
  const bestEffortRemove = (key: string) => storage().remove(key).catch(() => undefined);

  async function loadOwn(db: Pool | PoolClient, req: any): Promise<FileRow> {
    const u = me(req);
    const id = pid(req);
    const f = UUID_RE.test(id)
      ? (await db.query(`SELECT * FROM files WHERE id=$1 AND tenant_id=$2 AND owner_id=$3 AND status <> 'deleted'`, [id, u.tenantId, u.id])).rows[0]
      : null;
    if (!f) throw notFound('File not found', 'FILE_NOT_FOUND');
    return f;
  }

  // ------------------------------------------------------------ presign
  r.post('/files/presign', auth, storageOn, wrap(async (req, res) => {
    const u = me(req);
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    const purpose = (FILE_PURPOSES as string[]).includes(b.purpose as string) ? (b.purpose as FilePurpose) : null;
    if (!purpose) fields.purpose = `Purpose must be one of ${FILE_PURPOSES.join(', ')}`;
    let fileName = '';
    if (typeof b.fileName !== 'string' || !b.fileName.trim()) fields.fileName = 'File name is required';
    else if (b.fileName.length > 200 || hasControlChars(b.fileName)) fields.fileName = 'File name is invalid or too long (max 200 characters)';
    else fileName = b.fileName.trim();
    const contentType = typeof b.contentType === 'string' ? b.contentType.trim().toLowerCase() : '';
    if (purpose) {
      const rule = FILE_RULES[purpose];
      if (!contentType || !(contentType in rule.types)) {
        fields.contentType = `File type not allowed for ${purpose}. Allowed: ${Object.values(rule.types).join(', ')}`;
      }
      if (typeof b.size !== 'number' || !Number.isInteger(b.size) || b.size < 1) fields.size = 'Size must be a whole number of bytes (at least 1)';
      else if (b.size > rule.maxBytes) fields.size = `File is too large (max ${mb(rule.maxBytes)})`;
    } else if (typeof b.contentType !== 'string') fields.contentType = 'Content type is required';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);
    if (purpose === 'company_logo' && u.role !== 'officer') throw new ApiError(403, 'FORBIDDEN', 'Only placement officers can upload company logos');
    if (purpose === 'resume' && u.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'Only students can upload resumes');

    const id = randomUUID();
    const key = `${u.tenantId}/${u.id}/${purpose}/${id}.${extOf(purpose!, contentType)}`;
    await withTx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`files:${u.id}`]);
      const q = (await c.query(
        `SELECT count(*) FILTER (WHERE status='ready')::int AS ready, count(*) FILTER (WHERE status='pending' AND created_at > now() - interval '1 hour')::int AS pending
           FROM files WHERE owner_id=$1`, [u.id])).rows[0];
      if (q.ready >= FILE_QUOTA) throw conflict('FILE_QUOTA_EXCEEDED', `You can keep up to ${FILE_QUOTA} files. Delete one to upload another.`);
      if (q.pending >= PENDING_PER_HOUR) throw new ApiError(429, 'RATE_LIMITED', 'Too many uploads in progress. Please try again later.');
      await c.query(
        `INSERT INTO files (id, tenant_id, owner_id, purpose, key, file_name, content_type, size, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [id, u.tenantId, u.id, purpose, key, fileName, contentType, b.size]);
    });
    const signed = await storage().presignPut(key, contentType, PRESIGN_EXPIRES);
    res.json({ fileId: id, uploadUrl: signed.url, method: 'PUT', headers: signed.headers, expiresIn: PRESIGN_EXPIRES });
  }));

  // ------------------------------------------------------------ confirm
  r.post('/files/:id/confirm', auth, storageOn, wrap(async (req, res) => {
    const f = await loadOwn(pool, req);
    if (f.status === 'ready') return res.json({ file: fileDto(f, storage().publicBaseUrl) });
    const head = await storage().head(f.key);
    if (!head) throw conflict('UPLOAD_NOT_FOUND', 'No uploaded file was found. Upload the file first, then confirm.');
    const rule = FILE_RULES[f.purpose];
    const bad = head.size !== Number(f.size) || head.size > rule.maxBytes || baseType(head.contentType) !== f.content_type;
    if (bad) {
      await pool.query(`UPDATE files SET status='deleted' WHERE id=$1`, [f.id]);
      await bestEffortRemove(f.key);
      throw unprocessable('FILE_MISMATCH', 'The uploaded file does not match what was declared (size or type). Please try again.');
    }
    const row = await withTx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`files:${f.owner_id}`]);
      const ready = (await c.query(`SELECT count(*)::int n FROM files WHERE owner_id=$1 AND status='ready'`, [f.owner_id])).rows[0].n;
      if (ready >= FILE_QUOTA) return null;
      return (await c.query(`UPDATE files SET status='ready', confirmed_at=now() WHERE id=$1 AND status='pending' RETURNING *`, [f.id])).rows[0] ?? f;
    });
    if (!row) {
      await pool.query(`UPDATE files SET status='deleted' WHERE id=$1`, [f.id]);
      await bestEffortRemove(f.key);
      throw conflict('FILE_QUOTA_EXCEEDED', `You can keep up to ${FILE_QUOTA} files. Delete one to upload another.`);
    }
    res.json({ file: fileDto(row, storage().publicBaseUrl) });
  }));

  // ------------------------------------------------------------ signed read
  r.get('/files/:id/url', auth, storageOn, wrap(async (req, res) => {
    const u = me(req);
    const id = pid(req);
    const f: FileRow | undefined = UUID_RE.test(id)
      ? (await pool.query(`SELECT * FROM files WHERE id=$1 AND tenant_id=$2 AND status='ready'`, [id, u.tenantId])).rows[0]
      : undefined;
    if (!f || !(await canReadFile(pool, u, f))) throw notFound('File not found', 'FILE_NOT_FOUND');
    const url = await storage().presignGet(f.key, URL_EXPIRES, f.file_name);
    res.set('Cache-Control', 'no-store');
    res.json({ url, expiresIn: URL_EXPIRES });
  }));

  // ------------------------------------------------------------ delete
  r.delete('/files/:id', auth, storageOn, wrap(async (req, res) => {
    const f = await loadOwn(pool, req);
    await withTx(pool, async (c) => {
      const used = await c.query(`SELECT 1 FROM applications WHERE resume_snapshot->>'fileId' = $1 AND status <> 'withdrawn' LIMIT 1`, [f.id]);
      if (used.rowCount) throw conflict('FILE_IN_USE', 'This file is attached to an application and cannot be deleted');
      const rs = await c.query('DELETE FROM resumes WHERE file_id=$1 RETURNING user_id, is_default', [f.id]);
      for (const x of rs.rows) {
        if (x.is_default) await c.query('UPDATE resumes SET is_default=true WHERE id=(SELECT id FROM resumes WHERE user_id=$1 ORDER BY created_at LIMIT 1)', [x.user_id]);
      }
      await c.query(`UPDATE files SET status='deleted' WHERE id=$1`, [f.id]);
    });
    await bestEffortRemove(f.key);
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ officer: resume of an application
  r.get('/applications/:id/resume-url', auth, requireRole('officer'), wrap(async (req, res) => {
    const u = me(req);
    const id = pid(req);
    const a = UUID_RE.test(id)
      ? (await pool.query('SELECT id, resume_snapshot FROM applications WHERE id=$1 AND tenant_id=$2', [id, u.tenantId])).rows[0]
      : null;
    if (!a) throw notFound('Application not found', 'APPLICATION_NOT_FOUND');
    const snap = a.resume_snapshot || {};
    const kind = snap.kind === 'file' || snap.fileId ? 'file' : 'link';
    if (kind === 'link') {
      if (!snap.url) throw notFound('Resume not available', 'RESUME_NOT_AVAILABLE');
      return res.json({ kind: 'link', label: snap.label ?? null, url: snap.url });
    }
    if (!i.storage) throw new ApiError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'File storage is not configured on this server');
    const f = (await pool.query(`SELECT * FROM files WHERE id=$1 AND tenant_id=$2 AND status='ready'`, [snap.fileId, u.tenantId])).rows[0];
    if (!f) throw notFound('Resume not available', 'RESUME_NOT_AVAILABLE');
    const url = await i.storage.presignGet(f.key, URL_EXPIRES, f.file_name);
    res.set('Cache-Control', 'no-store');
    res.json({ kind: 'file', label: snap.label ?? null, fileName: f.file_name, url, expiresIn: URL_EXPIRES });
  }));

  return r;
}
