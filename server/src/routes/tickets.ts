import { Router } from 'express';
import { z } from 'zod';
import { authenticate, Deps, denyRecruiter, me, pid } from '../context';
import { withTx } from '../db';
import { ApiError, notFound, unprocessable, wrap } from '../errors';
import { createNotification } from '../notify';
import { dispatchMail, MailJob, userMailJob } from '../mail';
import { cleanMultiline, cleanString } from '../validation';
import { decodeCursor, encodeCursor, pageLimit } from './drives';

export const TICKET_CATEGORIES = ['profile', 'eligibility', 'application', 'document', 'other'] as const;
export const TICKET_STATUSES = ['open', 'resolved'] as const;
export const TICKET_RATE_LIMIT = { max: 5, windowMinutes: 60 };
/** an identical ticket from the same student inside this window is treated as a double-submit */
export const DUPLICATE_WINDOW_SECONDS = 60;

const iso = (d: unknown) => new Date(d as any).toISOString();

function ticketDto(t: any) {
  return {
    id: t.id, category: t.category, subject: t.subject, status: t.status,
    createdAt: iso(t.created_at), updatedAt: iso(t.updated_at), resolvedAt: t.resolved_at ? iso(t.resolved_at) : null,
    student: { id: t.user_id, name: t.student_name },
    messageCount: t.message_count ?? undefined,
    lastMessagePreview: t.last_preview ?? undefined,
  };
}
const messageDto = (m: any) => ({
  id: m.id, author: { id: m.author_id, name: m.author_name, role: m.author_role }, message: m.message, createdAt: iso(m.created_at),
});

const TICKET_SELECT = `SELECT t.*, u.name AS student_name,
    (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id=t.id) AS message_count,
    (SELECT left(m.message, 120) FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.seq DESC LIMIT 1) AS last_preview
  FROM tickets t JOIN users u ON u.id=t.user_id`;

