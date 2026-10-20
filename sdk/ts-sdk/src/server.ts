import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { MarketplaceAgent } from "./agent.js";
import { renderBanner } from "./banner.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  silent?: boolean;
  onListening?: (url: string) => void;
}

export function startAgentServer(agent: MarketplaceAgent<any, any>, options: ServerOptions = {}): Server {
  const port = options.port ?? (process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000);
  const host = options.host ?? "0.0.0.0";

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    agent.handleRequest(req, res).catch((err) => {
      console.error("[catelog-sdk] Unhandled error during request handling:", err);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "INTERNAL_CRASH", message: "Server encountered an unhandled error" } }));
      }
    });
  });

  server.listen(port, host, () => {
    const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
    if (options.onListening) {
      options.onListening(url);
    } else if (!options.silent) {
      renderBanner("startup", { name: agent.name, url });
    }
  });

  return server;
}
