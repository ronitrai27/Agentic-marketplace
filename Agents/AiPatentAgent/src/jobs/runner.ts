/**
 * Durable task runner (marketplace guarantee #1).
 * The DB row is the queue; this loop only claims and executes. Killing the server
 * mid-run leaves the row in a non-terminal status → `reconcileStuck()` re-queues it.
 */
import { config } from '../config.js';
import { claimNextQueued, opsQ } from '../store/db.js';
import { runAnalysis } from '../workflow/index.js';

const MAX_GLOBAL_IN_FLIGHT = 3;
const STUCK_AFTER_MIN = 15;

export interface RunnerHandle {
  stop: () => void;
  inFlight: () => number;
}

export function startRunner(log: (msg: string, extra?: unknown) => void = console.log): RunnerHandle {
  let inFlight = 0;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || inFlight >= MAX_GLOBAL_IN_FLIGHT) return;
    try {
      const row = await claimNextQueued(2);
      if (!row) return;
      inFlight++;
      log(`claim run=${row.id} tenant=${row.tenant_id}`);
      void runAnalysis(row.id)
        .then(() => log(`done run=${row.id}`))
        .catch((e) => log(`run error run=${row.id}`, e))
        .finally(() => {
          inFlight--;
        });
    } catch (e) {
      log('runner poll error', e);
    }
  };

  void reconcileStuck().catch(() => undefined);
  const timer = setInterval(() => void tick(), 1500);
  void tick();
  log(`runner started (inline, max ${MAX_GLOBAL_IN_FLIGHT} in flight, tenant cap 2)`);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    inFlight: () => inFlight,
  };
}

/**
 * Crash recovery: rows stuck mid-stage > 15 min go back to `queued`
 * (stage checkpoints make re-entry idempotent — all writes are upserts).
 */
export async function reconcileStuck(): Promise<number> {
  const r = await opsQ(
    `UPDATE analyses
       SET status = 'queued', stage = 'requeued', error = jsonb_build_object('message','requeued after crash/restart','retriable',true)
     WHERE status IN ('ingesting','retrieving','charting','scoring')
       AND started_at < now() - interval '${STUCK_AFTER_MIN} minutes'`,
  );
  return r.rowCount ?? 0;
}

export const runnerMode = () => config().RUNNER;
