import type { Ctc } from '@/api/types';

/** Indian digit grouping (12,34,567) without depending on Intl support. */
export function groupIndian(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(0).split('.');
  let out: string;
  if (int.length <= 3) out = int;
  else {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}${out}${dec ? `.${dec}` : ''}`;
}

export function formatInr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `₹${groupIndian(Math.round(n))}`;
}

const trimNum = (n: number) => {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

export function formatLpa(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `₹${trimNum(n)} LPA`;
}

export function totalLpa(ctc: Ctc): number | null {
  if (typeof ctc.totalLpa === 'number') return ctc.totalLpa;
  if (typeof ctc.fixedLpa !== 'number') return null;
  return ctc.fixedLpa + (ctc.variableLpa ?? 0) + (ctc.bonusLpa ?? 0);
}

/** Headline compensation string for cards. */
export function formatCtc(ctc: Ctc | null | undefined): string {
  if (!ctc) return 'Compensation not provided';
  if (ctc.kind === 'stipend_monthly') {
    const v = typeof ctc.stipendMonthly === 'number' ? ctc.stipendMonthly : ctc.fixedLpa;
    return typeof v === 'number' && v > 0 ? `${formatInr(v)} / month` : 'Compensation not provided';
  }
  const t = totalLpa(ctc);
  if (t === null || t <= 0) return 'Compensation not provided';
  return formatLpa(t);
}

/* ---------- dates (IST, en-IN) ---------- */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  };
}

export function formatDateIST(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const p = istParts(ms);
  return `${p.day} ${MONTHS[p.m]} ${p.y}`;
}

export function formatTimeIST(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const p = istParts(ms);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.min).padStart(2, '0')} ${p.h >= 12 ? 'PM' : 'AM'}`;
}

export function formatDateTimeIST(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return `${formatDateIST(iso)}, ${formatTimeIST(iso)} IST`;
}

/** "2h 14m", "38 min", "45 s". Positive milliseconds only. */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 1) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m >= 1) return `${m} min`;
  return `${s} s`;
}

/** Relative deadline text; offsetMs = serverNow - deviceNow. */
export function relativeDeadline(iso: string | null | undefined, offsetMs = 0, nowMs: number = Date.now()): string {
  if (!iso) return '';
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return '';
  const diff = target - (nowMs + offsetMs);
  if (diff <= 0) return 'Closed';
  if (diff < 24 * 3600 * 1000) return `Closes in ${durationText(diff)}`;
  if (diff < 7 * 24 * 3600 * 1000) return `Closes in ${durationText(diff)}`;
  return `Closes ${formatDateIST(iso)}`;
}

export function isUrgent(iso: string | null | undefined, offsetMs = 0, nowMs: number = Date.now()): boolean {
  if (!iso) return false;
  const diff = Date.parse(iso) - (nowMs + offsetMs);
  return diff > 0 && diff < 3600 * 1000;
}

export function timeAgo(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = nowMs - t;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} h ago`;
  if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / 86400000)} d ago`;
  return formatDateIST(iso);
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
