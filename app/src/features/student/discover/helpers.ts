/** Small non-visual helpers shared by Home, Opportunities, Drive detail and Apply. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, errMessage } from '@/api/client';
import { useSaveDrive } from '@/api/hooks';
import { useToast } from '@/ui';
import { formatInr, formatLpa, totalLpa } from '@/lib/format';
import type { AppStatus, Completion, Ctc, DriveSummary, EligibilityStatus } from '@/api/types';

/* ------------------------------------------------------------- time */
/** Server-corrected "now" (ms). Re-computed every `everyMs`; stable between ticks so lists can use it in extraData. */
export function useNow(offsetMs: number, everyMs = 30000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return useMemo(() => Date.now() + offsetMs, [tick, offsetMs]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function isOfflineError(e: unknown): boolean {
  return e instanceof ApiError && e.isNetwork;
}
export function friendlyError(e: unknown): string {
  return isOfflineError(e) ? "You're offline or the server can't be reached. Check your connection and try again." : errMessage(e);
}

export function isDriveClosed(d: { status: string; deadline: string }, serverNowMs: number): boolean {
  return d.status === 'closed' || d.status === 'draft' || Date.parse(d.deadline) <= serverNowMs;
}

/* ------------------------------------------------------- bookmarks */
/** Optimistic bookmark toggle: the UI flips immediately and rolls back (with a toast) if the request fails. */
export function useSaveToggle() {
  const save = useSaveDrive();
  const toast = useToast();
  const mutateRef = useRef(save.mutateAsync);
  mutateRef.current = save.mutateAsync;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const inflight = useRef<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isSaved = useCallback((id: string, server: boolean) => (id in overrides ? overrides[id] : server), [overrides]);

  const toggle = useCallback(async (id: string, current: boolean) => {
    if (inflight.current.has(id)) return;
    inflight.current.add(id);
    const next = !current;
    setOverrides((o) => ({ ...o, [id]: next }));
    try {
      await mutateRef.current({ id, saved: next });
      // the mutation has already refetched the lists, so the server value is current: drop the local override
      // (a stale override would hide a later change made on another screen, e.g. un-saving from drive detail)
      setOverrides((o) => {
        const c = { ...o };
        delete c[id];
        return c;
      });
      toastRef.current.show(next ? 'Saved. This is a bookmark, not an application.' : 'Removed from saved', 'info');
    } catch (e) {
      setOverrides((o) => {
        const c = { ...o };
        delete c[id];
        return c;
      });
      toastRef.current.show(`Could not update saved drives. ${friendlyError(e)}`, 'error');
    } finally {
      inflight.current.delete(id);
    }
  }, []);

  return { isSaved, toggle, overrides };
}

/* ----------------------------------------------------- profile links */
const ROUTES: [RegExp, string][] = [
  [/resume|cv/i, '/(student)/profile/resumes'],
  [/link|linkedin|github|portfolio/i, '/(student)/profile/links'],
  [/registration|identity|name|city|state|contact|skill|preference|phone/i, '/(student)/profile/edit-identity'],
];
export function profileRouteFor(key?: string | null): string {
  if (!key) return '/(student)/(tabs)/profile';
  for (const [re, path] of ROUTES) if (re.test(key)) return path;
  return '/(student)/profile/edit-academics';
}

/** The server may send nextStep as an item object or a plain string; normalise to one step. */
export function nextStepOf(c?: Completion | null): { key: string | null; label: string; why: string | null } | null {
  const ns = (c as unknown as { nextStep?: unknown } | null | undefined)?.nextStep;
  if (!ns) return null;
  if (typeof ns === 'string') {
    const hit = c?.items?.find((i) => i.label === ns || i.key === ns);
    return { key: hit?.key ?? ns, label: hit?.label ?? ns, why: hit?.why ?? null };
  }
  const o = ns as { key?: string; label?: string; why?: string };
  return { key: o.key ?? null, label: o.label ?? 'Complete your profile', why: o.why ?? null };
}

/* ------------------------------------------------------- compensation */
const trim2 = (n: number) => String(Math.round(n * 100) / 100);

export interface CompView {
  kind: 'annual' | 'stipend';
  headline: string;            // "₹12 LPA" or "₹25,000 per month stipend"
  unitNote: string;            // "LPA = lakh rupees per annum (CTC)" / "Stipend is paid monthly, not annually"
  parts: { label: string; value: string }[];
  breakdownNote: string | null;
}
export function compView(ctc: Ctc): CompView {
  if (ctc.kind === 'stipend_monthly') {
    const v = typeof ctc.stipendMonthly === 'number' ? ctc.stipendMonthly : ctc.fixedLpa;
    const has = typeof v === 'number' && v > 0;
    return {
      kind: 'stipend',
      headline: has ? `${formatInr(v)} per month stipend` : 'Stipend not provided',
      unitNote: 'Paid monthly as a stipend. This is not an annual package (LPA).',
      parts: [],
      breakdownNote: null,
    };
  }
  const total = totalLpa(ctc);
  const parts: { label: string; value: string }[] = [];
  if (ctc.breakdownProvided) {
    if (typeof ctc.fixedLpa === 'number') parts.push({ label: 'Fixed', value: formatLpa(ctc.fixedLpa) });
    if (typeof ctc.variableLpa === 'number') parts.push({ label: 'Variable', value: formatLpa(ctc.variableLpa) });
    if (typeof ctc.bonusLpa === 'number') parts.push({ label: 'Bonus', value: formatLpa(ctc.bonusLpa) });
    if (ctc.esopNote) parts.push({ label: 'ESOP', value: ctc.esopNote });
  } else if (ctc.esopNote) {
    parts.push({ label: 'ESOP', value: ctc.esopNote });
  }
  return {
    kind: 'annual',
    headline: total !== null && total > 0 ? `₹${trim2(total)} LPA` : 'Package not provided',
    unitNote: 'LPA = lakh rupees per annum (yearly CTC).',
    parts,
    breakdownNote: ctc.breakdownProvided ? null : 'Breakdown not provided',
  };
}

/* ------------------------------------------------------------ labels */
export function eligibilityMeta(s: EligibilityStatus): { label: string; tone: 'success' | 'warning' | 'error' } {
  if (s === 'eligible') return { label: 'Eligible', tone: 'success' };
  if (s === 'pending') return { label: 'Check profile', tone: 'warning' };
  if (s === 'restricted') return { label: 'Restricted', tone: 'warning' };
  return { label: 'Not eligible', tone: 'error' };
}

export function appStatusMeta(s: AppStatus): { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  switch (s) {
    case 'submitted': return { label: 'Submitted', tone: 'info' };
    case 'screening': return { label: 'Screening', tone: 'info' };
    case 'assessment': return { label: 'Assessment', tone: 'info' };
    case 'interview': return { label: 'Interview', tone: 'info' };
    case 'selected': return { label: 'Selected', tone: 'success' };
    case 'offer_issued': return { label: 'Offer issued', tone: 'success' };
    case 'offer_accepted': return { label: 'Offer accepted', tone: 'success' };
    case 'offer_declined': return { label: 'Offer declined', tone: 'neutral' };
    case 'rejected': return { label: 'Not selected', tone: 'error' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'neutral' };
    case 'joined': return { label: 'Joined', tone: 'success' };
    default: return { label: String(s), tone: 'neutral' };
  }
}

export function modeKey(m?: string | null): string {
  return (m ?? '').toLowerCase().replace(/[^a-z]/g, '');
}
export function modeLabel(m?: string | null): string {
  const k = modeKey(m);
  if (k === 'remote') return 'Remote';
  if (k === 'hybrid') return 'Hybrid';
  if (k === 'onsite' || k === 'inoffice') return 'On-site';
  return m ?? '';
}

export function driveMetaLine(d: Pick<DriveSummary, 'workMode' | 'locations'>): string {
  const parts: string[] = [];
  const m = modeLabel(d.workMode);
  if (m) parts.push(m);
  if (d.locations?.length) parts.push(d.locations.slice(0, 2).join(', ') + (d.locations.length > 2 ? ` +${d.locations.length - 2}` : ''));
  return parts.join(' · ');
}
