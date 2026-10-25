/**
 * Fastify server entry (`npm run dev:api` / `npm start`).
 * Serves the REST+SSE API, the built React app (web/dist) when present, and —
 * unless RUNNER=external — the inline durable runner.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { dbHealth, appPool, opsPool } from '../store/db.js';
import { registerRoutes } from './routes.js';
import { startRunner, reconcileStuck, type RunnerHandle } from '../jobs/runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const webDist = path.join(projectRoot, 'web', 'dist');

export interface BuiltServer {
  app: FastifyInstance;
  runner: RunnerHandle | null;
  start: () => Promise<string>;
}

export async function buildServer(): Promise<BuiltServer> {
  const cfg = config();
  const app = Fastify({
    logger: { level: cfg.LOG_LEVEL },
    bodyLimit: 1024 * 1024 * 2, // 2 MB JSON body
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_FILE_BYTES } });

  // Raw-body capture (marketplace HMAC signature verification)
  const capture = (_req: unknown, body: Buffer, done: (err: Error | null, result?: unknown) => void): void => {
    const req = _req as { rawBody?: Buffer };
    req.rawBody = body;
    if (!body || body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch {
      done(null, {});
    }
  };
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, capture);
  app.addContentTypeParser('*', { parseAs: 'buffer' }, capture);

  // Auth: static API key (dev) + marketplace HMAC (BYOS contract) — both optional.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    const isApi = url.startsWith('/api') || url === '/execute' || url === '/health';
    if (!isApi) return;

    if (cfg.API_KEY) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${cfg.API_KEY}`) {
        return reply.code(401).send({ error: { code: 'unauthorized', message: 'missing/invalid API key' } });
      }
    }

    if (cfg.MARKETPLACE_SECRET) {
      const sig = req.headers['x-marketplace-signature'];
      const ts = Number(req.headers['x-marketplace-timestamp'] ?? 0);
      if (typeof sig !== 'string' || !ts || Math.abs(Date.now() / 1000 - ts) > 300) {
        return reply.code(401).send({ error: { code: 'bad_signature', message: 'missing/stale marketplace signature' } });
      }
      const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
      const expected = createHmac('sha256', cfg.MARKETPLACE_SECRET)
        .update(`${ts}.`)
        .update(raw)
        .digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return reply.code(401).send({ error: { code: 'bad_signature', message: 'signature mismatch' } });
      }
    }
  });

  await registerRoutes(app);

  // Serve the built React app when available (dev uses Vite on :5173 instead)
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && req.url !== '/execute' && req.url !== '/health') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'not_found', message: `no route ${req.method} ${req.url}` } });
    });
  }

  // Inline runner = default: the task lives in Postgres either way.
  let runner: RunnerHandle | null = null;
  if (cfg.RUNNER === 'inline') {
    runner = startRunner((m, e) => app.log.info({ extra: e }, m));
  } else {
    void reconcileStuck().catch(() => undefined);
    app.log.info('RUNNER=external — start `npm run worker` in a separate process');
  }

  app.addHook('onClose', async () => {
    runner?.stop();
    await appPool.end();
    await opsPool.end();
  });

  return {
    app,
    runner,
    start: async () => {
      const health = await dbHealth();
      if (!health.ok) {
        app.log.warn(`database not ready: ${health.detail} — run \`docker compose up -d\` first`);
      } else {
        app.log.info(`database ready (${health.detail})`);
      }
      const addr = await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
      app.log.info(`API + SSE on ${addr} · free_mode=${cfg.FREE_MODE} · paypal=${cfg.PAYPAL_MODE}`);
      return addr;
    },
  };
}

const isEntry =
  Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;
if (isEntry) {
  buildServer()
    .then((b) => b.start())
    .catch((e) => {
      console.error('server failed to start:', e);
      process.exit(1);
    });
}
