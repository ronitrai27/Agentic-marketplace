import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createMarketplaceAgent } from "catelog";
import { classify, answerDirect, type AgentExecutionResult } from "./index.js";
import {
  startResearchWorkflow,
  getWorkflowEvents,
  getWorkflowState,
} from "./temporal/client.js";
import { startWorker } from "./temporal/worker.js";
import { progressEmitter } from "./observability/progress.js";
import { ENV } from "./config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = process.env.PORT || 3005;

// 1. Declare Marketplace Schemas with Zod
const InputSchema = z.object({
  prompt: z
    .string()
    .min(2)
    .describe("Research question or topic to investigate"),
  userId: z
    .string()
    .optional()
    .describe("Optional user identifier for tracing"),
  sessionId: z
    .string()
    .optional()
    .describe("Optional session identifier for grouping conversation turns"),
});

const OutputSchema = z.object({
  status: z
    .enum(["COMPLETED", "GUARDRAIL_BLOCKED", "DIRECT_ANSWER"])
    .describe("Execution outcome"),
  prompt: z.string().describe("User prompt"),
  answer: z.string().describe("Synthesized research report or answer"),
  sourcesCount: z.number().describe("Number of web sources referenced"),
  durationSeconds: z.number().describe("Latency in seconds"),
  metadata: z
    .record(z.string(), z.any())
    .optional()
    .describe("Execution metadata and telemetry"),
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

// 2. Wrap Research Agent with Catelog Marketplace SDK
export const agent = createMarketplaceAgent<AgentInput, AgentOutput>({
  id: "langgraph-deep-research",
  name: "LangGraph Deep Research Agent",
  version: "1.0.0",
  mode: "async",
  description:
    "Autonomous multi-node LangGraph deep research agent with TypeSafe JEV guardrails, Firecrawl search, Langfuse tracing, and Temporal durable workflow orchestration",
  secretKey: ENV.CATELOG_SECRET_KEY,
  publicKey: ENV.CATELOG_PUBLIC_KEY,
  inputSchema: InputSchema as any,
  outputSchema: OutputSchema as any,

  async execute({ input, stream, signal, runId }) {
    console.log(`\n======================================================`);
    console.log(`📥 [MAPS PROTOCOL INCOMING]`);
    console.log(`   - Run ID: ${runId}`);
    console.log(`   - Prompt: "${input.prompt}"`);
    console.log(`   - User ID: ${input.userId || "anonymous"}`);
    console.log(`======================================================\n`);

    stream.step(
      "Evaluating prompt guardrails & intent with TypeSafe JEV-1.14...",
    );

    if (signal.aborted) {
      console.error(
        `❌ [MAPS PROTOCOL] Run ID ${runId} aborted before dispatch.`,
      );
      throw new Error("EXECUTION_TIMEOUT");
    }

    // STEP 1: Fast Classification & Guardrails (~1s)
    const guard = await classify(input.prompt, {
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
    });

    // Guardrail blocked: Return immediately
    if (!guard.isAllowed) {
      console.warn(`[Guardrail] Request rejected: ${guard.rejectionReason}`);
      return {
        output: {
          status: "GUARDRAIL_BLOCKED",
          prompt: input.prompt,
          answer:
            guard.rejectionReason || "Request blocked by safety guardrails.",
          sourcesCount: 0,
          durationSeconds: 1,
          metadata: { scores: guard.scores },
        },
        telemetry: {
          model_used: ENV.JEV_MODEL,
          execution_status: "GUARDRAIL_BLOCKED",
          sources_count: 0,
          execution_type: "guardrail_blocked",
        },
      };
    }

    // STEP 2: Chit-Chat / Direct Question -> Answer via Groq in 1-2s (NO Temporal Worker!)
    if (!guard.needsResearch) {
      stream.step(
        "Conversational question detected. Generating direct answer via Groq...",
      );
      console.log(
        `💬 [Chit-chat] Prompt is conversational. Answering directly via Groq (no background worker invoked).`,
      );

      const directResult = await answerDirect(input.prompt, {
        userId: input.userId,
        sessionId: input.sessionId,
        runId,
        scores: guard.scores,
      });

      console.log(`\n======================================================`);
      console.log(`📤 [MAPS PROTOCOL OUTGOING (Groq Direct Answer)]`);
      console.log(`   - Run ID: ${runId}`);
      console.log(`   - Status: ${directResult.status}`);
      console.log(`   - Answer: "${directResult.answer.slice(0, 120)}..."`);
      console.log(`======================================================\n`);

      return {
        output: directResult,
        telemetry: {
          model_used: ENV.GROQ_MODEL,
          execution_status: directResult.status,
          sources_count: 0,
          execution_type: "groq_direct",
          llm_tokens: directResult.metadata?.llm_tokens,
          cost_usd: directResult.metadata?.cost_usd,
        },
      };
    }

    // STEP 3: Deep Research -> Orchestrate via Temporal Workflow
    stream.step("Dispatching deep research workflow to Temporal Cluster...");
    console.log(
      `🔬 [Deep Research] Topic requires investigation. Starting Temporal Workflow...`,
    );

    const { workflowId, handle } = await startResearchWorkflow({
      prompt: input.prompt,
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
    });

    stream.step(
      `Temporal workflow active [${workflowId}]. Synthesizing research...`,
    );

    // Forward real-time node & tool progress directly to Catelog stream
    const onStreamStep = ({ step }: { step: string }) => {
      let pct: number | undefined;
      if (step.includes("Orchestrator")) pct = 15;
      else if (step.includes("sec_1")) pct = 35;
      else if (step.includes("sec_2")) pct = 55;
      else if (step.includes("sec_3")) pct = 75;
      else if (step.includes("Critic")) pct = 85;
      else if (step.includes("Synthesizer") || step.includes("executive")) pct = 95;

      if (pct !== undefined) {
        stream.progress(pct, step);
      } else {
        stream.step(step);
      }
    };
    progressEmitter.on("step", onStreamStep);

    let result: AgentOutput;
    try {
      result = (await handle.result()) as AgentOutput;
    } finally {
      progressEmitter.off("step", onStreamStep);
    }

    console.log(`\n======================================================`);
    console.log(`📤 [MAPS PROTOCOL OUTGOING (Temporal Durable Execution)]`);
    console.log(`   - Run ID: ${runId}`);
    console.log(`   - Workflow ID: ${workflowId}`);
    console.log(`   - Status: ${result?.status}`);
    console.log(`   - Answer: "${result?.answer?.slice(0, 120)}..."`);
    console.log(`======================================================\n`);

    return {
      output: result,
      telemetry: {
        model_used: ENV.OPENAI_MODEL,
        execution_status: result?.status,
        sources_count: result?.sourcesCount,
        temporal_workflow_id: workflowId,
        execution_type: "temporal_workflow",
        llm_tokens: result?.metadata?.llm_tokens,
        cost_usd: result?.metadata?.cost_usd,
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

export const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  // Route 0: Handle Marketplace Protocol Endpoints (/health, /schema, /execute, /tasks/:id)
  if (
    ["/health", "/schema", "/execute"].includes(url.pathname) ||
    url.pathname.startsWith("/tasks/")
  ) {
    return agent.handleRequest(req, res);
  }

  // Route 0.5: Query Temporal Workflow Events
  if (url.pathname === "/api/temporal/events" && req.method === "GET") {
    const workflowId = url.searchParams.get("workflowId");
    if (!workflowId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "workflowId query parameter is required" }),
      );
      return;
    }

    const events = await getWorkflowEvents(workflowId);
    const state = await getWorkflowState(workflowId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ workflowId, state, events }));
    return;
  }

  // Route 1: Handle Real-time SSE Chat API (Web UI)
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
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Step 1: Evaluate JEV Guardrails & Intent
        sendEvent("progress", {
          step: "Evaluating prompt guardrails & intent with TypeSafe JEV-1.14...",
        });
        const guard = await classify(prompt, { sessionId: "sse-session" });

        // Terminal Console Log of JEV Decision
        console.log(`\n======================================================`);
        console.log(`[JEV TELEMETRY] Prompt: "${prompt}"`);
        console.log(`  - Model: ${ENV.JEV_MODEL}`);
        console.log(
          `  - Inappropriate Prob: ${guard.scores.inappropriateProb} (Allowed: ${guard.isAllowed})`,
        );
        console.log(
          `  - Needs Research Prob: ${guard.scores.needsResearchProb}`,
        );
        console.log(
          `  - Decision Route: ${guard.needsResearch ? "DEEP RESEARCH" : "CHIT-CHAT / DIRECT"}`,
        );
        console.log(
          `  - Target Engine: ${guard.needsResearch ? "Temporal Workflow + LangGraph" : "Groq openai/gpt-oss-120b"}`,
        );
        console.log(`======================================================\n`);

        // Send JEV Telemetry to UI
        sendEvent("jev_telemetry", {
          prompt,
          model: ENV.JEV_MODEL,
          scores: guard.scores,
          isAllowed: guard.isAllowed,
          needsResearch: guard.needsResearch,
          route: guard.needsResearch ? "Deep Research" : "Chit-chat",
          targetModel: guard.needsResearch
            ? "gpt-4.1-mini (Temporal)"
            : "groq-openai/gpt-oss-120b",
        });

        // If guardrail blocked:
        if (!guard.isAllowed) {
          sendEvent("result", {
            status: "GUARDRAIL_BLOCKED",
            prompt,
            answer:
              guard.rejectionReason || "Request blocked by safety guardrails.",
            sourcesCount: 0,
            durationSeconds: 1,
            metadata: { scores: guard.scores },
          });
          sendEvent("done", { success: false });
          res.end();
          return;
        }

        // Step 2: Conversational Question -> Instant Direct Answer via Groq (No Temporal Worker!)
        if (!guard.needsResearch) {
          sendEvent("progress", {
            step: "Conversational question detected. Generating direct answer via Groq...",
          });
          const directAns = await answerDirect(prompt, {
            scores: guard.scores,
          });
          sendEvent("result", directAns);
          sendEvent("done", { success: true });
          res.end();
          return;
        }

        // Step 3: Deep Research Topic -> Start Temporal Workflow
        sendEvent("progress", {
          step: "Dispatching deep research workflow to Temporal Cluster...",
        });
        const { workflowId, handle } = await startResearchWorkflow({
          prompt,
          sessionId: "sse-session",
        });

        sendEvent("temporal_dispatched", { workflowId });
        sendEvent("progress", {
          step: `Temporal workflow running [${workflowId}]. Synthesizing research...`,
        });

        // Forward real-time node & tool progress directly to UI SSE stream
        const onSseStep = ({ step }: { step: string }) => {
          sendEvent("progress", { step });
        };
        progressEmitter.on("step", onSseStep);

        try {
          const finalResult = await handle.result();
          progressEmitter.off("step", onSseStep);
          sendEvent("result", finalResult);
          sendEvent("done", { success: true });
        } catch (execErr: any) {
          progressEmitter.off("step", onSseStep);
          throw execErr;
        }

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

  // Route 2: Static Frontend Files
  let filePath = path.join(
    PUBLIC_DIR,
    url.pathname === "/" ? "index.html" : url.pathname,
  );
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

if (
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js")
) {
  server.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Unified Marketplace Agent & Realtime UI Server`);
    console.log(`📡 MAPS Protocol:   http://localhost:${PORT}/execute`);
    console.log(`📋 Health Check:    http://localhost:${PORT}/health`);
    console.log(`📜 Schema Manifest: http://localhost:${PORT}/schema`);
    console.log(`💬 Web UI:          http://localhost:${PORT}`);
    console.log(
      `🔄 Temporal Events: http://localhost:${PORT}/api/temporal/events?workflowId=...`,
    );
    console.log(`======================================================\n`);

    // Auto-start Temporal Worker so single-service Render deployments work immediately
    try {
      await startWorker();
    } catch (err: any) {
      console.error(`⚠️ [Temporal Worker Auto-Start Warning]:`, err?.message || err);
    }
  });

  // Graceful shutdown on Ctrl+C to avoid port 3005 EADDRINUSE
  const shutdown = () => {
    console.log("\n🛑 [Shutdown] Closing server and background worker...");
    server.close(() => {
      console.log("✅ [Shutdown] Port 3005 released.");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
