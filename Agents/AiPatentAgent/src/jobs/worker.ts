/**
 * External worker entry (`npm run worker`, RUNNER=external).
 * Same loop as the inline runner — run it as a separate process when the API
 * process is serverless/ephemeral; Postgres remains the durable queue either way.
 */
import { config } from '../config.js';
import { dbHealth } from '../store/db.js';
import { reconcileStuck, startRunner } from './runner.js';

async function main(): Promise<void> {
  const cfg = config();
  console.log(`[worker] starting — env=${cfg.FREE_MODE ? 'FREE' : 'PAID'} chain=${cfg.LLM_CHAIN}`);

  const health = await dbHealth();
  console.log(`[worker] database: ${health.ok ? 'ok' : 'FAILED'} — ${health.detail}`);
  if (!health.ok) process.exit(1);

  const requeued = await reconcileStuck();
  if (requeued) console.log(`[worker] re-queued ${requeued} stuck run(s)`);

  const handle = startRunner((m, e) => console.log(`[worker] ${m}`, e ?? ''));

  const shutdown = (sig: string) => {
    console.log(`[worker] ${sig} — draining…`);
    handle.stop();
    setTimeout(() => process.exit(0), 3000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
