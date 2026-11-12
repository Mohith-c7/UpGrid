import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrator';
import { createExpoPushSender } from './push';
import { startReminderWorker } from './reminders';
import { startAssessmentWorkers } from './assessments/workers';
import { startPipelineWorker } from './pipeline/worker';
import { startAnnouncementWorker } from './ops/announcements';
import { integrationSummary, loadIntegrationSettings } from './integrations';

(async () => {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  await migrate(pool);
  const push = createExpoPushSender(fetch, cfg.expoPushUrl);
  const app = createApp({ pool, cfg, push });
  for (const line of integrationSummary(loadIntegrationSettings(process.env))) console.log(`[integrations] ${line}`);
  const server = app.listen(cfg.port, () => console.log(`Placement OS API listening on :${cfg.port}`));
  const stopReminders = process.env.DISABLE_SCHEDULER === '1' ? async () => undefined : startReminderWorker(pool, push, cfg.schedulerIntervalMs);
  const stopAnnouncements = process.env.DISABLE_SCHEDULER === '1' ? async () => undefined : startAnnouncementWorker(pool, push, cfg.schedulerIntervalMs);
  const stopWorker = async () => { await Promise.all([stopReminders(), stopAnnouncements()]); };
  const stopPipelineWorker = process.env.DISABLE_SCHEDULER === '1' ? async () => undefined : startPipelineWorker(pool, push, cfg.schedulerIntervalMs);

  const stopAssessmentWorkers = process.env.DISABLE_SCHEDULER === '1' ? async () => undefined : startAssessmentWorkers(pool, push);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${sig} received, shutting down`);
    setTimeout(() => process.exit(1), 10_000).unref();
    // stop accepting connections, let the in-flight reminder run finish, then close the pool
    server.close(() => {
      Promise.all([stopWorker(), stopPipelineWorker(), stopAssessmentWorkers()]).catch(() => undefined).then(() => pool.end()).finally(() => process.exit(0));
    });
    void stopWorker(); // stop polling immediately
    void stopPipelineWorker();
    void stopAssessmentWorkers();
    (server as any).closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e as Error)?.message));
})().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
