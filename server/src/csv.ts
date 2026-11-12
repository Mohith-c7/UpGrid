/** CSV helpers. Output is RFC 4180 style (CRLF) and safe to open in spreadsheet software. */

/**
 * Neutralises spreadsheet formula injection: a cell starting with = + - @ (or tab / carriage return,
 * which some spreadsheet apps strip before evaluating) gets a single leading quote.
 */
export function csvSafe(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

export function csvCell(value: unknown): string {
  const s = csvSafe(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_BOM = '﻿';

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** "2026-11-07 14:30:00 IST" */
export function formatIstStamp(d: Date): string {
  const p = new Date(d.getTime() + 330 * 60000).toISOString(); // shift to IST, read as UTC fields
  return `${p.slice(0, 10)} ${p.slice(11, 19)} IST`;
}
