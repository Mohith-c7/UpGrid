import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, me, pid, requireRole } from '../context';
import { withTx } from '../db';
import { ApiError, conflict, notFound, parse, wrap } from '../errors';
import { insertQuestion, importRowToInput, MAX_IMPORT_ROWS, parseQuestion, questionColumns, rowsFromBody, toQuestion } from '../assessments/bank';
import { audit } from '../assessments/service';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

const USED = `(SELECT count(*)::int FROM assessment_questions aq WHERE aq.question_id = q.id) AS used_in`;

export function assessmentQuestionsRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps), requireRole('officer'));

  r.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = parse<any>(z.object({
      q: z.string().max(100).optional(), type: z.string().max(20).optional(), difficulty: z.string().max(10).optional(), topic: z.string().max(80).optional(),
      tag: z.string().max(40).optional(), status: z.enum(['active', 'archived', 'all']).default('active'), practice: z.enum(['1', '0', 'true', 'false']).optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }), req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId];
    let where = 'q.tenant_id=$1';
    const add = (sql: string, v: unknown) => { params.push(v); where += ` AND ${sql.replace('?', `$${params.length}`)}`; };
    if (q.status !== 'all') add('q.status = ?', q.status);
    if (q.q) {
      params.push(`%${q.q.replace(/[%_\\]/g, (m: string) => '\\' + m)}%`);
      where += ` AND (q.title ILIKE $${params.length} OR q.body ILIKE $${params.length})`;
    }
    if (q.type) add('q.type = ?', q.type);
    if (q.difficulty) add('q.difficulty = ?', q.difficulty);
    if (q.topic) add('lower(q.topic) = lower(?)', q.topic);
    if (q.tag) add('? = ANY(q.tags)', q.tag.toLowerCase());
    if (q.practice === '1' || q.practice === 'true') where += ' AND q.practice';
    const rows = (await pool.query(`SELECT q.*, ${USED} FROM aq_questions q WHERE ${where} ORDER BY q.created_at DESC, q.id LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    res.json({ items: rows.slice(0, limit).map((x) => toQuestion(x, { summary: true })), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  r.post('/import', wrap(async (req, res) => {
    const u = me(req);
    const rows = rowsFromBody(req.body);
    if (rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, 'VALIDATION_ERROR', `At most ${MAX_IMPORT_ROWS} rows per request`, { rows: `At most ${MAX_IMPORT_ROWS} rows per request` });
    const dryRun = req.body.dryRun === true;
    const errors: { row: number; fields: Record<string, string> }[] = [];
    const valid: any[] = [];
    rows.forEach((row, i) => {
      const out = importRowToInput(row);
      if (out.errors) errors.push({ row: i + 1, fields: out.errors }); else valid.push(out.input);
    });
    if (!dryRun && valid.length) {
      await withTx(pool, async (c) => {
        for (const q of valid) await insertQuestion(c, u.tenantId, u.id, q);
        await audit(c, u.tenantId, u.id, 'assessment.questions_imported', { count: valid.length });
      });
    }
    res.json({ total: rows.length, imported: dryRun ? 0 : valid.length, valid: valid.length, dryRun, errors });
  }));

  r.post('/', wrap(async (req, res) => {
    const u = me(req);
    const q = parseQuestion(req.body);
    const row = await insertQuestion(pool, u.tenantId, u.id, q);
    res.status(201).json({ question: toQuestion({ ...row, used_in: 0 }) });
  }));

  const load = async (tenantId: string, id: string) => {
    const row = (await pool.query(`SELECT q.*, ${USED} FROM aq_questions q WHERE q.id=$1 AND q.tenant_id=$2`, [id, tenantId])).rows[0];
    if (!row) throw notFound('Question not found', 'QUESTION_NOT_FOUND');
    return row;
  };

  r.get('/:id', wrap(async (req, res) => res.json({ question: toQuestion(await load(me(req).tenantId, pid(req))) })));

  r.put('/:id', wrap(async (req, res) => {
    const u = me(req);
    await load(u.tenantId, pid(req));
    const q = parseQuestion(req.body);
    const row = (await pool.query(
      `UPDATE aq_questions SET type=$3, title=$4, body=$5, topic=$6, tags=$7, difficulty=$8, marks=$9, negative_marks=$10, explanation=$11, options=$12, answer=$13, coding=$14, practice=$15, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 RETURNING *`, [pid(req), u.tenantId, ...questionColumns(q)])).rows[0];
    res.json({ question: toQuestion(await load(u.tenantId, row.id)) });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const u = me(req);
    const row = await load(u.tenantId, pid(req));
    if (row.used_in > 0) throw conflict('QUESTION_IN_USE', 'This question is used in an assessment. Archive it instead.');
    await pool.query('DELETE FROM aq_questions WHERE id=$1 AND tenant_id=$2', [row.id, u.tenantId]);
    res.status(204).end();
  }));

  for (const [path, status] of [['archive', 'archived'], ['unarchive', 'active']] as const) {
    r.post(`/:id/${path}`, wrap(async (req, res) => {
      const u = me(req);
      await load(u.tenantId, pid(req));
      await pool.query('UPDATE aq_questions SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2', [pid(req), u.tenantId, status]);
      res.json({ question: toQuestion(await load(u.tenantId, pid(req))) });
    }));
  }

  r.post('/:id/duplicate', wrap(async (req, res) => {
    const u = me(req);
    const src = await load(u.tenantId, pid(req));
    const copy = await insertQuestion(pool, u.tenantId, u.id, parseQuestion({
      type: src.type, title: `${src.title} (copy)`.slice(0, 200), body: src.body, topic: src.topic, tags: src.tags, difficulty: src.difficulty,
      marks: Number(src.marks), negativeMarks: Number(src.negative_marks), explanation: src.explanation, practice: false, options: src.options, answer: src.answer, coding: src.coding,
    }));
    res.status(201).json({ question: toQuestion({ ...copy, used_in: 0 }) });
  }));

  return r;
}
