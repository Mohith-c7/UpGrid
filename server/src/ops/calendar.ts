import crypto from 'node:crypto';
import type { Db } from '../db';
import { evaluateEligibility } from '../eligibility';
import { columnsOf, tableExists } from './util';

export type CalKind = 'deadline' | 'test' | 'interview' | 'assessment' | 'offer_expiry' | 'drive_closing' | 'attendance';
export interface CalEvent {
  id: string; kind: CalKind; title: string; startsAt: string; endsAt: string | null; driveId: string | null; applicationId: string | null;
  refId: string; detail: string; link: string | null;
}
const iso = (d: any) => new Date(d).toISOString();
const pick = (cols: Set<string>, ...names: string[]) => names.find((n) => cols.has(n)) ?? null;
const safe = async <T>(fn: () => Promise<T[]>): Promise<T[]> => { try { return await fn(); } catch { return []; } };

export async function calendarEvents(db: Db, user: { id: string; tenantId: string; role: string }, from: Date, to: Date): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  const officer = user.role === 'officer';

  // ---- drive deadlines / closings
  const drives = (await db.query(
    `SELECT * FROM drives WHERE tenant_id=$1 AND status IN ('open','closed') AND deadline >= $2 AND deadline < $3 ORDER BY deadline`, [user.tenantId, from, to])).rows;
  if (officer) {
    for (const d of drives) out.push({ id: `drive-${d.id}`, kind: 'drive_closing', title: `${d.company?.name || 'Drive'} closes: ${d.role}`, startsAt: iso(d.deadline), endsAt: null, driveId: d.id, applicationId: null, refId: d.id, detail: 'Applications close', link: `/drives/${d.id}` });
  } else if (drives.length) {
    const prof = (await db.query('SELECT data, verification FROM profiles WHERE user_id=$1', [user.id])).rows[0];
    const applied = new Set((await db.query(`SELECT drive_id FROM applications WHERE user_id=$1 AND status<>'withdrawn'`, [user.id])).rows.map((x) => x.drive_id));
    for (const d of drives) {
      if (d.status !== 'open' || applied.has(d.id)) continue;
      if (evaluateEligibility(d.rules, { academics: prof?.data?.academics, verification: prof?.verification }).status === 'not_eligible') continue;
      out.push({ id: `deadline-${d.id}`, kind: 'deadline', title: `Apply by: ${d.company?.name || 'Drive'} - ${d.role}`, startsAt: iso(d.deadline), endsAt: null, driveId: d.id, applicationId: null, refId: d.id, detail: 'Application deadline', link: `/drives/${d.id}` });
    }
  }

  // ---- interviews / assessments (application_schedules)
  const sch = (await db.query(
    `SELECT s.*, a.user_id, a.drive_id, d.company, d.role FROM application_schedules s JOIN applications a ON a.id=s.application_id JOIN drives d ON d.id=a.drive_id
      WHERE s.tenant_id=$1 AND s.superseded_at IS NULL AND s.scheduled_at >= $2 AND s.scheduled_at < $3 ${officer ? '' : 'AND a.user_id=$4'} ORDER BY s.scheduled_at`,
    officer ? [user.tenantId, from, to] : [user.tenantId, from, to, user.id])).rows;
  for (const s of sch) {
    out.push({
      id: `sched-${s.id}`, kind: s.type, title: `${s.type === 'interview' ? 'Interview' : 'Assessment'}: ${s.company?.name || ''} - ${s.role}`,
      startsAt: iso(s.scheduled_at), endsAt: null, driveId: s.drive_id, applicationId: s.application_id, refId: s.id,
      detail: `${s.mode === 'online' ? 'Online' : 'In person'}: ${s.venue_or_link}`, link: `/applications/${s.application_id}`,
    });
  }

  // ---- other modules: probed defensively
  out.push(...await safe<CalEvent>(async () => {
    if (!(await tableExists(db, 'assessments'))) return [];
    const c = await columnsOf(db, 'assessments');
    const start = pick(c, 'starts_at', 'opens_at', 'start_at', 'scheduled_at', 'start_time');
    if (!start || !c.has('id') || !c.has('tenant_id')) return [];
    const end = pick(c, 'ends_at', 'closes_at', 'end_at', 'end_time');
    const title = pick(c, 'title', 'name');
    const where = [`t.tenant_id=$1`, `t.${start} >= $2`, `t.${start} < $3`];
    if (c.has('status')) where.push(`t.status IN ('published','scheduled','live','open')`);
    let join = '';
    if (!officer && (await tableExists(db, 'assessment_assignments'))) {
      const ac = await columnsOf(db, 'assessment_assignments');
      if (ac.has('assessment_id') && ac.has('user_id')) { join = 'JOIN assessment_assignments aa ON aa.assessment_id=t.id AND aa.user_id=$4'; }
    }
    const params: unknown[] = [user.tenantId, from, to]; if (join) params.push(user.id);
    const rows = (await db.query(`SELECT t.id, ${title ? `t.${title}` : `'Test'`} AS title, t.${start} AS s ${end ? `, t.${end} AS e` : ''} FROM assessments t ${join} WHERE ${where.join(' AND ')} ORDER BY 3`, params)).rows;
    return rows.map((t): CalEvent => ({ id: `test-${t.id}`, kind: 'test', title: `Test: ${t.title}`, startsAt: iso(t.s), endsAt: t.e ? iso(t.e) : null, driveId: null, applicationId: null, refId: t.id, detail: 'Scheduled test', link: `/tests/${t.id}` }));
  }));
  out.push(...await safe<CalEvent>(async () => {
    if (!(await tableExists(db, 'offers'))) return [];
    const c = await columnsOf(db, 'offers');
    if (!c.has('expires_at') || !c.has('application_id') || !c.has('tenant_id')) return [];
    const stat = c.has('status') ? `AND COALESCE(o.status,'issued') NOT IN ('accepted','declined','withdrawn','expired','revoked','offer_accepted','offer_declined')` : '';
    const rows = (await db.query(
      `SELECT o.id, o.expires_at, a.id AS app_id, a.drive_id, d.company, d.role FROM offers o JOIN applications a ON a.id=o.application_id JOIN drives d ON d.id=a.drive_id
        WHERE o.tenant_id=$1 AND o.expires_at >= $2 AND o.expires_at < $3 ${stat} ${officer ? '' : 'AND a.user_id=$4'} ORDER BY o.expires_at`,
      officer ? [user.tenantId, from, to] : [user.tenantId, from, to, user.id])).rows;
    return rows.map((o): CalEvent => ({ id: `offer-${o.id}`, kind: 'offer_expiry', title: `Offer expires: ${o.company?.name || ''} - ${o.role}`, startsAt: iso(o.expires_at), endsAt: null, driveId: o.drive_id, applicationId: o.app_id, refId: o.id, detail: 'Respond before this time', link: `/applications/${o.app_id}` }));
  }));
  if (officer) {
    out.push(...await safe<CalEvent>(async () => {
      if (!(await tableExists(db, 'attendance_sessions'))) return [];
      const c = await columnsOf(db, 'attendance_sessions');
      const start = pick(c, 'starts_at', 'start_at', 'scheduled_at', 'session_date');
      if (!start || !c.has('tenant_id') || !c.has('id')) return [];
      const title = pick(c, 'title', 'name');
      const end = pick(c, 'ends_at', 'end_at');
      const rows = (await db.query(`SELECT t.id, ${title ? `t.${title}` : `'Attendance'`} AS title, t.${start} AS s ${end ? `, t.${end} AS e` : ''} FROM attendance_sessions t WHERE t.tenant_id=$1 AND t.${start} >= $2 AND t.${start} < $3 ORDER BY 3`, [user.tenantId, from, to])).rows;
      return rows.map((t): CalEvent => ({ id: `att-${t.id}`, kind: 'attendance', title: `Attendance: ${t.title}`, startsAt: iso(t.s), endsAt: t.e ? iso(t.e) : null, driveId: null, applicationId: null, refId: t.id, detail: 'Attendance session', link: null }));
    }));
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------- ICS
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) { parts.push(cur); cur = ch; } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
export function buildIcs(events: CalEvent[], now: Date = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Placement OS//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Placement OS'];
  for (const e of events) {
    const start = new Date(e.startsAt);
    const end = e.endsAt ? new Date(e.endsAt) : new Date(start.getTime() + (e.kind === 'deadline' || e.kind === 'drive_closing' || e.kind === 'offer_expiry' ? 15 : 60) * 60000);
    lines.push('BEGIN:VEVENT', `UID:${e.id}@placement-os`, `DTSTAMP:${stamp(now.toISOString())}`, `DTSTART:${stamp(start.toISOString())}`, `DTEND:${stamp(end.toISOString())}`,
      `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.detail)}`, `CATEGORIES:${e.kind.toUpperCase()}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
