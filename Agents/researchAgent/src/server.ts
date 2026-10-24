import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createMarketplaceAgent } from "catelog";
import { evaluateInputGuardrail } from "./guardrail/jev-guard.js";
import { runResearchAgent } from "./index.js";
import { tasks, runs } from "@trigger.dev/sdk";
import { ENV } from "./config/env.js";

// Pending async tasks waiting for Trigger.dev completion callback
const pendingCallbacks = new Map<string, {
  resolve: (res: any) => void;
  reject: (err: any) => void;
}>();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = process.env.PORT || 3005;

// 1. Declare Marketplace Schemas with Zod
const InputSchema = z.object({
  prompt: z.string().min(2).describe("Research question or topic to investigate"),
  userId: z.string().optional().describe("Optional user identifier for tracing"),
  sessionId: z.string().optional().describe("Optional session identifier for grouping conversation turns"),
});

const OutputSchema = z.object({
  status: z.enum(["COMPLETED", "GUARDRAIL_BLOCKED", "DIRECT_ANSWER"]).describe("Execution outcome"),
  prompt: z.string().describe("User prompt"),
  answer: z.string().describe("Synthesized research report or answer"),
  sourcesCount: z.number().describe("Number of web sources referenced"),
  durationSeconds: z.number().describe("Latency in seconds"),
  metadata: z.record(z.string(), z.any()).optional().describe("Execution metadata and telemetry"),
});

type AgentInput = {
  prompt: string;
  userId?: string;
  sessionId?: string;
};

type AgentOutput = {
  status: "COMPLETED" | "GUARDRAIL_BLOCKED" | "DIRECT_ANSWER";
  prompt: string;
  answer: string;
  sourcesCount: number;
  durationSeconds: number;
  metadata?: Record<string, any>;
};

