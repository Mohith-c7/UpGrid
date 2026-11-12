import type { Pool } from 'pg';
import type { PushSender } from '../push';
import { expireOffers } from './offers';
import { sendPanelReminders } from './slots';

export async function runPipelineJobs(pool: Pool, push: PushSender, now = new Date()) {
  const expired = await expireOffers(pool, push, now);
  const panelReminders = await sendPanelReminders(pool, push, now);
  return { expired, panelReminders };
}

/** In-process poller beside the reminder worker (index.ts starts both). Safe with several instances (SKIP LOCKED). */
export function startPipelineWorker(pool: Pool, push: PushSender, intervalMs: number, log: (m: string) => void = console.error) {
  let running = false;
  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let done!: () => void;
    inflight = new Promise<void>((r) => { done = r; });
    try { await runPipelineJobs(pool, push); } catch (e) { log(`[pipeline] ${(e as Error).message}`); } finally { running = false; done(); }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return (): Promise<void> => { stopped = true; clearInterval(timer); return inflight; };
}
