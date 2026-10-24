import http from "node:http";
import { z } from "zod";
import { createMarketplaceAgent } from "catelog";
import { runResearchAgent } from "./index.js";
import { tasks, runs } from "@trigger.dev/sdk";
import { ENV } from "./config/env.js";

const PORT = process.env.PORT || 3005;

// Pending async jobs waiting for Trigger.dev completion callback
export const pendingCallbacks = new Map<string, {
  resolve: (res: any) => void;
  reject: (err: any) => void;
}>();

// 1. Declare Marketplace Schemas with Zod
export const InputSchema = z.object({
  prompt: z.string().min(2).describe("Research question or topic to investigate"),
  userId: z.string().optional().describe("Optional user identifier for tracing"),
  sessionId: z.string().optional().describe("Optional session identifier for grouping conversation turns"),
});

export const OutputSchema = z.object({
  status: z.enum(["COMPLETED", "GUARDRAIL_BLOCKED", "DIRECT_ANSWER"]).describe("Execution outcome"),
  prompt: z.string().describe("User prompt"),
  answer: z.string().describe("Synthesized research report or answer"),
  sourcesCount: z.number().describe("Number of web sources referenced"),
  durationSeconds: z.number().describe("Latency in seconds"),
  metadata: z.record(z.string(), z.any()).optional().describe("Execution metadata and telemetry"),
});

export type AgentInput = {
  prompt: string;
  userId?: string;
  sessionId?: string;
};

export type AgentOutput = {
  status: "COMPLETED" | "GUARDRAIL_BLOCKED" | "DIRECT_ANSWER";
  prompt: string;
  answer: string;
  sourcesCount: number;
  durationSeconds: number;
  metadata?: Record<string, any>;
};

// 2. Wrap LangGraph Research Agent with Catelog Marketplace SDK (Async Mode)
export const agent = createMarketplaceAgent<AgentInput, AgentOutput>({
  id: "langgraph-deep-research",
  name: "LangGraph Deep Research Agent",
  version: "1.0.0",
  mode: "async",
  description: "Autonomous multi-node LangGraph deep research agent with TypeSafe JEV guardrails, Firecrawl search, and Langfuse tracing",
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

// 3. Standalone Marketplace Agent HTTP Server
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Route 1: Catelog MAPS Protocol Endpoints (/health, /schema, /execute, /tasks/:id)
  if (
    ["/health", "/schema", "/execute"].includes(url.pathname) ||
    url.pathname.startsWith("/tasks/")
  ) {
    return agent.handleRequest(req, res);
  }

  // Route 2: Webhook callback from Trigger.dev completion
  if (url.pathname === "/api/trigger-callback" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { runId, result, error } = payload;
        console.log(`[Webhook Callback] Received completion callback for runId: ${runId}`);

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

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: {
      code: "NOT_FOUND",
      message: `Endpoint ${url.pathname} not found on Marketplace Agent Server.`,
      availableEndpoints: ["/health", "/schema", "/execute", "/tasks/:id", "/api/trigger-callback"],
    },
  }));
});

// Start standalone agent server if executed directly
if (process.argv[1]?.endsWith("agent-server.ts") || process.argv[1]?.endsWith("agent-server.js")) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🤖 Catelog Marketplace Agent (Autonomous Microservice)`);
    console.log(`📡 Protocol: MAPS 1.0.0 | Mode: ASYNC`);
    console.log(`🔑 Public Key: ${ENV.CATELOG_PUBLIC_KEY.slice(0, 16)}...`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`------------------------------------------------------`);
    console.log(`   - Ping / Liveness:  GET  http://localhost:${PORT}/health`);
    console.log(`   - Schema Manifest:  GET  http://localhost:${PORT}/schema`);
    console.log(`   - Async Execute:    POST http://localhost:${PORT}/execute (202 Accepted)`);
    console.log(`   - Task Polling:     GET  http://localhost:${PORT}/tasks/:run_id`);
    console.log(`   - Trigger Callback: POST http://localhost:${PORT}/api/trigger-callback`);
    console.log(`======================================================\n`);
  });
}
