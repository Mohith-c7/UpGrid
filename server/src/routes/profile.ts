import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, parse, wrap } from '../errors';
import {
  applyPatch, assertRegNoFree, computeCompletion, countResumes, crossValidate, getProfileRow, profilePatchSchema, saveProfile,
} from '../profile';
import { syncForUser } from '../reminders';
import { integ } from '../integrations';
import { formatPhone, textSchema, httpsUrlSchema } from '../validation';

export async function buildProfileResponse(db: any, userId: string) {
  const u = (await db.query('SELECT id, name, email, phone FROM users WHERE id=$1', [userId])).rows[0];
  const row = await getProfileRow(db, userId);
  const resumeCount = await countResumes(db, userId);
  const d = row.data;
  return {
    user: { id: u.id, name: u.name, email: u.email, phone: u.phone, phoneDisplay: u.phone ? formatPhone(String(u.phone).trim()) : null },
    identity: d.identity || {},
    academics: d.academics || {},
    contact: d.contact || {},
    links: d.links || {},
    skills: d.skills || [],
    preferences: d.preferences || {},
    verification: row.verification,
    completion: computeCompletion(d, resumeCount, !!u.phone),
  };
}

/** resumes joined with their uploaded file (if any) */
export const RESUME_SELECT = 'SELECT r.*, f.file_name AS file_name, f.size AS file_size FROM resumes r LEFT JOIN files f ON f.id=r.file_id';

export function resumeDto(r: any) {
  return {
    id: r.id, label: r.label, url: r.file_id ? null : r.url ?? null, isDefault: r.is_default, createdAt: r.created_at,
    fileId: r.file_id ?? null, kind: (r.file_id ? 'file' : 'link') as 'file' | 'link',
    fileName: r.file_id ? r.file_name ?? null : null, size: r.file_id && r.file_size != null ? Number(r.file_size) : null,
  };
}

export function profileRouter(deps: Deps) {
  const { pool } = deps;
  const router = Router();
  router.use(authenticate(deps), requireRole('student'));

  router.get('/', wrap(async (req, res) => {
    res.json(await buildProfileResponse(pool, me(req).id));
  }));

  router.put('/', wrap(async (req, res) => {
    const u = me(req);
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Body must be an object');
    }
    const patch = parse<z.infer<typeof profilePatchSchema>>(profilePatchSchema, req.body);
    await withTx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [u.id]);
      const cur = await getProfileRow(c, u.id);
      const next = applyPatch(cur, patch);
      const errs = crossValidate(next.data, patch);
      if (Object.keys(errs).length) throw new ApiError(400, 'VALIDATION_ERROR', Object.values(errs)[0], errs);
      const reg = patch.identity?.registrationNumber;
      if (reg) await assertRegNoFree(c, u.tenantId, u.id, reg);
      await saveProfile(c, u.tenantId, u.id, next);
      await syncForUser(c, u.tenantId, u.id);
    });
    res.json(await buildProfileResponse(pool, u.id));
  }));

  // ---------------------------------------------------------- resumes
  router.get('/resumes', wrap(async (req, res) => {
    const rows = (await pool.query(`${RESUME_SELECT} WHERE r.user_id=$1 ORDER BY r.is_default DESC, r.created_at`, [me(req).id])).rows;
    res.json({ items: rows.map(resumeDto) });
  }));

  router.post('/resumes', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ label: string; url?: string; fileId?: string; isDefault?: boolean }>(
      z.object({ label: textSchema(60, 1), url: httpsUrlSchema.optional(), fileId: z.string().uuid('fileId must be a UUID').optional(), isDefault: z.boolean().optional() }).strict(), req.body);
    if ((body.url === undefined) === (body.fileId === undefined)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Send either a resume link (url) or an uploaded file (fileId)', { url: 'Send exactly one of url or fileId', fileId: 'Send exactly one of url or fileId' });
    }
    if (body.fileId !== undefined && !integ(deps).storage) {
      throw new ApiError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'File storage is not configured on this server');
    }
    const row = await withTx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [u.id]);
      const n = (await c.query('SELECT count(*)::int n FROM resumes WHERE user_id=$1', [u.id])).rows[0].n;
      if (n >= 5) throw conflict('RESUME_LIMIT', 'You can save up to 5 resume links', { url: 'Limit of 5 reached' });
      if (body.fileId !== undefined) {
        const f = (await c.query(`SELECT id FROM files WHERE id=$1 AND tenant_id=$2 AND owner_id=$3 AND purpose='resume' AND status='ready'`, [body.fileId, u.tenantId, u.id])).rows[0];
        if (!f) throw new ApiError(400, 'VALIDATION_ERROR', 'Upload and confirm the resume file first', { fileId: 'Choose one of your uploaded resume files' });
        const dupF = await c.query('SELECT 1 FROM resumes WHERE user_id=$1 AND file_id=$2', [u.id, body.fileId]);
        if (dupF.rowCount) throw conflict('RESUME_EXISTS', 'This file is already saved as a resume', { fileId: 'Already saved' });
      }
      const makeDefault = body.isDefault === true || n === 0;
      if (makeDefault) await c.query('UPDATE resumes SET is_default=false WHERE user_id=$1', [u.id]);
      const ins = (await c.query('INSERT INTO resumes (tenant_id,user_id,label,url,file_id,is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [u.tenantId, u.id, body.label, body.url ?? null, body.fileId ?? null, makeDefault])).rows[0];
      return (await c.query(`${RESUME_SELECT} WHERE r.id=$1`, [ins.id])).rows[0];
    });
    res.status(201).json({ resume: resumeDto(row) });
  }));

  router.delete(['/resumes/:id', '/resumes'], wrap(async (req, res) => {
    const u = me(req);
    const rid = req.params.id || (typeof req.query.id === 'string' ? req.query.id : typeof req.body?.id === 'string' ? req.body.id : '');
    if (!/^[0-9a-f-]{36}$/i.test(String(rid))) throw new ApiError(400, 'VALIDATION_ERROR', 'Resume id is required', { id: 'Required' });
    await withTx(pool, async (c) => {
      const del = await c.query('DELETE FROM resumes WHERE id=$1 AND user_id=$2 RETURNING is_default', [rid, u.id]);
      if (!del.rowCount) throw notFound('Resume not found');
      if (del.rows[0].is_default) {
        await c.query('UPDATE resumes SET is_default=true WHERE id=(SELECT id FROM resumes WHERE user_id=$1 ORDER BY created_at LIMIT 1)', [u.id]);
      }
    });
    res.json({ ok: true });
  }));

  // convenience: mark default
  router.post('/resumes/:id/default', wrap(async (req, res) => {
    const u = me(req);
    await withTx(pool, async (c) => {
      const ex = await c.query('SELECT 1 FROM resumes WHERE id=$1 AND user_id=$2', [pid(req), u.id]);
      if (!ex.rowCount) throw notFound('Resume not found');
      await c.query('UPDATE resumes SET is_default=(id=$1) WHERE user_id=$2', [pid(req), u.id]);
    });
    res.json({ ok: true });
  }));

  return router;
}
