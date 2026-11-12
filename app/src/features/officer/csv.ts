/**
 * Small CSV toolkit for the academic data import.
 * parseCsv: RFC 4180 style (quotes, escaped quotes, commas/newlines inside quotes, CRLF/LF/CR, UTF-8 BOM, blank lines skipped).
 * parseStudentCsv: header aliases + per-row validation using src/lib/validation.ts.
 */
import type { StudentImportRow } from '../../api/types';
import {
  validateBacklogs, validateBatchYear, validateCgpa, validateEmail, validateGapYears, validatePercent, validateRegNo,
  validateSemester, validateText,
} from '../../lib/validation';

export const MAX_IMPORT_ROWS = 5000;
export const CHUNK_SIZE = 500;

/** Returns rows of cells. Never throws. */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let wasQuoted = false;
  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => {
    endCell();
    // skip rows that are entirely empty (blank lines)
    if (!row.every((c) => c.trim() === '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '' && !wasQuoted) { inQuotes = true; wasQuoted = true; }
    else if (c === ',') endCell();
    else if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else if (c === '\n') endRow();
    else cell += c;
  }
  if (cell !== '' || row.length > 0 || wasQuoted) endRow();
  return rows;
}

export function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

type Key = keyof StudentImportRow;
export const TEMPLATE_HEADERS: Key[] = [
  'registrationNumber', 'email', 'department', 'program', 'batchYear', 'semester', 'cgpa', 'cgpaScale',
  'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'gapYears',
];
export const TEMPLATE_CSV = toCsv([
  TEMPLATE_HEADERS as string[],
  ['21CS1001', 'student@example.com', 'CSE', 'B.Tech', '2026', '7', '8.25', '10', '91.5', '88', '0', '0'],
]);

const ALIASES: Record<Key, string[]> = {
  registrationNumber: ['registrationnumber', 'registrationno', 'regno', 'regnumber', 'registerno', 'registernumber', 'rollno', 'rollnumber', 'enrollmentno', 'enrollmentnumber', 'regid'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'mailid'],
  department: ['department', 'dept', 'branch', 'stream'],
  program: ['program', 'programme', 'course', 'degree'],
  batchYear: ['batchyear', 'batch', 'graduationyear', 'passoutyear', 'passingyear', 'yearofpassing', 'yop'],
  semester: ['semester', 'sem', 'currentsemester', 'currentsem'],
  cgpa: ['cgpa', 'gpa', 'currentcgpa'],
  cgpaScale: ['cgpascale', 'gpascale', 'scale', 'cgpaoutof', 'cgpamax'],
  tenthPercent: ['tenthpercent', 'tenthpercentage', 'tenth', '10th', '10thpercent', '10thpercentage', '10thmarks', '10thmark', 'class10', 'classx', 'sslc', 'x', '10'],
  twelfthPercent: ['twelfthpercent', 'twelfthpercentage', 'twelfth', '12th', '12thpercent', '12thpercentage', '12thmarks', '12thmark', 'class12', 'classxii', 'hsc', 'puc', 'plustwo', '12'],
  activeBacklogs: ['activebacklogs', 'activebacklog', 'backlogs', 'backlog', 'currentbacklogs', 'arrears', 'standingarrears'],
  gapYears: ['gapyears', 'gapyear', 'gap', 'educationgap', 'educationalgap', 'yeargap'],
};
const ALIAS_LOOKUP: Record<string, Key> = {};
(Object.keys(ALIASES) as Key[]).forEach((k) => ALIASES[k].forEach((a) => { ALIAS_LOOKUP[a] = k; }));

/** "10th %" -> "10th", "Reg. No" -> "regno", "CGPA (out of)" -> "cgpaoutof". Percent sign is dropped, so "10th %" == "10th". */
export function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function headerKey(h: string): Key | null {
  const n = normalizeHeader(h);
  if (!n) return null;
  return ALIAS_LOOKUP[n] ?? null;
}

export interface RowError { row: number; registrationNumber: string; messages: string[] }
export interface ParsedImport {
  /** Rows that passed client-side validation. `row` is the data row number (first row under the header = 1). */
  valid: { row: number; data: StudentImportRow }[];
  errors: RowError[];
  totalRows: number;
  /** Header cells we could not map (ignored). */
  ignoredHeaders: string[];
  /** Mapped columns in file order. */
  columns: Key[];
  /** Fatal problem with the file as a whole. */
  fileError: string | null;
}

const clean = (s: string | undefined) => (s ?? '').replace(/ /g, ' ').trim();
const stripPct = (s: string) => s.replace(/%$/, '').trim();

export function parseStudentCsv(text: string): ParsedImport {
  const out: ParsedImport = { valid: [], errors: [], totalRows: 0, ignoredHeaders: [], columns: [], fileError: null };
  const table = parseCsv(text);
  if (table.length === 0) { out.fileError = 'The file is empty.'; return out; }
  const header = table[0].map(clean);
  const keys: (Key | null)[] = header.map((h) => headerKey(h));
  const seen = new Set<Key>();
  const dupCols: string[] = [];
  keys.forEach((k, i) => {
    if (!k) { if (header[i]) out.ignoredHeaders.push(header[i]); return; }
    if (seen.has(k)) { dupCols.push(header[i]); keys[i] = null; return; }
    seen.add(k);
    out.columns.push(k);
  });
  out.ignoredHeaders.push(...dupCols.map((h) => `${h} (duplicate column)`));
  if (!seen.has('registrationNumber')) {
    out.fileError = 'No registration number column found. Add a column named "registrationNumber" (or "Reg No", "Roll No").';
    return out;
  }
  const body = table.slice(1);
  if (body.length === 0) { out.fileError = 'The file has a header but no student rows.'; return out; }
  if (body.length > MAX_IMPORT_ROWS) { out.fileError = `Too many rows (${body.length}). Split the file into parts of at most ${MAX_IMPORT_ROWS} rows.`; return out; }
  out.totalRows = body.length;

  const firstSeen = new Map<string, number>();
  body.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const raw: Partial<Record<Key, string>> = {};
    keys.forEach((k, i) => { if (k) raw[k] = clean(cells[i]); });
    const msgs: string[] = [];
    const data: Partial<StudentImportRow> = {};

    const reg = validateRegNo(raw.registrationNumber ?? '');
    let regLabel = raw.registrationNumber ?? '';
    if (!reg.ok) msgs.push(`Registration number: ${reg.error}`);
    else {
      data.registrationNumber = reg.value; regLabel = reg.value;
      const prev = firstSeen.get(reg.value);
      if (prev) msgs.push(`Registration number: duplicate of row ${prev}`); else firstSeen.set(reg.value, rowNo);
    }

    const has = (k: Key) => (raw[k] ?? '') !== '';
    if (has('email')) { const r = validateEmail(raw.email!); if (r.ok) data.email = r.value; else msgs.push(`Email: ${r.error}`); }
    if (has('department')) { const r = validateText(raw.department!, { max: 80 }); if (r.ok) data.department = r.value; else msgs.push(`Department: ${r.error}`); }
    if (has('program')) { const r = validateText(raw.program!, { max: 80 }); if (r.ok) data.program = r.value; else msgs.push(`Program: ${r.error}`); }
    if (has('batchYear')) { const r = validateBatchYear(raw.batchYear!); if (r.ok) data.batchYear = r.value; else msgs.push(`Batch year: ${r.error}`); }
    if (has('semester')) { const r = validateSemester(raw.semester!); if (r.ok) data.semester = r.value; else msgs.push(`Semester: ${r.error}`); }
    let scale = 10;
    if (has('cgpaScale')) {
      const s = raw.cgpaScale!;
      const n = Number(s);
      if (!/^\d+(\.\d+)?$/.test(s) || !(n > 0) || n > 100) msgs.push('CGPA scale: enter a positive number such as 10 or 4');
      else { data.cgpaScale = n; scale = n; }
    }
    if (has('cgpa')) { const r = validateCgpa(raw.cgpa!, scale); if (r.ok) data.cgpa = r.value; else msgs.push(`CGPA: ${r.error}`); }
    if (has('tenthPercent')) { const r = validatePercent(stripPct(raw.tenthPercent!), '10th percentage'); if (r.ok) data.tenthPercent = r.value; else msgs.push(`10th %: ${r.error}`); }
    if (has('twelfthPercent')) { const r = validatePercent(stripPct(raw.twelfthPercent!), '12th percentage'); if (r.ok) data.twelfthPercent = r.value; else msgs.push(`12th %: ${r.error}`); }
    if (has('activeBacklogs')) { const r = validateBacklogs(raw.activeBacklogs!); if (r.ok) data.activeBacklogs = r.value; else msgs.push(`Active backlogs: ${r.error}`); }
    if (has('gapYears')) { const r = validateGapYears(raw.gapYears!); if (r.ok) data.gapYears = r.value; else msgs.push(`Gap years: ${r.error}`); }

    if (msgs.length) out.errors.push({ row: rowNo, registrationNumber: regLabel, messages: msgs });
    else out.valid.push({ row: rowNo, data: data as StudentImportRow });
  });
  return out;
}

export function chunkRows<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
