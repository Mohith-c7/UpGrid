import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'pg';
import type { Config } from './config';
import { Deps } from './context';
import { errorHandler } from './errors';
import type { PushSender } from './push';
import { authRouter, meRouter } from './routes/auth';
import { applicationRouter } from './routes/applications';
import { driveRouter } from './routes/drives';
import { notificationRouter } from './routes/notifications';
import { announcementReadRouter, officerRouter } from './routes/officer';
import { profileRouter } from './routes/profile';
import { scheduleRouter } from './routes/schedule';
import { ticketRouter } from './routes/tickets';
import { mountAssessments } from './routes/assessments';
import { LEGAL_VERSIONS } from './legal';
import { buildIntegrations, IntegrationOverrides } from './integrations';
import { configRouter } from './routes/config';
import { pipelineRouter } from './routes/pipeline';
import { opsPublicRouter, opsRouter } from './routes/ops';
import { recruiterPublicRouter } from './routes/recruiterAuth';
import { authExtraRouter } from './routes/authExtra';
import { filesRouter } from './routes/files';
import { aiRouter } from './routes/ai';
import { waitlistRouter } from './routes/waitlist';
import { bindModuleHooks } from './hooks';

export interface AppOptions {
  pool: Pool;
  cfg: Config;
  push: PushSender;
  rateLimits?: { authMax?: number; globalMax?: number } | false;
  logger?: (m: string) => void;
  /** provider overrides for tests / env injection (defaults to process.env) */
  integrations?: IntegrationOverrides;
}

const limitHandler = (_req: express.Request, res: express.Response) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' } });

export function createApp(opts: AppOptions) {
  const integrations = buildIntegrations(opts.integrations);
  const deps: Deps = { pool: opts.pool, cfg: opts.cfg, push: opts.push, integrations };
  bindModuleHooks(deps);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: opts.cfg.corsOrigins.includes('*') ? true : opts.cfg.corsOrigins, credentials: false, maxAge: 600 }));
  // the student import carries up to 500 rows, which can exceed the default body size
  app.use('/api/v1/students/import', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  if (opts.rateLimits !== false) {
    const rl = opts.rateLimits || {};
    app.use(rateLimit({ windowMs: 60_000, limit: rl.globalMax ?? 300, standardHeaders: true, legacyHeaders: false, handler: limitHandler }));
  }
  const authLimiter = rateLimit({
    windowMs: 60_000, limit: (opts.rateLimits && opts.rateLimits.authMax) || 10, standardHeaders: true, legacyHeaders: false, handler: limitHandler,
  });

  app.get('/health', async (_req, res) => {
    try {
      await opts.pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/time', (_req, res) => res.json({ now: new Date().toISOString() }));

  const v1 = express.Router();
  if (opts.rateLimits !== false) v1.use('/auth', authLimiter);
  v1.use('/auth', authExtraRouter(deps));
  v1.use('/auth', authRouter(deps));
  // public recruiter onboarding (invite lookup + register); must sit before routers that authenticate everything under '/'
  v1.use('/auth', recruiterPublicRouter(deps));
  v1.use('/config', configRouter(deps)); // public; before meRouter
  // public: must be mounted before routers that authenticate everything under '/'
  v1.get('/legal/versions', (_req, res) => res.json({ terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy }));
  v1.use('/waitlist', waitlistRouter(deps, { rateLimit: opts.rateLimits !== false })); // public POST; must stay before meRouter
  v1.use('/', opsPublicRouter(deps)); // operations module: token-authenticated /calendar.ics (public; before meRouter)
  v1.use('/', meRouter(deps));
  v1.use('/profile', profileRouter(deps));
  v1.use('/drives', driveRouter(deps));
  v1.use('/', applicationRouter(deps));
  v1.use('/', scheduleRouter(deps));
  v1.use('/tickets', ticketRouter(deps));
  v1.use('/', notificationRouter(deps));
  v1.use('/announcements', announcementReadRouter(deps));
  // AI module: mounted before officerRouter because that router guards EVERYTHING under '/' with requireRole('officer')
  v1.use('/ai', aiRouter(deps));
  v1.use('/', filesRouter(deps)); // /files/*, /applications/:id/resume-url (per-route auth; must stay before officerRouter, whose router-wide officer guard would 403 students)
  v1.use('/', opsRouter(deps)); // operations module (analytics, policy, restrictions, cohorts, announcements v2, calendar, CRM, audit, documents); before officerRouter for the same reason
  v1.use('/', officerRouter(deps));
  // MODULES-BEGIN (feature modules append ONE line each here: v1.use('/x', xRouter(deps)); plus their import at the top)
  mountAssessments(v1, deps); // assessments module: /assessment-questions, /assessments, /my/assessments, /attempts, /practice (own prefixes, own guards)
  v1.use('/', pipelineRouter(deps)); // hiring pipeline + recruiter (routes carry their own guards)
  // MODULES-END
  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler(opts.logger));
  return app;
}
