import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";
import { createMarketplaceAgent } from "catelog";
import { runFast, runDeep, type ResearchEvent } from "./research.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables — agent-local .env first, then parent Agents/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY;
if (!apiKey) {
  console.error("❌ Warning: OPENAI_API_KEY or OPENAPI_KEY not found in .env");
}

const client = new OpenAI({ apiKey: apiKey || "" });

const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT) || 3001;

// ─────────────────────────────────────────────────────────────────────────────
//  1. Marketplace Schemas
// ─────────────────────────────────────────────────────────────────────────────

const InputSchema = z.object({
  prompt: z
    .string()
    .min(2)
    .max(4000)
    .describe("Research question or topic to investigate"),
  mode: z
    .enum(["fast", "deep"])
    .default("fast")
    .describe(
      "Research mode: 'fast' (single web-search report) or 'deep' (search → verify → formatted report, ~3 min)",
    ),
});

const OutputSchema = z.object({
  answer: z.string().describe("Synthesized research answer"),
  model: z.string().describe("OpenAI model utilized"),
  mode: z.string().describe("Research mode executed"),
  duration_seconds: z.number().describe("Total execution latency in seconds"),
});

type AgentInput = {
  prompt: string;
  mode?: "fast" | "deep";
};

type AgentOutput = {
  answer: string;
  model: string;
  mode: string;
  duration_seconds: number;
};

// ─────────────────────────────────────────────────────────────────────────────
//  2. Catelog Agent — wires the marketplace protocol, streaming + telemetry
//     Keys are auto-discovered from env CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY
// ─────────────────────────────────────────────────────────────────────────────

export const agent = createMarketplaceAgent<AgentInput, AgentOutput>({
  name: "Nova Research",
  version: "3.0.0",

  // Keys are read automatically from CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY env vars.
  // Explicit overrides kept as fallback for local development without .env.
  secretKey: process.env.CATELOG_SECRET_KEY,
  publicKey: process.env.CATELOG_PUBLIC_KEY,

  // Hard per-run ceiling (deep mode takes >= 3 min by design).
  maxTimeoutMinute: 8,
  limits: {
    maxConcurrent: 10,
    maxBodyBytes: 64_000,
    rateLimit: { max: 60, windowMs: 60_000 },
  },
  telemetry: {
    endpoint: process.env.CATELOG_TELEMETRY_URL,
    disabled: process.env.CATELOG_TELEMETRY_DISABLED === "true",
  },

  inputSchema: InputSchema as any,
  outputSchema: OutputSchema as any,

  async execute({ input, stream, signal, log, metric, usage }) {
    const startTime = Date.now();
    const isDeep = input.mode === "deep";

    const emit = (e: ResearchEvent) => {
      if (e.percent !== undefined) stream.progress(e.percent, e.message);
      else stream.step(e.message);
      if (e.phase === "web_search") stream.activity("web_search", e.data);
    };

    const result = isDeep
      ? await runDeep(client, input.prompt, emit, signal)
      : await runFast(client, input.prompt, emit, signal);

    const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(1));
    log.info("research completed", { mode: input.mode, models: result.models });
    metric.timing(isDeep ? "deep_ms" : "fast_ms", Date.now() - startTime);
    usage.record({
      model: result.model,
      provider: "openai",
      tokens: {
        prompt: result.usage.prompt,
        completion: result.usage.completion,
      },
    });

    stream.delta(result.answer);

    return {
      output: {
        answer: result.answer,
        model: result.models.join(" → "),
        mode: isDeep ? "deep" : "fast",
        duration_seconds: durationSeconds,
      },
      telemetry: {
        llm_tokens: {
          prompt: result.usage.prompt,
          completion: result.usage.completion,
        },
        sources: result.sources.length,
        duration_ms: Date.now() - startTime,
      },
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. MIME types for static file serving
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ─────────────────────────────────────────────────────────────────────────────
//  4. HTTP Server: Marketplace Protocol + Web UI
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  // Route 1: Marketplace endpoints handled by Catelog SDK
  // /health  → liveness probe + capabilities
  // /schema  → agent manifest (input/output JSON schemas)
  // /execute → authenticated execution (Bearer cat_sec_... or HMAC from gateway)
  if (["/health", "/schema", "/execute"].includes(url.pathname)) {
    return agent.handleRequest(req, res);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route 2: Web UI Chat endpoint (custom SSE — NOT the marketplace /execute route)
  if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {

      let prompt = "";
      let mode = "fast";

      try {
        const parsed = JSON.parse(body);
        prompt = parsed.prompt?.trim() || "";
        mode = parsed.mode === "deep" ? "deep" : "fast";
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prompt is required" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const startTime = Date.now();

      const ac = new AbortController();
      res.on("close", () => ac.abort());

      try {
        const emit = (e: ResearchEvent) => {
          if (e.phase === "web_search") {
            sendEvent("activity", { type: "web_search", query: e.data?.query, status: "completed" });
          } else {
            sendEvent("status", { ...e, mode });
          }
        };

        const result =
          mode === "fast"
            ? await runFast(client, prompt, emit, ac.signal)
            : await runDeep(client, prompt, emit, ac.signal);

        sendEvent("done", {
          output: result.answer,
          model: result.models.join(" → "),
          models: result.models,
          mode,
          sources: result.sources,
          durationMs: Date.now() - startTime,
          telemetry: {
            llm_tokens: {
              prompt: result.usage.prompt,
              completion: result.usage.completion,
              total: result.usage.prompt + result.usage.completion,
            },
          },
        });
        res.end();
      } catch (err: any) {
        if (!res.writableEnded) {
          sendEvent("error", {
            message:
              err?.message || "An unexpected error occurred during research.",
          });
          res.end();
        }
      }
    });
    return;
  }

  // Route 3: Serve static web UI from public/
  let filePath = path.join(
    PUBLIC_DIR,
    url.pathname === "/" ? "index.html" : url.pathname,
  );

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "text/plain";

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  const keyMode = process.env.CATELOG_SECRET_KEY
    ? "🔐 Authenticated"
    : "⚠️  Dev mode (no key)";
  console.log(`\n======================================================`);
  console.log(`🚀 Research Agent 2 running at: http://localhost:${PORT}`);
  console.log(`🔑 Auth mode: ${keyMode}`);
  console.log(`📡 Marketplace Protocol:`);
  console.log(`   - Liveness:  http://localhost:${PORT}/health`);
  console.log(`   - Schema:    http://localhost:${PORT}/schema`);
  console.log(
    `   - Execute:   http://localhost:${PORT}/execute  (Bearer cat_sec_... or HMAC)`,
  );
  console.log(`💬 Web UI:      http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});

// Graceful shutdown (Render/Fly/Railway send SIGTERM on deploy)
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}
