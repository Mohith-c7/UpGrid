import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { ApiError, unprocessable } from '../errors';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const EXTRACT_TIMEOUT_MS = 15_000;
export const MAX_RESUME_CHARS = 12_000;

/** Bytes of a stored upload. Implemented by the files module (R2); injected so tests and other modules can swap it. */
export interface StoredFile { bytes: Buffer; mime?: string; size?: number; etag?: string; ownerId?: string }
export interface FileStore {
  get(fileId: string, ctx: { userId: string; tenantId: string }): Promise<StoredFile | null>;
}
let store: FileStore | null = null;
export function setFileStore(s: FileStore | null) { store = s; }
export function getFileStore(): FileStore | null { return store; }

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new ApiError(422, 'RESUME_NOT_READABLE', 'Reading the resume file took too long. Paste the text instead.')), ms).unref?.())]);

export type FileKind = 'pdf' | 'docx';
export function sniff(bytes: Buffer): FileKind | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'docx'; // zip container; mammoth rejects non-docx zips
  return null;
}

export async function parseBytes(bytes: Buffer): Promise<string> {
  if (bytes.length > MAX_RESUME_BYTES) throw unprocessable('RESUME_TOO_LARGE', 'Resume file is larger than 5 MB');
  const kind = sniff(bytes);
  if (!kind) throw unprocessable('RESUME_UNSUPPORTED_TYPE', 'Only PDF and DOCX resumes can be read');
  try {
    if (kind === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(bytes) });
      try { return String((await parser.getText()).text || ''); } finally { await parser.destroy?.().catch?.(() => undefined); }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');
    return String((await mammoth.extractRawText({ buffer: bytes })).value || '');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw unprocessable('RESUME_NOT_READABLE', 'This file could not be read. Paste your resume text instead.');
  }
}

/**
 * Server-side text extraction for an uploaded resume. Owner-checked, size-capped, time-boxed, cached for 1 h.
 * Link resumes cannot be fetched: callers paste text instead.
 */
export async function extractResumeText(pool: Pool, fileId: string, ctx: { userId: string; tenantId: string }): Promise<string> {
  const fs = getFileStore();
  if (!fs) throw unprocessable('RESUME_NOT_READABLE', 'Resume files cannot be read on this server yet. Paste your resume text instead.');
  const f = await fs.get(fileId, ctx);
  if (!f || (f.ownerId && f.ownerId !== ctx.userId)) throw new ApiError(404, 'NOT_FOUND', 'Resume file not found');
  const size = f.size ?? f.bytes.length;
  if (size > MAX_RESUME_BYTES) throw unprocessable('RESUME_TOO_LARGE', 'Resume file is larger than 5 MB');
  const key = crypto.createHash('sha256').update(`resume_text|${ctx.userId}|${fileId}|${f.etag || ''}|${size}`).digest('hex');
  const hit = await pool.query('SELECT value FROM ai_cache WHERE key=$1 AND expires_at > now()', [key]);
  if (hit.rows[0]) return String(hit.rows[0].value.text);
  const text = (await withTimeout(parseBytes(f.bytes), EXTRACT_TIMEOUT_MS)).replace(/\r/g, '').trim();
  if (text.length < 30) throw unprocessable('RESUME_EMPTY', 'No readable text found (scanned image?). Paste your resume text instead.');
  await pool.query(
    `INSERT INTO ai_cache (key, tenant_id, user_id, feature, value, expires_at) VALUES ($1,$2,$3,'resume_text',$4, now() + interval '1 hour')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at`,
    [key, ctx.tenantId, ctx.userId, JSON.stringify({ text })]);
  return text;
}

/** Find the file id behind a saved resume row, if the files module attached one (column-agnostic). */
export async function fileIdForResume(pool: Pool, userId: string, resumeId: string): Promise<{ fileId: string | null; exists: boolean }> {
  const r = await pool.query('SELECT to_jsonb(r) AS row FROM resumes r WHERE id=$1 AND user_id=$2', [resumeId, userId]);
  if (!r.rows[0]) return { fileId: null, exists: false };
  const row = r.rows[0].row || {};
  return { fileId: (row.file_id || row.fileId || null) as string | null, exists: true };
}
