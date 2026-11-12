import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, requireRole, pid } from '../context';
import { withTx } from '../db';
import { evaluateEligibility } from '../eligibility';
import { ApiError, notFound, parse, wrap } from '../errors';
import { createNotification } from '../notify';
import { computeCompletion, getProfileRow, saveProfile, VERIFIABLE } from '../profile';
import { formatPhone, textSchema } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';
import { resumeDto, RESUME_SELECT } from './profile';
import { MAX_IMPORT_ROWS, runStudentImport } from '../studentImport';

export function pendingVerificationFields(data: any, verification: Record<string, string>): string[] {
  const out: string[] = [];
  for (const key of VERIFIABLE) {
    const [sec, fld] = key.split('.');
    const val = data?.[sec]?.[fld];
    if (val === undefined || val === null || val === '') continue;
    if (key === 'academics.cgpaScale' || key === 'academics.university') continue;
    if (verification?.[key] !== 'verified') out.push(key);
  }
  return out;
}

export function officerRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  // path-scoped: this router is mounted at '/', and a router-wide guard would 403 every later module's routes for non-officers
  r.use(['/students', '/officer', '/announcements'], authenticate(deps), requireRole('officer'));

  // ---------------------------------------------------------------- students
  r.get('/students', wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({
      q: z.string().max(100).optional(), branch: z.string().max(80).optional(), batch: z.coerce.number().int().optional(),
      verified: z.enum(['true', 'false', '1', '0']).optional(), cursor: z.string().optional(), limit: z.string().optional(),
    }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId];
    let where = `u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`;
    if (q.q) {
      params.push(`%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
      where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR p.data->'identity'->>'registrationNumber' ILIKE $${params.length})`;
    }
    if (q.branch) { params.push(q.branch); where += ` AND lower(p.data->'academics'->>'department') = lower($${params.length})`; }
    if (q.batch) { params.push(String(q.batch)); where += ` AND p.data->'academics'->>'batchYear' = $${params.length}`; }
    const rows = (await pool.query(
      `SELECT u.id,u.name,u.email,u.phone,p.data,p.verification FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE ${where} ORDER BY u.name, u.id`, params)).rows;
    let items = rows.map((s) => {
      const pend = pendingVerificationFields(s.data || {}, s.verification || {});
      return {
        id: s.id, name: s.name, email: s.email, phone: s.phone, phoneDisplay: formatPhone(s.phone),
        registrationNumber: s.data?.identity?.registrationNumber ?? null, department: s.data?.academics?.department ?? null,
        batchYear: s.data?.academics?.batchYear ?? null, cgpa: s.data?.academics?.cgpa ?? null,
        pendingVerificationFields: pend, verified: Object.keys(s.data?.academics || {}).length > 0 && pend.length === 0,
      };
    });
    if (q.verified) {
      const want = q.verified === 'true' || q.verified === '1';
      items = items.filter((i) => (want ? i.verified : !i.verified));
    }
    res.json({ items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null });
  }));

  // Bulk update of academics from the university's records. Matched fields become `verified`.
  r.post('/students/import', wrap(async (req, res) => {
    const u = me(req);
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Send a non-empty rows array', { rows: 'Send a non-empty rows array' });
    if (rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, 'VALIDATION_ERROR', `Import at most ${MAX_IMPORT_ROWS} rows at a time`, { rows: `At most ${MAX_IMPORT_ROWS} rows per import` });
    const extra = Object.keys(req.body).filter((k) => k !== 'rows');
    if (extra.length) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown field: ${extra[0]}`, { [extra[0]]: 'Unknown field' });
    res.json(await runStudentImport(pool, u.tenantId, u.id, rows));
  }));

  r.get('/students/:id', wrap(async (req, res) => {
    const u = me(req);
    const s = (await pool.query(`SELECT * FROM users WHERE id=$1 AND tenant_id=$2 AND role='student' AND deleted_at IS NULL`, [pid(req), u.tenantId])).rows[0];
    if (!s) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
    const p = await getProfileRow(pool, s.id);
    const resumes = (await pool.query(`${RESUME_SELECT} WHERE r.user_id=$1 ORDER BY r.is_default DESC, r.created_at`, [s.id])).rows;
    const apps = (await pool.query(
      `SELECT a.id,a.reference,a.status,a.submitted_at,d.id AS drive_id,d.company,d.role FROM applications a JOIN drives d ON d.id=a.drive_id WHERE a.user_id=$1 ORDER BY a.submitted_at DESC`, [s.id])).rows;
    res.json({
      student: { id: s.id, name: s.name, email: s.email, phone: s.phone, phoneDisplay: s.phone ? formatPhone(String(s.phone).trim()) : null, createdAt: s.created_at },
      identity: p.data.identity || {}, academics: p.data.academics || {}, contact: p.data.contact || {}, links: p.data.links || {},
      skills: p.data.skills || [], preferences: p.data.preferences || {}, verification: p.verification,
      pendingVerificationFields: pendingVerificationFields(p.data, p.verification),
      completion: computeCompletion(p.data, resumes.length, !!s.phone),
      resumes: resumes.map(resumeDto),
      applications: apps.map((a) => ({ id: a.id, reference: a.reference, status: a.status, submittedAt: a.submitted_at, driveId: a.drive_id, company: a.company?.name, role: a.role })),
    });
  }));

  r.post('/students/:id/verify', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ fields: string[] }>(
      z.object({ fields: z.array(z.string().max(60)).min(1, 'Choose at least one field').max(20) }).strict(), req.body ?? {});
    const bad = body.fields.filter((f) => !VERIFIABLE.has(f));
    if (bad.length) throw new ApiError(400, 'VALIDATION_ERROR', `Cannot verify: ${bad.join(', ')}`, { fields: `Unknown fields: ${bad.join(', ')}` });
    await withTx(pool, async (c) => {
      const s = (await c.query(`SELECT id FROM users WHERE id=$1 AND tenant_id=$2 AND role='student' AND deleted_at IS NULL`, [pid(req), u.tenantId])).rows[0];
      if (!s) throw notFound('Student not found', 'STUDENT_NOT_FOUND');
      const p = await getProfileRow(c, s.id);
      const empty = body.fields.filter((f) => { const [a, b] = f.split('.'); const v = (p.data as any)[a]?.[b]; return v === undefined || v === null || v === ''; });
      if (empty.length) throw new ApiError(400, 'VALIDATION_ERROR', `Nothing to verify for: ${empty.join(', ')}`, { fields: `No value set for: ${empty.join(', ')}` });
      for (const f of body.fields) p.verification[f] = 'verified';
      await saveProfile(c, u.tenantId, s.id, p);
      await createNotification(c as any, u.tenantId, s.id, 'verification', 'Details verified', 'The placement cell verified some of your academic details.', { fields: body.fields });
    });
    res.json({ ok: true, verified: body.fields });
  }));

  // ---------------------------------------------------------------- dashboard
  r.get('/officer/dashboard', wrap(async (req, res) => {
    const u = me(req);
    const t = u.tenantId;
    const q = async (sql: string, p: unknown[] = [t]) => (await pool.query(sql, p)).rows[0];
    const open = await q(`SELECT count(*)::int n FROM drives WHERE tenant_id=$1 AND status='open' AND deadline > now()`);
    const closing = await q(
      `SELECT count(*)::int n FROM drives WHERE tenant_id=$1 AND status='open' AND deadline > now()
        AND (deadline AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`);
    const today = await q(
      `SELECT count(*)::int n FROM applications WHERE tenant_id=$1 AND (submitted_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`);
    const studs = (await pool.query(`SELECT p.data, p.verification FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [t])).rows;
    const pendingVerifications = studs.filter((s) => pendingVerificationFields(s.data, s.verification).length > 0).length;
    const upcoming = (await pool.query(
      `SELECT d.id, d.company, d.role, d.deadline, (SELECT count(*)::int FROM applications a WHERE a.drive_id=d.id AND a.status<>'withdrawn') AS applicants
         FROM drives d WHERE d.tenant_id=$1 AND d.status='open' AND d.deadline > now() ORDER BY d.deadline LIMIT 5`, [t])).rows;
    res.json({
      openDrives: open.n, closingToday: closing.n, applicationsToday: today.n, pendingVerifications,
      upcoming: upcoming.map((d) => ({ id: d.id, company: d.company?.name || '', role: d.role, deadline: new Date(d.deadline).toISOString(), applicants: d.applicants })),
    });
  }));

  // ---------------------------------------------------------------- announcements (create)
  r.post('/announcements', wrap(async (req, res) => {
    const u = me(req);
    const body = parse<{ title: string; body: string; driveId?: string }>(
      z.object({ title: textSchema(100, 1), body: textSchema(1000, 1), driveId: z.string().uuid().optional() }).strict(), req.body ?? {});
    const out = await withTx(pool, async (c) => {
      let audience: string[];
      let driveRow: any = null;
      if (body.driveId) {
        driveRow = (await c.query(`SELECT * FROM drives WHERE id=$1 AND tenant_id=$2 AND status <> 'draft'`, [body.driveId, u.tenantId])).rows[0];
        if (!driveRow) throw notFound('Drive not found', 'DRIVE_NOT_FOUND');
        const studs = (await c.query(`SELECT u.id, p.data, p.verification,
              EXISTS (SELECT 1 FROM applications a WHERE a.user_id=u.id AND a.drive_id=$2 AND a.status<>'withdrawn') AS applied
            FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.tenant_id=$1 AND u.role='student' AND u.deleted_at IS NULL`, [u.tenantId, body.driveId])).rows;
        audience = studs
          .filter((s) => s.applied || evaluateEligibility(driveRow.rules, { academics: s.data?.academics, verification: s.verification }).status !== 'not_eligible')
          .map((s) => s.id);
      } else {
        audience = (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND deleted_at IS NULL`, [u.tenantId])).rows.map((x) => x.id);
      }
      const a = (await c.query(
        `INSERT INTO announcements (tenant_id, author_id, drive_id, title, body, recipients) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [u.tenantId, u.id, body.driveId ?? null, body.title, body.body, audience.length])).rows[0];
      for (const id of audience) {
        await createNotification(c as any, u.tenantId, id, 'announcement', body.title, body.body, { announcementId: a.id, ...(body.driveId ? { driveId: body.driveId } : {}) });
      }
      return a;
    });
    res.status(201).json({ announcement: annDto(out) });
  }));

  return r;
}

function annDto(a: any) {
  return { id: a.id, title: a.title, body: a.body, driveId: a.drive_id, recipients: a.recipients, createdAt: new Date(a.created_at).toISOString() };
}

export function announcementReadRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps));
  r.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({ cursor: z.string().optional(), limit: z.string().optional() }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const rows = u.role === 'officer'
      ? (await pool.query(`SELECT * FROM announcements WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, [u.tenantId])).rows
      : (await pool.query(
          `SELECT a.* FROM announcements a WHERE a.tenant_id=$1 AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=$2 AND n.type='announcement' AND n.data->>'announcementId' = a.id::text)
            ORDER BY a.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, [u.tenantId, u.id])).rows;
    res.json({ items: rows.slice(0, limit).map(annDto), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));
  return r;
}
