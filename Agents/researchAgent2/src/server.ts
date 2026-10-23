import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";
import { createMarketplaceAgent, pipeOpenAiResponsesStream } from "catelog";

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
  prompt: z.string().min(2).describe("Research question or topic to investigate"),
  mode: z
    .enum(["fast", "deep"])
    .default("fast")
    .describe("Research mode: 'fast' (realtime web search) or 'deep' (background reasoning)"),
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
  name: "Universal Research Agent 2",
  version: "1.0.0",
  description:
    "Dual-mode research agent using OpenAI Responses API + live Web Search (fast & deep reasoning)",

  // Keys are read automatically from CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY env vars.
  // Explicit overrides kept as fallback for local development without .env.
  secretKey: process.env.CATELOG_SECRET_KEY,
  publicKey: process.env.CATELOG_PUBLIC_KEY,

  inputSchema: InputSchema as any,
  outputSchema: OutputSchema as any,

  async execute({ input, stream, signal }) {
    const startTime = Date.now();

    // ── Fast Mode: synchronous web-search response ──
    if (input.mode === "fast" || !input.mode) {
      stream.step("Running web search with gpt-6-luna...");

      const response: any = await client.responses.create({
        model: "gpt-6-luna",
        input: input.prompt,
        tools: [{ type: "web_search" }],
      });

      // Pipe response → SSE activity events + telemetry via the new adapter
      const adapterResult = await pipeOpenAiResponsesStream(response, stream);
      const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(1));
      const answer = response.output_text || "No response generated.";

      return {
        output: {
          answer,
          model: "gpt-6-luna",
          mode: "fast",
          duration_seconds: durationSeconds,
        },
        telemetry: {
          ...adapterResult.telemetry,
          duration_ms: Date.now() - startTime,
        },
      };
    }

    // ── Deep Mode: background reasoning + polling ──
    stream.step("Dispatching background deep reasoning task (gpt-5.4-mini)...");

    let response: any = await client.responses.create({
      model: "gpt-5.4-mini",
      input: input.prompt,
      background: true,
      reasoning: { effort: "medium" },
      tools: [{ type: "web_search" }],
    });

    stream.activity("background_task", {
      taskId: response.id,
      status: response.status,
      model: "gpt-5.4-mini",
    });

    // Polling loop — emit structured activity events on each tick
    while (response.status === "queued" || response.status === "in_progress") {
      if (signal.aborted) {
        throw new Error("EXECUTION_TIMEOUT");
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      stream.activity("polling", {
        taskId: response.id,
        status: response.status,
        elapsed_seconds: elapsed,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      response = await client.responses.retrieve(response.id) as any;
    }

    if (response.status !== "completed") {
      throw new Error(
        `Background reasoning ended with unexpected status: ${response.status}`
      );
    }

    // Pipe final response → SSE delta + activity events + telemetry
    const adapterResult = await pipeOpenAiResponsesStream(response, stream);
    const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(1));

    return {
      output: {
        answer: response.output_text || "",
        model: "gpt-5.4-mini",
        mode: "deep",
        duration_seconds: durationSeconds,
      },
      telemetry: {
        ...adapterResult.telemetry,
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
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Route 1: Marketplace endpoints handled by Catelog SDK
  // /health  → liveness probe + capabilities
  // /schema  → agent manifest (input/output JSON schemas)
  // /execute → authenticated execution (Bearer cat_sec_... or HMAC from gateway)
  if (["/health", "/schema", "/execute"].includes(url.pathname)) {
    return agent.handleRequest(req, res);
  }

  // CORS for the web UI
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route 2: Web UI Chat endpoint (custom SSE — NOT the marketplace /execute route)
  if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });

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

      try {
        if (mode === "fast") {
          sendEvent("status", {
            phase: "searching",
            model: "gpt-6-luna",
            message: "Running web search with gpt-6-luna...",
          });

          const response = await client.responses.create({
            model: "gpt-6-luna",
            input: prompt,
            tools: [{ type: "web_search" }],
          }) as any;

          // Emit web_search activity if present in output items
          for (const item of response?.output ?? []) {
            if (item?.type === "web_search_call" || item?.type === "search") {
              sendEvent("activity", {
                type: "web_search",
                query: item?.action?.query ?? item?.query,
                status: item?.status ?? "completed",
              });
            }
          }

          const durationMs = Date.now() - startTime;
          sendEvent("done", {
            output: response.output_text,
            model: "gpt-6-luna",
            mode: "fast",
            durationMs,
            telemetry: {
              llm_tokens: {
                prompt: response.usage?.input_tokens,
                completion: response.usage?.output_tokens,
                total: response.usage?.total_tokens,
              },
            },
          });
          res.end();
        } else {
          sendEvent("status", {
            phase: "dispatching",
            model: "gpt-5.4-mini",
            message: "Dispatching background reasoning task (effort: medium)...",
          });

          let response = await client.responses.create({
            model: "gpt-5.4-mini",
            input: prompt,
            background: true,
            reasoning: { effort: "medium" },
            tools: [{ type: "web_search" }],
          }) as any;

          sendEvent("status", {
            phase: "dispatched",
            taskId: response.id,
            status: response.status,
            model: "gpt-5.4-mini",
            message: `Background task started [${response.id}] — status: ${response.status}`,
          });

          while (response.status === "queued" || response.status === "in_progress") {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            sendEvent("status", {
              phase: "polling",
              taskId: response.id,
              status: response.status,
              elapsedSeconds: elapsed,
              message: `Deep reasoning & searching in background... (${elapsed}s, status: ${response.status})`,
            });

            await new Promise((resolve) => setTimeout(resolve, 2000));
            response = await client.responses.retrieve(response.id) as any;
          }

          const durationMs = Date.now() - startTime;

          if (response.status === "completed") {
            // Emit activity events for search/reasoning steps
            for (const item of response?.output ?? []) {
              if (item?.type === "web_search_call" || item?.type === "search") {
                sendEvent("activity", {
                  type: "web_search",
                  query: item?.action?.query ?? item?.query,
                  status: item?.status ?? "completed",
                });
              }
              if (item?.type === "reasoning") {
                const summary = item?.summary?.map((s: any) => s?.text).join(" ") ?? "";
                if (summary) {
                  sendEvent("activity", {
                    type: "reasoning",
                    summary: summary.slice(0, 300),
                  });
                }
              }
            }

            sendEvent("done", {
              output: response.output_text,
              model: "gpt-5.4-mini",
              mode: "deep",
              taskId: response.id,
              durationMs,
              telemetry: {
                llm_tokens: {
                  prompt: response.usage?.input_tokens,
                  completion: response.usage?.output_tokens,
                  total: response.usage?.total_tokens,
                },
              },
            });
          } else {
            sendEvent("error", {
              message: `Background response ended with unexpected status: ${response.status}`,
              status: response.status,
              taskId: response.id,
            });
          }
          res.end();
        }
      } catch (err: any) {
        sendEvent("error", {
          message: err?.message || "An unexpected error occurred during research.",
        });
        res.end();
      }
    });
    return;
  }

  // Route 3: Serve static web UI from public/
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);

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
  const keyMode = process.env.CATELOG_SECRET_KEY ? "🔐 Authenticated" : "⚠️  Dev mode (no key)";
  console.log(`\n======================================================`);
  console.log(`🚀 Research Agent 2 running at: http://localhost:${PORT}`);
  console.log(`🔑 Auth mode: ${keyMode}`);
  console.log(`📡 Marketplace Protocol:`);
  console.log(`   - Liveness:  http://localhost:${PORT}/health`);
  console.log(`   - Schema:    http://localhost:${PORT}/schema`);
  console.log(`   - Execute:   http://localhost:${PORT}/execute  (Bearer cat_sec_... or HMAC)`);
  console.log(`💬 Web UI:      http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
