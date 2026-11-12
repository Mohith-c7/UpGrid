import { Router } from 'express';
import { z } from 'zod';
import { Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, parse, wrap } from '../errors';
import { createNotification } from '../notify';
import { recordAudit } from '../policy/audit';
import { columnsOf, iso, likeEscape, pageOf, paging, tableExists, textSchema, uuid } from '../ops/util';
import { httpsUrlSchema } from '../validation';

export const DOC_TYPES = ['marksheet', 'id_proof', 'resume', 'certificate', 'offer_letter', 'other'] as const;
export const REQUIRED_DOCS = ['marksheet', 'id_proof', 'resume'] as const;

const dto = (d: any) => ({
  id: d.id, studentId: d.user_id, docType: d.doc_type, label: d.label, fileId: d.file_id, url: d.url, status: d.status, rejectReason: d.reject_reason,
  reviewedBy: d.reviewed_by, reviewedAt: iso(d.reviewed_at), createdAt: iso(d.created_at),
});

export function documentRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  const off = requireRole('officer');
  const stu = requireRole('student');

  r.post('/documents', stu, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<any>(z.object({ docType: z.enum(DOC_TYPES), label: textSchema(80, 2), fileId: uuid.optional(), url: httpsUrlSchema.optional() }).strict(), req.body ?? {});
    if ((b.fileId === undefined) === (b.url === undefined)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send exactly one of fileId or url', { fileId: 'Send exactly one of fileId or url' });
    if (b.fileId) {
      if (!(await tableExists(pool, 'files'))) throw new ApiError(400, 'VALIDATION_ERROR', 'File uploads are not available yet. Use a link instead.', { fileId: 'File uploads are not available yet' });
      const cols = await columnsOf(pool, 'files');
      const ok = await pool.query(`SELECT 1 FROM files WHERE id=$1 ${cols.has('tenant_id') ? 'AND tenant_id=$2' : ''}`, cols.has('tenant_id') ? [b.fileId, u.tenantId] : [b.fileId]);
      if (!ok.rowCount) throw new ApiError(400, 'VALIDATION_ERROR', 'File not found', { fileId: 'File not found' });
    }
    const row = await withTx(pool, async (c) => {
      const d = (await c.query(`INSERT INTO student_documents (tenant_id,user_id,doc_type,label,file_id,url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [u.tenantId, u.id, b.docType, b.label, b.fileId ?? null, b.url ?? null])).rows[0];
      return d;
    });
    res.status(201).json({ document: dto(row) });
  }));

  r.get('/documents/mine', stu, wrap(async (req, res) => {
    const u = me(req);
    const rows = (await pool.query('SELECT * FROM student_documents WHERE user_id=$1 ORDER BY created_at DESC', [u.id])).rows;
    const verified = [...new Set(rows.filter((d) => d.status === 'verified').map((d) => d.doc_type))];
    const done = REQUIRED_DOCS.filter((t) => verified.includes(t));
    res.json({ items: rows.map(dto), completion: { required: [...REQUIRED_DOCS], verified, percent: Math.round((done.length / REQUIRED_DOCS.length) * 100) } });
  }));

  r.delete('/documents/:id', stu, wrap(async (req, res) => {
    const u = me(req);
    const d = (await pool.query('SELECT * FROM student_documents WHERE id=$1 AND user_id=$2', [pid(req), u.id])).rows[0];
    if (!d) throw notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    if (d.status === 'verified') throw conflict('DOCUMENT_VERIFIED', 'A verified document cannot be deleted. Contact the placement cell.');
    await pool.query('DELETE FROM student_documents WHERE id=$1', [d.id]);
    res.json({ ok: true });
  }));

  r.get('/documents/queue', off, wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      status: z.enum(['pending', 'verified', 'rejected']).default('pending'), docType: z.enum(DOC_TYPES).optional(), q: z.string().max(80).optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const { limit, offset } = paging(q);
    const p: unknown[] = [u.tenantId, q.status]; let w = 'd.tenant_id=$1 AND d.status=$2';
    if (q.docType) { p.push(q.docType); w += ` AND d.doc_type=$${p.length}`; }
    if (q.q) { p.push(`%${likeEscape(q.q)}%`); w += ` AND (s.name ILIKE $${p.length} OR pr.data->'identity'->>'registrationNumber' ILIKE $${p.length})`; }
    const rows = (await pool.query(
      `SELECT d.*, s.name AS student_name, pr.data AS pdata FROM student_documents d JOIN users s ON s.id=d.user_id LEFT JOIN profiles pr ON pr.user_id=d.user_id
        WHERE ${w} ORDER BY d.created_at, d.id LIMIT ${limit + 1} OFFSET ${offset}`, p)).rows;
    res.json(pageOf(rows.map((d) => ({ ...dto(d), student: { id: d.user_id, name: d.student_name, registrationNumber: d.pdata?.identity?.registrationNumber ?? null, department: d.pdata?.academics?.department ?? null } })), limit, offset));
  }));

  async function verifyOne(c: any, tenantId: string, actorId: string, id: string, note?: string) {
    const d = (await c.query('SELECT * FROM student_documents WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, tenantId])).rows[0];
    if (!d) throw notFound('Document not found', 'DOCUMENT_NOT_FOUND');
    if (d.status !== 'pending') throw conflict('NOT_PENDING', `This document is already ${d.status}`);
    const row = (await c.query(`UPDATE student_documents SET status='verified', reviewed_by=$2, reviewed_at=now(), reject_reason=NULL WHERE id=$1 RETURNING *`, [id, actorId])).rows[0];
    await c.query(`UPDATE profiles SET verification = verification || jsonb_build_object($2::text, 'verified') WHERE user_id=$1`, [d.user_id, `documents.${d.doc_type}`]);
    await createNotification(c, tenantId, d.user_id, 'document', 'Document verified', `Your ${d.label} was verified.${note ? ' ' + note : ''}`, { documentId: id, status: 'verified' });
    await recordAudit(c, { tenantId, actorId, action: 'document.verify', entityType: 'document', entityId: id, meta: { studentId: d.user_id, docType: d.doc_type } });
    return row;
  }

  r.post('/documents/bulk-verify', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ ids: string[] }>(z.object({ ids: z.array(uuid).min(1).max(100) }).strict(), req.body ?? {});
    const skipped: { id: string; reason: string }[] = []; let verified = 0;
    for (const id of new Set(b.ids)) {
      try { await withTx(pool, (c) => verifyOne(c, u.tenantId, u.id, id)); verified++; }
      catch (e: any) { if (e instanceof ApiError) skipped.push({ id, reason: e.code === 'NOT_PENDING' ? e.message : 'Not found' }); else throw e; }
    }
    res.json({ verified, skipped });
  }));

  r.post('/documents/:id/verify', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ note?: string }>(z.object({ note: textSchema(300).optional() }).strict(), req.body ?? {});
    const row = await withTx(pool, (c) => verifyOne(c, u.tenantId, u.id, pid(req), b.note));
    res.json({ document: dto(row) });
  }));

  r.post('/documents/:id/reject', off, wrap(async (req, res) => {
    const u = me(req);
    const b = parse<{ reason: string }>(z.object({ reason: textSchema(300, 3) }).strict(), req.body ?? {});
    const row = await withTx(pool, async (c) => {
      const d = (await c.query('SELECT * FROM student_documents WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [pid(req), u.tenantId])).rows[0];
      if (!d) throw notFound('Document not found', 'DOCUMENT_NOT_FOUND');
      if (d.status !== 'pending') throw conflict('NOT_PENDING', `This document is already ${d.status}`);
      const x = (await c.query(`UPDATE student_documents SET status='rejected', reviewed_by=$2, reviewed_at=now(), reject_reason=$3 WHERE id=$1 RETURNING *`, [d.id, u.id, b.reason])).rows[0];
      const still = (await c.query(`SELECT 1 FROM student_documents WHERE user_id=$1 AND doc_type=$2 AND status='verified' LIMIT 1`, [d.user_id, d.doc_type])).rowCount;
      if (!still) await c.query(`UPDATE profiles SET verification = verification - $2::text WHERE user_id=$1`, [d.user_id, `documents.${d.doc_type}`]);
      await createNotification(c as any, u.tenantId, d.user_id, 'document', 'Document needs attention', `Your ${d.label} was not accepted: ${b.reason}`, { documentId: d.id, status: 'rejected' });
      await recordAudit(c, { tenantId: u.tenantId, actorId: u.id, action: 'document.reject', entityType: 'document', entityId: d.id, meta: { studentId: d.user_id, docType: d.doc_type, reason: b.reason } });
      return x;
    });
    res.json({ document: dto(row) });
  }));
  return r;
}
