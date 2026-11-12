import { z } from 'zod';
import type { Db } from '../db';
import { ApiError, badRequest, unprocessable, zodFields } from '../errors';
import { parseCsv } from './csvParse';
import { OPTION_IDS, questionInput, validateQuestionShape, type QuestionInput } from './schemas';

export const num = (v: any) => (v === null || v === undefined ? v : Number(v));

export function toQuestion(r: any, opt: { summary?: boolean; usedIn?: number } = {}) {
  const coding = r.coding
    ? opt.summary
      ? {
          constraints: r.coding.constraints, languages: r.coding.languages, timeLimitMs: r.coding.timeLimitMs, memoryLimitMb: r.coding.memoryLimitMb,
          compare: r.coding.compare, starterCode: r.coding.starterCode,
          testCaseCounts: {
            sample: r.coding.testCases.filter((t: any) => t.kind === 'sample').length,
            hidden: r.coding.testCases.filter((t: any) => t.kind === 'hidden').length,
          },
        }
      : r.coding
    : null;
  return {
    id: r.id, type: r.type, title: r.title, body: r.body, topic: r.topic, tags: r.tags, difficulty: r.difficulty,
    marks: num(r.marks), negativeMarks: num(r.negative_marks), explanation: r.explanation, practice: r.practice, status: r.status,
    options: r.options, answer: opt.summary ? undefined : r.answer, coding,
    usedIn: opt.usedIn ?? (r.used_in !== undefined ? Number(r.used_in) : undefined),
    createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Validates a question payload; throws 400 with `fields`. Test case ids are assigned/deduplicated. */
export function parseQuestion(body: unknown): QuestionInput {
  const r = questionInput.safeParse(body ?? {});
  if (!r.success) {
    const fields = zodFields(r.error);
    throw new ApiError(400, 'VALIDATION_ERROR', String(Object.values(fields)[0] ?? 'Invalid request'), fields);
  }
  const q = r.data;
  if (q.coding) {
    const seen = new Set<string>();
    q.coding.testCases.forEach((t, i) => {
      let id = t.id ?? `t${i + 1}`;
      while (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      t.id = id;
    });
    q.coding.testCases.forEach((t) => { if (t.kind === 'hidden') delete t.explanation; });
  }
  const f = validateQuestionShape(q);
  if (Object.keys(f).length) throw badRequest(String(Object.values(f)[0]), f);
  if (q.practice && q.type !== 'coding') throw badRequest('Only coding questions can be practice problems', { practice: 'Only coding questions can be practice problems' });
  if (q.practice && q.type === 'coding') {
    const tc = q.coding!.testCases;
    if (!tc.some((t) => t.kind === 'sample') || tc.filter((t) => t.kind === 'hidden').length < 2) {
      throw unprocessable('NOT_PRACTICE_READY', 'Practice problems need at least 1 sample and 2 hidden test cases', { 'coding.testCases': 'Need at least 1 sample and 2 hidden test cases' });
    }
  }
  return q;
}

export const questionColumns = (q: QuestionInput) => [
  q.type, q.title, q.body, q.topic, q.tags.map((t) => t.toLowerCase()), q.difficulty, q.marks, q.negativeMarks, q.explanation,
  JSON.stringify(q.options), JSON.stringify(q.answer), q.coding ? JSON.stringify(q.coding) : null, q.practice,
];

export async function insertQuestion(db: Db, tenantId: string, userId: string, q: QuestionInput) {
  const r = await db.query(
    `INSERT INTO aq_questions (tenant_id, created_by, type, title, body, topic, tags, difficulty, marks, negative_marks, explanation, options, answer, coding, practice)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [tenantId, userId, ...questionColumns(q)],
  );
  return r.rows[0];
}

// ------------------------------------------------------------------ bulk import
export const MAX_IMPORT_ROWS = 200;
const LETTERS = 'ABCDEFGH';

/** Converts a flat import row to the canonical question payload (or returns field errors). */
export function importRowToInput(row: Record<string, any>): { input?: QuestionInput; errors?: Record<string, string> } {
  const g = (k: string) => {
    const key = Object.keys(row).find((x) => x.toLowerCase() === k.toLowerCase());
    const v = key === undefined ? undefined : row[key];
    return typeof v === 'string' ? v.trim() : v;
  };
  const errors: Record<string, string> = {};
  const type = (g('type') || 'mcq_single') as string;
  if (type !== 'mcq_single' && type !== 'mcq_multi') errors.type = 'Import supports mcq_single and mcq_multi only';
  let texts: string[] = [];
  const arr = g('options');
  if (Array.isArray(arr)) texts = arr.map((x) => String(x ?? '').trim());
  else {
    for (const L of LETTERS) {
      const v = g(`option${L}`);
      if (v !== undefined && v !== null && String(v).trim() !== '') texts.push(String(v).trim());
      else if (v === undefined || v === '') { /* gap ends the options */ if (texts.length >= 2) break; }
    }
  }
  const options = texts.map((t, i) => ({ id: OPTION_IDS[i], text: t })).slice(0, 8);
  const correctRaw = g('correct');
  const correctList = (Array.isArray(correctRaw) ? correctRaw.map(String) : String(correctRaw ?? '').split(/[;,|\s]+/))
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!correctList.length) errors.correct = 'Provide the correct option letter(s), e.g. B or A;C';
  else if (correctList.some((c) => !/^[a-h]$/.test(c) || c.charCodeAt(0) - 97 >= options.length)) errors.correct = 'Correct must reference existing options (A-H)';
  else if (type === 'mcq_single' && correctList.length !== 1) errors.correct = 'mcq_single needs exactly one correct option';
  const tagsRaw = g('tags');
  const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String) : String(tagsRaw ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  const numOr = (k: string, d: number) => {
    const v = g(k);
    if (v === undefined || v === null || v === '') return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const title = String(g('title') ?? '');
  const candidate = {
    type, title, body: g('body') ? String(g('body')) : title, topic: String(g('topic') ?? ''), tags,
    difficulty: String(g('difficulty') || 'medium').toLowerCase(), marks: numOr('marks', 1), negativeMarks: numOr('negativeMarks', 0),
    explanation: String(g('explanation') ?? ''), options,
    answer: { correct: type === 'mcq_multi' ? correctList : correctList[0] },
  };
  const parsed = z.safeParse(questionInput, candidate);
  if (!parsed.success) {
    for (const [k, v] of Object.entries(zodFields(parsed.error))) errors[k.replace(/^answer\.correct$/, 'correct').replace(/^negativeMarks$/, 'negativeMarks')] = v;
  }
  if (Object.keys(errors).length) return { errors };
  const f = validateQuestionShape(parsed.data!);
  if (Object.keys(f).length) return { errors: Object.fromEntries(Object.entries(f).map(([k, v]) => [k === 'answer.correct' ? 'correct' : k, v])) };
  return { input: parsed.data };
}

export function rowsFromBody(body: any): Record<string, any>[] {
  if (!body || typeof body !== 'object') throw badRequest('Body must be an object');
  if (body.format === 'csv') {
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw badRequest('csv is required', { csv: 'csv is required' });
    const table = parseCsv(body.csv);
    if (table.length < 2) throw badRequest('CSV needs a header row and at least one data row', { csv: 'No data rows' });
    const header = table[0].map((h) => h.trim());
    return table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
  }
  if (body.format === 'json') {
    if (!Array.isArray(body.rows) || body.rows.length === 0) throw badRequest('rows must be a non-empty array', { rows: 'rows must be a non-empty array' });
    if (body.rows.some((r: any) => !r || typeof r !== 'object' || Array.isArray(r))) throw badRequest('Each row must be an object', { rows: 'Each row must be an object' });
    return body.rows;
  }
  throw badRequest('format must be json or csv', { format: 'format must be json or csv' });
}