// 2. Wrap LangGraph Research Agent with Catelog Marketplace SDK
export const agent = createMarketplaceAgent<AgentInput, AgentOutput>({
  id: "langgraph-deep-research",
  name: "LangGraph Deep Research Agent",
  version: "1.0.0",
  mode: "async",
  description: "Autonomous multi-node LangGraph deep research agent with TypeSafe JEV guardrails, Tavily search, and Langfuse tracing",
  secretKey: ENV.CATELOG_SECRET_KEY,
  publicKey: ENV.CATELOG_PUBLIC_KEY,
  inputSchema: InputSchema as any,
  outputSchema: OutputSchema as any,

  async execute({ input, stream, signal, runId }) {
    stream.step("Dispatching deep research workflow to Trigger.dev Cloud...");

    if (signal.aborted) {
      throw new Error("EXECUTION_TIMEOUT");
    }

    const host = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const callbackUrl = `${host}/api/trigger-callback`;

    let triggerTaskId = "local-session";
    let triggerRun: any = null;

    try {
      triggerRun = await tasks.trigger("deep-research-agent", {
        prompt: input.prompt,
        userId: input.userId,
        sessionId: input.sessionId,
        runId,
        callbackUrl,
      });
      triggerTaskId = triggerRun.id;
      stream.step(`Trigger.dev task running [${triggerTaskId}]. Synthesizing research...`);
    } catch (err: any) {
      console.warn(`[Trigger.dev] Cloud trigger failed or unavailable, running locally: ${err?.message}`);
      const localResult = await runResearchAgent(input.prompt, {
        userId: input.userId,
        sessionId: input.sessionId,
        onProgress: (step: string) => {
          stream.step(step);
        },
      });

      return {
        output: localResult,
        telemetry: {
          model_used: ENV.JEV_MODEL || "gpt-4.1-mini",
          execution_status: localResult.status,
          sources_count: localResult.sourcesCount,
          execution_type: "local_fallback",
        },
      };
    }

    // Await research results via webhook callback OR fallback polling of runs.poll
    const result: AgentOutput = await Promise.race([
      new Promise<AgentOutput>((resolve, reject) => {
        pendingCallbacks.set(runId, { resolve, reject });
      }),
      (async () => {
        try {
          const completedRun = await runs.poll(triggerTaskId, { pollIntervalMs: 4000 });
          return completedRun.output as AgentOutput;
        } catch (pollErr) {
          // If poll fails or unsupported in environment, hold promise until webhook callback arrives
          return new Promise<AgentOutput>(() => {});
        }
      })(),
    ]).finally(() => {
      pendingCallbacks.delete(runId);
    });

    return {
      output: result,
      telemetry: {
        model_used: ENV.JEV_MODEL || "gpt-4.1-mini",
        execution_status: result?.status,
        sources_count: result?.sourcesCount,
        trigger_task_id: triggerTaskId,
        execution_type: "trigger_dev_cloud",
      },
    };
  },
});

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Route 0: Handle Marketplace Protocol Endpoints via Catelog SDK (/health, /schema, /execute, /tasks/:id)
  if (
    ["/health", "/schema", "/execute"].includes(url.pathname) ||
    url.pathname.startsWith("/tasks/")
  ) {
    return agent.handleRequest(req, res);
  }

  // Route 0.5: Webhook callback from Trigger.dev completion
  if (url.pathname === "/api/trigger-callback" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { runId, result, error } = payload;
        console.log(`[Webhook Callback] Received callback for runId: ${runId}`);

        if (runId && pendingCallbacks.has(runId)) {
          const pending = pendingCallbacks.get(runId)!;
          if (error) {
            pending.reject(new Error(error.message || "Trigger.dev task failed"));
          } else {
            pending.resolve(result);
          }
          pendingCallbacks.delete(runId);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, runId }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body", message: err.message }));
      }
    });
    return;
  }

  // 1. Handle Real-time SSE Chat API (Web UI)
  if (url.pathname === "/api/chat-sse" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      let prompt = "";
      try {
        const parsed = JSON.parse(body);
        prompt = parsed.prompt?.trim() || "";
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

      // Initialize SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Step 1: Evaluate JEV Guardrails
        sendEvent("progress", { step: "Evaluating prompt guardrails & intent with TypeSafe JEV-1.14..." });
        const guard = await evaluateInputGuardrail(prompt);

        // Terminal Console Log of JEV Decision
        console.log(`\n======================================================`);
        console.log(`[JEV TELEMETRY] Prompt: "${prompt}"`);
        console.log(`  - Model: ${ENV.JEV_MODEL}`);
        console.log(`  - Inappropriate Prob: ${guard.scores.inappropriateProb} (Allowed: ${guard.isAllowed})`);
        console.log(`  - Needs Research Prob: ${guard.scores.needsResearchProb}`);
        console.log(`  - Decision Route: ${guard.needsResearch ? "DEEP RESEARCH" : "CHIT-CHAT / DIRECT"}`);
        console.log(`  - Target Engine: ${guard.needsResearch ? "OpenAI gpt-4.1-mini" : "Groq openai/gpt-oss-120b"}`);
        console.log(`======================================================\n`);

        // Trigger Trigger.dev Background Task in parallel (if configured)
        let triggerTaskId = "local-session";
        try {
          const triggerRun = await tasks.trigger("deep-research-agent", {
            prompt,
          });
          triggerTaskId = triggerRun.id;
          console.log(`[Trigger.dev] Spawned background task ID: ${triggerTaskId}`);
        } catch (err: any) {
          console.log(`[Trigger.dev] Local execution fallback (${err?.message || "dev worker"})`);
        }

        // Send JEV Telemetry to UI
        sendEvent("jev_telemetry", {
          prompt,
          model: ENV.JEV_MODEL,
          scores: guard.scores,
          isAllowed: guard.isAllowed,
          needsResearch: guard.needsResearch,
          route: guard.needsResearch ? "Deep Research" : "Chit-chat",
          targetModel: guard.needsResearch ? "gpt-4.1-mini" : "groq-openai/gpt-oss-120b",
          triggerTaskId,
        });

        // Step 2: Execute Master Research Agent with live progress events
        const result = await runResearchAgent(prompt, {
          onProgress: (stepMsg: string) => {
            sendEvent("progress", { step: stepMsg });
          },
        });

        // Step 3: Stream Final Result
        sendEvent("result", result);
        sendEvent("done", { success: true });
        res.end();
      } catch (err: any) {
        console.error("[SSE Error]:", err);
        sendEvent("result", {
          status: "ERROR",
          answer: `Error executing research: ${err.message}`,
        });
        sendEvent("done", { success: false });
        res.end();
      }
    });

    return;
  }

  // 2. Serve Static Frontend Files
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "text/plain";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 LangGraph Research Agent running at: http://localhost:${PORT}`);
  console.log(`📡 Marketplace Protocol (Catelog SDK v1.0.5 - Mode: ASYNC):`);
  console.log(`   - Ping / Liveness: http://localhost:${PORT}/health`);
  console.log(`   - Schema Manifest: http://localhost:${PORT}/schema`);
  console.log(`   - Async Execute:   http://localhost:${PORT}/execute (returns 202 + poll_url)`);
  console.log(`   - Task Polling:    http://localhost:${PORT}/tasks/:run_id`);
  console.log(`   - Webhook Callback:http://localhost:${PORT}/api/trigger-callback`);
  console.log(`💬 Web UI:            http://localhost:${PORT}`);
  console.log(`   - Realtime SSE:    http://localhost:${PORT}/api/chat-sse`);
  console.log(`======================================================\n`);
});
