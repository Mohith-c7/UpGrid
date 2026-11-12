const IST = 'Asia/Kolkata';

export function formatIST(iso?: string | null): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Not set';
  try {
    return (
      new Intl.DateTimeFormat('en-IN', {
        timeZone: IST, day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      }).format(d) + ' IST'
    );
  } catch {
    // Hermes without Intl timezone support: manual +05:30
    const t = new Date(d.getTime() + 330 * 60000);
    return `${t.getUTCDate()}/${t.getUTCMonth() + 1}/${t.getUTCFullYear()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} IST`;
  }
}

/** IST wall-clock parts <-> UTC ISO. IST is fixed +05:30, no DST. */
export interface ISTParts { y: number; m: number; d: number; hh: number; mm: number }

export function isoToISTParts(iso?: string | null): ISTParts | null {
  if (!iso) return null;
  const t = new Date(new Date(iso).getTime() + 330 * 60000);
  if (isNaN(t.getTime())) return null;
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

export function istPartsToISO(p: ISTParts): string {
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - 330 * 60000).toISOString();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function nowISTParts(offsetMs = 0): ISTParts {
  return isoToISTParts(new Date(Date.now() + offsetMs).toISOString())!;
}

export function lpa(v?: number | null): string {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return `₹${v.toFixed(2)} LPA`;
}

export function ctcSummary(c?: { providedStatus?: string; kind?: string; fixedLpa?: number | null; variableLpa?: number | null }): string {
  if (!c) return '—';
  if (c.kind === 'stipend_monthly') return c.fixedLpa != null ? `₹${Math.round(c.fixedLpa).toLocaleString('en-IN')}/month` : '—';
  const total = (c.fixedLpa ?? 0) + (c.variableLpa ?? 0);
  return c.fixedLpa == null ? '—' : lpa(total);
}

export const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', screening: 'Screening', assessment: 'Assessment', interview: 'Interview',
  selected: 'Selected', offer_issued: 'Offer issued', offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined', rejected: 'Rejected', withdrawn: 'Withdrawn', joined: 'Joined',
};

/** Client-side hint only; the server enforces the real rules. Used when API omits allowedNext. */
export const NEXT_STATUS: Record<string, string[]> = {
  submitted: ['screening', 'rejected'],
  screening: ['assessment', 'interview', 'selected', 'rejected'],
  assessment: ['interview', 'selected', 'rejected'],
  interview: ['selected', 'rejected'],
  selected: ['offer_issued', 'rejected'],
  offer_issued: ['offer_accepted', 'offer_declined'],
  offer_accepted: ['joined'],
};