function bodyObject(b: unknown, allowed: string[]): Record<string, any> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send a JSON object', { _: 'Send a JSON object' });
  const fields: Record<string, string> = {};
  for (const k of Object.keys(b)) if (!allowed.includes(k)) fields[k] = 'Unknown field';
  if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown field: ${Object.keys(fields)[0]}`, fields);
  return b as Record<string, any>;
}
const fail = (fields: Record<string, string>) => new ApiError(400, 'VALIDATION_ERROR', Object.values(fields)[0], fields);

export function validateTicketMessage(raw: unknown) {
  return cleanMultiline(raw, 5, 2000, 'Message');
}
export function validateTicketSubject(raw: unknown) {
  const r = cleanString(raw, 120);
  if (r.ok && r.value.length < 3) return { ok: false as const, message: 'Subject must be at least 3 characters' };
  return r;
}

export function ticketRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps), denyRecruiter);

  async function loadTicket(db: any, tenantId: string, id: string, user: { id: string; role: string }, lock = false) {
    const row = (await db.query(`${TICKET_SELECT} WHERE t.id=$1 AND t.tenant_id=$2 ${lock ? 'FOR UPDATE OF t' : ''}`, [id, tenantId])).rows[0];
    // students only ever see their own tickets; hide existence otherwise
    if (!row || (user.role === 'student' && row.user_id !== user.id)) throw notFound('Ticket not found', 'TICKET_NOT_FOUND');
    return row;
  }

  r.post('/', wrap(async (req, res) => {
    const u = me(req);
    if (u.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'Only students can raise support tickets');
    const body = bodyObject(req.body, ['category', 'subject', 'message']);
    const fields: Record<string, string> = {};
    if (!(TICKET_CATEGORIES as readonly string[]).includes(body.category)) fields.category = `Category must be one of ${TICKET_CATEGORIES.join(', ')}`;
    const subject = validateTicketSubject(body.subject);
    if (!subject.ok) fields.subject = subject.message;
    const message = validateTicketMessage(body.message);
    if (!message.ok) fields.message = message.message;
    if (Object.keys(fields).length) throw fail(fields);

    const out = await withTx(pool, async (c) => {
      // serialise one student's submissions so the duplicate check and the 5/hour count cannot race
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ticket-create:${u.id}`]);
      const dup = (
        await c.query(
          `SELECT t.id FROM tickets t JOIN ticket_messages m ON m.ticket_id=t.id
            WHERE t.user_id=$1 AND t.category=$2 AND lower(t.subject)=lower($3) AND t.created_at > now() - ($5 || ' seconds')::interval
              AND m.seq = (SELECT min(seq) FROM ticket_messages WHERE ticket_id=t.id) AND m.message=$4
            ORDER BY t.created_at DESC LIMIT 1`,
          [u.id, body.category, (subject as any).value, (message as any).value, String(DUPLICATE_WINDOW_SECONDS)],
        )
      ).rows[0];
      if (dup) return { replayed: true as const, id: dup.id as string };

      const recent = (
        await c.query(
          `SELECT count(*)::int AS n, extract(epoch FROM (min(created_at) + ($2 || ' minutes')::interval - now()))::int AS retry
             FROM tickets WHERE user_id=$1 AND created_at > now() - ($2 || ' minutes')::interval`,
          [u.id, String(TICKET_RATE_LIMIT.windowMinutes)],
        )
      ).rows[0];
      if (recent.n >= TICKET_RATE_LIMIT.max) return { limited: true as const, retry: Math.max(1, recent.retry || 1) };

      const t = (
        await c.query(`INSERT INTO tickets (tenant_id, user_id, category, subject) VALUES ($1,$2,$3,$4) RETURNING id`, [u.tenantId, u.id, body.category, (subject as any).value])
      ).rows[0];
      await c.query(`INSERT INTO ticket_messages (tenant_id, ticket_id, author_id, message) VALUES ($1,$2,$3,$4)`, [u.tenantId, t.id, u.id, (message as any).value]);
      const officers = (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='officer' AND deleted_at IS NULL`, [u.tenantId])).rows;
      for (const o of officers) {
        await createNotification(c as any, u.tenantId, o.id, 'ticket', `New support ticket: ${(subject as any).value}`,
          `${u.name}: ${(message as any).value.slice(0, 140)}`, { ticketId: t.id, category: body.category });
      }
      return { replayed: false as const, id: t.id as string };
    });

    if ('limited' in out) {
      res.set('Retry-After', String(out.retry));
      throw new ApiError(429, 'RATE_LIMITED', `You can raise up to ${TICKET_RATE_LIMIT.max} tickets per hour. Please try again later.`);
    }
    const ticket = await loadTicket(pool, u.tenantId, out.id, u);
    res.status(out.replayed ? 200 : 201).json({ ticket: ticketDto(ticket), ...(out.replayed ? { replayed: true } : {}) });
  }));

  r.get('/', wrap(async (req, res) => {
    const u = me(req);
    const q = z.object({
      status: z.enum(TICKET_STATUSES, { message: 'Status must be open or resolved' }).optional(),
      cursor: z.string().optional(), limit: z.string().optional(),
    }).parse(req.query);
    const limit = pageLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const params: unknown[] = [u.tenantId];
    let where = 't.tenant_id=$1';
    if (u.role === 'student') { params.push(u.id); where += ` AND t.user_id=$${params.length}`; }
    if (q.status) { params.push(q.status); where += ` AND t.status=$${params.length}`; }
    const rows = (await pool.query(`${TICKET_SELECT} WHERE ${where} ORDER BY t.updated_at DESC, t.id LIMIT ${limit + 1} OFFSET ${offset}`, params)).rows;
    res.json({ items: rows.slice(0, limit).map(ticketDto), nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null });
  }));

  r.get('/:id', wrap(async (req, res) => {
    const u = me(req);
    const t = await loadTicket(pool, u.tenantId, pid(req), u);
    const msgs = (
      await pool.query(
        `SELECT m.id, m.author_id, m.message, m.created_at, a.name AS author_name, a.role AS author_role
           FROM ticket_messages m JOIN users a ON a.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.seq`,
        [t.id],
      )
    ).rows;
    res.json({ ticket: ticketDto(t), messages: msgs.map(messageDto) });
  }));

  r.post('/:id/messages', wrap(async (req, res) => {
    const u = me(req);
    const body = bodyObject(req.body, ['message']);
    const message = validateTicketMessage(body.message);
    if (!message.ok) throw fail({ message: message.message });
    const mails: MailJob[] = [];
    const out = await withTx(pool, async (c) => {
      const t = await loadTicket(c, u.tenantId, pid(req), u, true);
      if (t.status === 'resolved') throw unprocessable('TICKET_RESOLVED', 'This ticket is resolved. Reopen it to add a message.');
      const m = (
        await c.query(`INSERT INTO ticket_messages (tenant_id, ticket_id, author_id, message) VALUES ($1,$2,$3,$4) RETURNING id, author_id, message, created_at`,
          [u.tenantId, t.id, u.id, (message as any).value])
      ).rows[0];
      await c.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [t.id]);
      const recipients = u.role === 'student'
        ? (await c.query(`SELECT id FROM users WHERE tenant_id=$1 AND role='officer' AND deleted_at IS NULL`, [u.tenantId])).rows
        : (await c.query(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [t.user_id])).rows;
      for (const rcp of recipients) {
        if (rcp.id === u.id) continue;
        await createNotification(c as any, u.tenantId, rcp.id, 'ticket_message', `New reply on: ${t.subject}`,
          `${u.name}: ${(message as any).value.slice(0, 140)}`, { ticketId: t.id });
        mails.push(await userMailJob(c as any, u.tenantId, rcp.id, 'ticket_reply', { subject: t.subject, authorName: u.name, message: (message as any).value }) as MailJob);
      }
      return { ...m, author_name: u.name, author_role: u.role };
    });
    dispatchMail(mails); // best effort, after commit
    res.status(201).json({ message: messageDto(out) });
  }));

  r.post('/:id/status', wrap(async (req, res) => {
    const u = me(req);
    const body = bodyObject(req.body, ['status']);
    if (!(TICKET_STATUSES as readonly string[]).includes(body.status)) throw fail({ status: 'Status must be open or resolved' });
    const out = await withTx(pool, async (c) => {
      const t = await loadTicket(c, u.tenantId, pid(req), u, true);
      if (t.status !== body.status) {
        await c.query(`UPDATE tickets SET status=$2, updated_at=now(), resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END WHERE id=$1`, [t.id, body.status]);
      }
      return loadTicket(c, u.tenantId, t.id, u);
    });
    res.json({ ticket: ticketDto(out) });
  }));

  return r;
}
