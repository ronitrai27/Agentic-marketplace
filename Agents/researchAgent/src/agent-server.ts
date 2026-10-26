import http from "node:http";
import { z } from "zod";
import { createMarketplaceAgent } from "catelog";
import { classify, answerDirect, type AgentExecutionResult } from "./index.js";
import {
  startResearchWorkflow,
  getWorkflowEvents,
  getWorkflowState,
} from "./temporal/client.js";
import { startWorker } from "./temporal/worker.js";
import { ENV } from "./config/env.js";

const PORT = process.env.PORT || 3005;

// 1. Declare Marketplace Schemas with Zod
export const InputSchema = z.object({
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

export const OutputSchema = z.object({
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

    stream.step("Evaluating prompt guardrails & intent with TypeSafe JEV-1.14...");

    if (signal.aborted) {
      console.error(`❌ [MAPS PROTOCOL] Run ID ${runId} aborted before dispatch.`);
      throw new Error("EXECUTION_TIMEOUT");
    }

    // STEP 1: Fast Classification & Guardrails (~1s)
    const guard = await classify(input.prompt, {
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
    });

    if (!guard.isAllowed) {
      console.warn(`[Guardrail] Request rejected: ${guard.rejectionReason}`);
      return {
        output: {
          status: "GUARDRAIL_BLOCKED",
          prompt: input.prompt,
          answer: guard.rejectionReason || "Request blocked by safety guardrails.",
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
      stream.step("Conversational question detected. Generating direct answer via Groq...");
      console.log(`💬 [Chit-chat] Prompt is conversational. Answering directly via Groq (no background worker invoked).`);

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
        },
      };
    }

    // STEP 3: Deep Research -> Orchestrate via Temporal Workflow
    stream.step("Dispatching deep research workflow to Temporal Cluster...");
    console.log(`🔬 [Deep Research] Topic requires investigation. Starting Temporal Workflow...`);

    const { workflowId, handle } = await startResearchWorkflow({
      prompt: input.prompt,
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
    });

    stream.step(`Temporal workflow active [${workflowId}]. Synthesizing research...`);

    // Poll events periodically to stream progress back to Catelog stream
    const progressTimer = setInterval(async () => {
      try {
        const events = await getWorkflowEvents(workflowId);
        if (events && events.length > 0) {
          const latest = events[events.length - 1];
          stream.step(latest.message);
        }
      } catch {}
    }, 4000);

    let result: AgentOutput;
    try {
      result = (await handle.result()) as AgentOutput;
    } finally {
      clearInterval(progressTimer);
    }

    console.log(`\n======================================================`);
    console.log(`📤 [MAPS PROTOCOL OUTGOING (Temporal Durable Execution)]`);
    console.log(`   - Run ID: ${runId}`);
    console.log(`   - Workflow ID: ${workflowId}`);
    console.log(`   - Status: ${result?.status}`);
    console.log(`   - Answer: "${result?.answer?.slice(0, 120)}..."`);
    console.log(`======================================================\n`);

    // Stream text deltas in chunks so chunks_streamed is tracked
    if (result?.answer) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < result.answer.length; i += CHUNK_SIZE) {
        stream.delta(result.answer.slice(i, i + CHUNK_SIZE));
      }
    }
    stream.progress(100, "Research completed successfully");

    // Deduplicate: Extract tokens & cost for top-level telemetry only
    const { llm_tokens, cost_usd, ...cleanMetadata } = (result?.metadata || {}) as any;
    const cleanOutput = {
      ...result,
      metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
    };

    return {
      output: cleanOutput,
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

// 3. Standalone Marketplace Agent HTTP Server
export const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );

  // Route 1: Catelog MAPS Protocol Endpoints (/health, /schema, /execute, /tasks/:id)
  if (
    ["/health", "/schema", "/execute"].includes(url.pathname) ||
    url.pathname.startsWith("/tasks/")
  ) {
    return agent.handleRequest(req, res);
  }

  // Route 2: Query Temporal Workflow Events
  if (url.pathname === "/api/temporal/events" && req.method === "GET") {
    const workflowId = url.searchParams.get("workflowId");
    if (!workflowId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "workflowId query parameter is required" }));
      return;
    }

    const events = await getWorkflowEvents(workflowId);
    const state = await getWorkflowState(workflowId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ workflowId, state, events }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        code: "NOT_FOUND",
        message: `Endpoint ${url.pathname} not found on Marketplace Agent Server.`,
        availableEndpoints: [
          "/health",
          "/schema",
          "/execute",
          "/tasks/:id",
          "/api/temporal/events?workflowId=...",
        ],
      },
    })
  );
});

// Start standalone agent server if executed directly
if (
  process.argv[1]?.endsWith("agent-server.ts") ||
  process.argv[1]?.endsWith("agent-server.js")
) {
  server.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`🤖 Catelog Marketplace Agent (Autonomous Microservice)`);
    console.log(`📡 Protocol: MAPS 1.0.0 | Mode: ASYNC`);
    console.log(`🔑 Public Key: ${ENV.CATELOG_PUBLIC_KEY.slice(0, 16)}...`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`------------------------------------------------------`);
    console.log(`   - Ping / Liveness:  GET  http://localhost:${PORT}/health`);
    console.log(`   - Schema Manifest:  GET  http://localhost:${PORT}/schema`);
    console.log(
      `   - Async Execute:    POST http://localhost:${PORT}/execute (202 Accepted)`
    );
    console.log(
      `   - Task Polling:     GET  http://localhost:${PORT}/tasks/:run_id`
    );
    console.log(
      `   - Temporal Events:  GET  http://localhost:${PORT}/api/temporal/events?workflowId=...`
    );
    console.log(`======================================================\n`);

    // Auto-start Temporal Worker so single-service Render deployments work immediately
    try {
      await startWorker();
    } catch (err: any) {
      console.error(`⚠️ [Temporal Worker Auto-Start Warning]:`, err?.message || err);
    }
  });
}
