import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../context';
import { ApiError, notFound, parse } from '../errors';
import { AiService } from '../ai/service';
import { aiUser, aiWrap, gate, nextCursor, onlyRoles, pageParams } from '../ai/http';
import { getConsent } from '../ai/consent';
import { buildStudentContext } from '../ai/context';
import { chatSystem, DRAFT_PREFIX, INTENTS, Intent, PERSONAL_INTENTS } from '../ai/prompts';
import { abuseCheck, cleanText, detectInjection, maskUnsupportedNumbers, stripMarkup } from '../ai/sanitize';

const chatBody = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  driveId: z.string().uuid().optional(),
  intent: z.enum(INTENTS).optional(),
}).strict();

const COVER_RE = /\b(cover (note|letter)|draft (an? |the )?(email|message|note)|write (an? )?(email|message) to)\b/i;
const MAX_HISTORY = 12;
const MAX_MESSAGES_PER_CONVERSATION = 200;

const msgDto = (m: any) => ({ id: m.id, role: m.role, content: m.content, draft: m.draft, createdAt: new Date(m.created_at).toISOString() });

export function aiChatRouter({ pool }: Deps) {
  const r = Router();
  const student = onlyRoles('student');
  const svc = new AiService(pool);

  r.post('/chat', student, gate, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const body = parse<z.infer<typeof chatBody>>(chatBody, req.body);
    const message = cleanText(body.message, 2000);
    if (!message) throw new ApiError(400, 'VALIDATION_ERROR', 'Message is empty', { message: 'Message is empty' });
    const stream = req.query.stream === '1' || req.query.stream === 'true' || /text\/event-stream/.test(String(req.headers.accept || ''));

    const abuse = abuseCheck(message);
    if (abuse) {
      await svc.logBlocked(user, 'chat', message, abuse);
      throw new ApiError(422, 'AI_REQUEST_REJECTED', 'I can\'t help with that request. Ask me about drives, eligibility, preparation or your applications.');
    }

    const consent = await getConsent(pool, user.id);
    const intent: Intent | null = body.intent ?? (COVER_RE.test(message) ? 'cover_note' : null);
    if (intent && PERSONAL_INTENTS.includes(intent) && !consent.granted) {
      throw new ApiError(403, 'AI_CONSENT_REQUIRED', 'Turn on AI assistance in your AI settings to use this feature. Your contact details are never shared with the AI.');
    }

    // conversation
    let convId = body.conversationId;
    let createdConv = false;
    let history: Array<{ role: string; content: string }> = [];
    if (convId) {
      const c = await pool.query('SELECT id FROM ai_conversations WHERE id=$1 AND user_id=$2', [convId, user.id]);
      if (!c.rows[0]) throw notFound('Conversation not found');
      const h = await pool.query('SELECT role, content FROM ai_messages WHERE conversation_id=$1 ORDER BY seq DESC LIMIT $2', [convId, MAX_HISTORY]);
      history = h.rows.reverse();
      const cnt = await pool.query('SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id=$1', [convId]);
      if (cnt.rows[0].n >= MAX_MESSAGES_PER_CONVERSATION) throw new ApiError(409, 'CONVERSATION_FULL', 'This conversation is full. Start a new chat.');
    }

    const ctx = await buildStudentContext(pool, user, { consented: consent.granted, driveId: body.driveId });
    const system = chatSystem(intent, ctx, consent.granted);
    const messages = [
      ...history.map((m) => ({ role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model', text: m.content.slice(0, 2000) })),
      { role: 'user' as const, text: message },
    ];
    const flags = detectInjection(message);

    if (!convId) {
      const c = await pool.query(`INSERT INTO ai_conversations (tenant_id, user_id, title) VALUES ($1,$2,$3) RETURNING id`, [user.tenantId, user.id, message.replace(/\s+/g, ' ').slice(0, 60)]);
      convId = c.rows[0].id as string;
      createdConv = true;
    }
    const conversationId = convId as string;
    const um = (await pool.query(`INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,'user',$3) RETURNING *`, [user.tenantId, conversationId, message])).rows[0];
    const undo = async () => {
      if (createdConv) await pool.query('DELETE FROM ai_conversations WHERE id=$1', [conversationId]);
      else await pool.query('DELETE FROM ai_messages WHERE id=$1', [um.id]);
    };

    const finalize = async (raw: string) => {
      let text = stripMarkup(raw).trim();
      const draft = intent === 'cover_note';
      if (draft) {
        text = maskUnsupportedNumbers(text, JSON.stringify(ctx.facts) + message + history.map((h) => h.content).join(' ')).text;
        if (!text.startsWith(DRAFT_PREFIX)) text = `${DRAFT_PREFIX}\n\n${text}`;
      }
      const am = (await pool.query(`INSERT INTO ai_messages (tenant_id, conversation_id, role, content, draft) VALUES ($1,$2,'assistant',$3,$4) RETURNING *`, [user.tenantId, conversationId, text, draft])).rows[0];
      const conv = (await pool.query('UPDATE ai_conversations SET updated_at=now() WHERE id=$1 RETURNING title', [conversationId])).rows[0];
      return { am, title: conv.title as string };
    };
    const base = { system, messages, feature: 'chat', user, maxOutputTokens: 900, temperature: 0.5, flags };

    if (!stream) {
      try {
        const out = await svc.call<string>(base);
        const { am, title } = await finalize(out.data);
        return res.json({
          conversationId, title, message: msgDto(am), userMessage: msgDto(um), contextUsed: ctx.used, consentRequired: !consent.granted,
          usage: out.usage, quota: out.quota,
        });
      } catch (e) { await undo(); throw e; }
    }

    // ---- SSE
    const ctl = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) ctl.abort(); });
    const gen = svc.stream({ ...base, signal: ctl.signal });
    let first: IteratorResult<string, any>;
    try {
      first = await gen.next(); // reserves quota + connects; failures here are plain JSON errors
    } catch (e) { await undo(); throw e; }
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    send('meta', { conversationId, userMessageId: um.id });
    try {
      let step = first;
      while (!step.done) {
        send('delta', { text: step.value });
        step = await gen.next();
      }
      const fin = step.value as { text: string; usage: unknown; quota: unknown };
      const { am, title } = await finalize(fin.text);
      send('done', { conversationId, title, message: msgDto(am), contextUsed: ctx.used, consentRequired: !consent.granted, usage: fin.usage, quota: fin.quota });
    } catch (e) {
      await undo().catch(() => undefined);
      const err = e instanceof ApiError ? e : new ApiError(502, 'AI_UPSTREAM_ERROR', 'The AI service is unavailable right now.');
      send('error', { code: err.code, message: err.message });
    } finally {
      finished = true;
      res.end();
    }
  }));

  r.get('/conversations', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const { offset, limit } = pageParams(req);
    const rows = (await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at, (SELECT count(*)::int FROM ai_messages m WHERE m.conversation_id=c.id) AS n
         FROM ai_conversations c WHERE c.user_id=$1 ORDER BY c.updated_at DESC LIMIT $2 OFFSET $3`, [user.id, limit + 1, offset])).rows;
    res.json({
      items: rows.slice(0, limit).map((c) => ({ id: c.id, title: c.title, createdAt: new Date(c.created_at).toISOString(), updatedAt: new Date(c.updated_at).toISOString(), messageCount: c.n })),
      nextCursor: nextCursor(offset, limit, rows.length),
    });
  }));

  r.get('/conversations/:id', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const c = (await pool.query('SELECT * FROM ai_conversations WHERE id=$1 AND user_id=$2', [req.params.id, user.id])).rows[0];
    if (!c) throw notFound('Conversation not found');
    const msgs = (await pool.query('SELECT * FROM ai_messages WHERE conversation_id=$1 ORDER BY seq', [c.id])).rows;
    res.json({
      conversation: { id: c.id, title: c.title, createdAt: new Date(c.created_at).toISOString(), updatedAt: new Date(c.updated_at).toISOString() },
      messages: msgs.map(msgDto),
    });
  }));

  r.delete('/conversations/:id', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const d = await pool.query('DELETE FROM ai_conversations WHERE id=$1 AND user_id=$2', [req.params.id, user.id]);
    if (!d.rowCount) throw notFound('Conversation not found');
    res.json({ deleted: true });
  }));

  r.get('/suggested-prompts', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const driveId = typeof req.query.driveId === 'string' ? req.query.driveId : null;
    const consent = await getConsent(pool, user.id);
    const ctx = await buildStudentContext(pool, user, { consented: consent.granted, driveId });
    const items: Array<{ id: string; label: string; prompt: string; intent: Intent }> = [];
    const drives = (ctx.facts.drives as any[]) || [];
    const focus = drives.find((d) => d.isFocus);
    if (focus) {
      items.push({ id: 'explain_jd', label: 'Explain this JD simply', prompt: `Explain the job description for ${focus.company} (${focus.role}) in simple words.`, intent: 'explain_jd' });
      if (consent.granted) items.push({ id: 'cover_note', label: 'Draft a cover note', prompt: `Draft a short cover note for ${focus.company}. I will review and edit it.`, intent: 'cover_note' });
    }
    const notEligible = drives.find((d) => d.eligibility?.status === 'not_eligible');
    if (notEligible) items.push({ id: 'why_not', label: `Why am I not eligible for ${notEligible.company}?`, prompt: `Why am I not eligible for ${notEligible.company} (${notEligible.role}) and what can I improve?`, intent: 'explain_eligibility' });
    if (consent.granted) {
      items.push({ id: 'suggest', label: 'Which drives fit me?', prompt: 'Which of the open drives fit me best right now?', intent: 'suggest_drives' });
      items.push({ id: 'plan', label: 'Plan my week', prompt: 'Build my preparation plan for this week.', intent: 'weekly_plan' });
      if (((ctx.facts.offers as any[]) || []).length >= 2) items.push({ id: 'offers', label: 'Compare my offers', prompt: 'Compare my offers side by side.', intent: 'compare_offers' });
    }
    items.push({ id: 'faq_process', label: 'How does placement work?', prompt: 'How does the placement process work, from applying to joining?', intent: 'faq' });
    items.push({ id: 'faq_prep', label: 'How should I prepare?', prompt: 'How should I prepare for campus interviews?', intent: 'faq' });
    res.json({ items: items.slice(0, 8) });
  }));

  return r;
}
