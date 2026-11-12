import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../context';
import { authenticate } from '../context';
import { parse } from '../errors';
import { registerFeatureFlags } from '../features';
import { aiAvailable, currentAiConfig } from '../ai/config';
import { getConsent, setConsent } from '../ai/consent';
import { getQuota } from '../ai/service';
import { aiUser, aiWrap, onlyRoles } from '../ai/http';
import { aiChatRouter } from './aiChat';
import { aiResumeRouter } from './aiResume';
import { aiMockRouter } from './aiMock';
import { aiStaffRouter } from './aiStaff';

// GET /config merges this into `features` (true only when configured AND not killed via AI_ENABLED=false)
registerFeatureFlags(() => ({ ai: aiAvailable() }));

export function aiRouter(deps: Deps) {
  const { pool } = deps;
  const r = Router();
  r.use(authenticate(deps));
  const student = onlyRoles('student');

  r.get('/status', aiWrap(async (req, res) => {
    const user = aiUser(req);
    const cfg = currentAiConfig();
    const consent = await getConsent(pool, user.id);
    res.json({
      enabled: cfg.enabled, configured: cfg.configured, available: cfg.enabled && cfg.configured, model: cfg.model,
      quota: await getQuota(pool, user),
      consent: { required: user.role === 'student', granted: consent.granted, grantedAt: consent.grantedAt, version: consent.version },
    });
  }));

  r.get('/consent', student, aiWrap(async (req, res) => res.json(await getConsent(pool, aiUser(req).id))));
  r.put('/consent', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const b = parse<{ granted: boolean; deleteData?: boolean }>(z.object({ granted: z.boolean(), deleteData: z.boolean().optional() }).strict(), req.body);
    const state = await setConsent(pool, user.tenantId, user.id, b.granted);
    if (!b.granted && b.deleteData) {
      await pool.query('DELETE FROM ai_conversations WHERE user_id=$1', [user.id]);
      await pool.query('DELETE FROM ai_mock_interviews WHERE user_id=$1', [user.id]);
    }
    res.json(state);
  }));

  r.delete('/data', student, aiWrap(async (req, res) => {
    const user = aiUser(req);
    const c = await pool.query('DELETE FROM ai_conversations WHERE user_id=$1', [user.id]);
    const m = await pool.query('DELETE FROM ai_mock_interviews WHERE user_id=$1', [user.id]);
    const k = await pool.query('DELETE FROM ai_cache WHERE user_id=$1', [user.id]);
    res.json({ deleted: { conversations: c.rowCount, mockInterviews: m.rowCount, cache: k.rowCount } });
  }));

  r.get('/usage', aiWrap(async (req, res) => {
    const user = aiUser(req);
    const days = (await pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, count(*) FILTER (WHERE counted)::int AS requests,
              COALESCE(sum(input_tokens),0)::int AS i, COALESCE(sum(output_tokens),0)::int AS o
         FROM ai_usage WHERE user_id=$1 AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1 DESC`, [user.id])).rows;
    res.json({ today: await getQuota(pool, user), last7Days: days.map((d) => ({ day: d.day, requests: d.requests, inputTokens: d.i, outputTokens: d.o })) });
  }));

  r.get('/usage/summary', onlyRoles('officer'), aiWrap(async (req, res) => {
    const user = aiUser(req);
    const n = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const rows = (await pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, feature, count(*) FILTER (WHERE counted)::int AS requests,
              COALESCE(sum(input_tokens),0)::int AS i, COALESCE(sum(output_tokens),0)::int AS o,
              count(*) FILTER (WHERE status IN ('error','bad_output'))::int AS errors, count(*) FILTER (WHERE cached)::int AS cached
         FROM ai_usage WHERE tenant_id=$1 AND created_at > now() - ($2 || ' days')::interval GROUP BY 1,2 ORDER BY 1 DESC, 2`, [user.tenantId, String(n)])).rows;
    res.json({ items: rows.map((x) => ({ day: x.day, feature: x.feature, requests: x.requests, inputTokens: x.i, outputTokens: x.o, errors: x.errors, cached: x.cached })) });
  }));

  r.use('/', aiChatRouter(deps));
  r.use('/', aiResumeRouter(deps));
  r.use('/', aiMockRouter(deps));
  r.use('/', aiStaffRouter(deps));
  return r;
}
