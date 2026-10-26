import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { CatelogAgent } from "./agent.js";
import { renderBanner } from "./banner.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  silent?: boolean;
  onListening?: (url: string) => void;
  /** Drain in-flight tasks on SIGTERM / SIGINT, then exit (default: true). */
  handleSignals?: boolean;
  /** Max time to let running tasks finish after a signal (default: 25000). */
  shutdownTimeoutMs?: number;
}

export function startAgentServer(agent: CatelogAgent<any, any>, options: ServerOptions = {}): Server {
  const port = options.port ?? (process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000);
  const host = options.host ?? "0.0.0.0";

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    agent.handleRequest(req, res).catch((err) => {
      console.error("[catelog] Unhandled error:", err);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INTERNAL_CRASH", message: "Unhandled server error" } }));
      }
    });
  });

  server.listen(port, host, () => {
    const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
    if (options.onListening) {
      options.onListening(url);
    } else if (!options.silent) {
      renderBanner("startup", {
        name: agent.name,
        url,
        mode: agent.mode,
        authConfigured: !!agent.security.getSecret(),
      });
    }
  });

  if (options.handleSignals !== false) {
    installSignalHandlers(agent, server, options.shutdownTimeoutMs ?? 25_000, options.silent);
  }

  return server;
}

function installSignalHandlers(
  agent: CatelogAgent<any, any>,
  server: Server,
  timeoutMs: number,
  silent?: boolean,
): void {
  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      // Second signal: the operator is impatient, leave now.
      process.exit(1);
    }
    stopping = true;
    if (!silent) console.log(`[catelog] ${signal} received, draining in-flight tasks (up to ${timeoutMs}ms)...`);

    // Stop accepting new connections; idle keep-alive sockets are dropped right away.
    server.close();
    server.closeIdleConnections?.();

    agent
      .shutdown(timeoutMs)
      .catch((err) => console.error("[catelog] Shutdown error:", err))
      .finally(() => {
        server.closeAllConnections?.();
        process.exit(0);
      });
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
