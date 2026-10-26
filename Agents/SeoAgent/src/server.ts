import * as http from "node:http";
import * as fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import * as path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Worker, Runtime, DefaultLogger } from "@temporalio/worker";
import { createSeoAgentGraph } from "./graph/index.js";
import { createTemporalClient, createNativeConnection } from "./temporal/connection.js";
import { fullAuditWorkflow, type FullAuditWorkflowResult } from "./temporal/workflows/full-audit.workflow.js";
import { resolveAuditTarget } from "./core/target-resolver.js";
import { getChatModel } from "./graph/model.js";
import { env } from "./config/env.js";
import * as activities from "./activities/index.js";
import { seoCatelogAgent } from "./catelog-agent.js";
import { generateVerifiedExecutiveReport } from "./report.js";
import { awaitWorkflow } from "./temporal/await-workflow.js";

const PORT = Number(process.env.PORT) || 4000;
const app = createSeoAgentGraph();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distHtml = path.join(__dirname, "public", "index.html");
const srcHtml = path.join(__dirname, "../src/public", "index.html");
const htmlFilePath = fs.existsSync(distHtml) ? distHtml : srcHtml;

// SSE Client connections keyed by threadId
const sseClients = new Map<string, http.ServerResponse>();

// Tracked active background workflows
const activeTemporalWorkflows = new Map<string, { url: string; startTime: number; status: string }>();

// Cache of latest completed audit result per thread
const threadAuditCache = new Map<string, FullAuditWorkflowResult>();

// ----------------------------------------------------
// Start Embedded Temporal Worker
// ----------------------------------------------------
const workerState: { ready: boolean; error?: string; instance?: Worker; running?: Promise<void> } = { ready: false };

async function startEmbeddedWorker() {
  try {
    // Worker logs (task failures, panics, slow tasks) must reach stdout or outages are invisible
    try {
      Runtime.install({ logger: new DefaultLogger("INFO") });
    } catch {
      // already installed
    }

    const connection = await createNativeConnection();
    const tsWorkflowsPath = path.join(__dirname, "temporal", "workflows", "index.ts");
    const jsWorkflowsPath = path.join(__dirname, "temporal", "workflows", "index.js");
    const workflowsPath = fs.existsSync(tsWorkflowsPath) ? tsWorkflowsPath : jsWorkflowsPath;

    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities,
    });

    console.log(`✅ [Temporal Cloud Worker] Active & polling queue: "${env.TEMPORAL_TASK_QUEUE}"`);
    workerState.instance = worker;
    workerState.ready = true;
    workerState.error = undefined;
    workerState.running = worker.run().then(
      () => {
        workerState.ready = false;
      },
      (err) => {
        // Without this the HTTP server keeps accepting audits that nothing will ever process
        workerState.ready = false;
        workerState.error = err?.message || String(err);
        console.error("❌ [Temporal Cloud Worker] Worker stopped:", err);
      },
    );
  } catch (err: any) {
    workerState.ready = false;
    workerState.error = err.message || String(err);
    console.error(`❌ [Temporal Cloud Worker] Failed to start: ${workerState.error}`);
  }
}

startEmbeddedWorker();

// ----------------------------------------------------
// Query Real-Time Temporal Status
// ----------------------------------------------------
async function getTemporalStatus() {
  try {
    const client = await createTemporalClient();
    for (const [wfId, info] of activeTemporalWorkflows.entries()) {
      try {
        const handle = client.workflow.getHandle(wfId);
        const desc = await handle.describe();
        info.status = desc.status.name;
      } catch {
        // Query error
      }
    }

    const runningCount = Array.from(activeTemporalWorkflows.values()).filter(
      (w) => w.status === "RUNNING"
    ).length;

    return {
      connected: true,
      namespace: env.TEMPORAL_NAMESPACE,
      queue: env.TEMPORAL_TASK_QUEUE,
      isRunning: runningCount > 0,
      runningCount,
      activeWorkflows: Array.from(activeTemporalWorkflows.entries()).map(([id, data]) => ({
        workflowId: id,
        ...data,
      })),
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || String(err),
      isRunning: false,
      runningCount: 0,
      activeWorkflows: [],
    };
  }
}

// ----------------------------------------------------
// ----------------------------------------------------
// HTTP Server: Catelog MAPS Protocol + Web Chat UI
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Marketplace-Protocol, X-Marketplace-Timestamp, X-Marketplace-Nonce, X-Marketplace-Run-Id, X-Marketplace-Signature");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health must tell the truth: an agent whose Temporal worker is down cannot run audits.
  if (parsedUrl.pathname === "/health" && req.method === "GET") {
    const base = seoCatelogAgent.getHealth();
    const status = seoCatelogAgent.isShuttingDown ? "not_ready" : workerState.ready ? "ready" : "degraded";
    res.writeHead(status === "ready" ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ...base,
        status,
        environment_ready: workerState.ready,
        details: { temporal_worker: workerState.ready ? "polling" : workerState.error || "not running" },
      }),
    );
    return;
  }

  // 0. Catelog MAPS Protocol Endpoints (/health, /schema, /execute, /tasks/:id)
  if (
    ["/schema", "/execute"].includes(parsedUrl.pathname) ||
    parsedUrl.pathname.startsWith("/tasks/")
  ) {
    return seoCatelogAgent.handleRequest(req, res);
  }

  // 1. Status API: Real background Temporal execution status
  if (parsedUrl.pathname === "/api/status" && req.method === "GET") {
    const status = await getTemporalStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
    return;
  }

  // 2. Server-Sent Events (SSE) Stream: Push verified audit results when ready
  if (parsedUrl.pathname === "/api/events" && req.method === "GET") {
    const threadId = parsedUrl.searchParams.get("threadId") || "default";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    sseClients.set(threadId, res);
    res.write(`data: ${JSON.stringify({ type: "CONNECTED", threadId })}\n\n`);

    req.on("close", () => {
      sseClients.delete(threadId);
    });
    return;
  }

  // 3. Conversational Chat API: Intent recognition & Temporal background dispatch
  if (parsedUrl.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const query = (payload.message || "").trim();
        const threadId = payload.threadId || "web-chat-default";

        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Empty query provided" }));
          return;
        }

        // Check if user is asking about an existing completed audit
        const cachedAudit = threadAuditCache.get(threadId);
        if (cachedAudit) {
          const lower = query.toLowerCase();
          if (lower.includes("what is") || lower.includes("tell me") || lower.includes("pricing") || lower.includes("about") || lower.includes("title") || lower.includes("pagespeed")) {
            const model = getChatModel();
            const followUpPrompt = `You are the Autonomous SEO & GEO Lead. The user is asking a follow-up about the audited site: ${cachedAudit.url}.
Verified Scraped Markdown from Firecrawl:
${cachedAudit.firecrawlResult.markdown ? cachedAudit.firecrawlResult.markdown.slice(0, 3500) : "None"}

Verified Technical Data:
- PageSpeed: ${cachedAudit.groundTruth.pageSpeed?.performanceScore ?? "N/A"}/100, LCP: ${cachedAudit.groundTruth.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms
- Title: "${cachedAudit.staticResult.metadata.title || "None"}"
- SERP Rank: #${cachedAudit.groundTruth.serp?.position ?? "Unranked"}

Answer the user's question accurately based STRICTLY on the real markdown and metrics above. DO NOT invent fake data.`;

            const replyMsg = await model.invoke([
              new SystemMessage(followUpPrompt),
              new HumanMessage(query),
            ]);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ reply: replyMsg.content }));
            return;
          }
        }

        // Dual-tier target resolution (Handles www.wekraft.xyz/web, bare domains, brands, or natural prompts)
        const resolved = await resolveAuditTarget(query);

        if (resolved.isAuditIntent && resolved.targetUrl) {
          const targetUrl = resolved.targetUrl;
          const client = await createTemporalClient();
          const safeHost = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, "-");
          const workflowId = `audit-${safeHost}-${Date.now()}`;

          const forceBrowser = /browser|browserbase|screenshot|visual|diff|render|proof/i.test(query);

          console.log(`🚀 [Temporal Cloud] Starting durable workflow: ${workflowId} for ${targetUrl} (ForceBrowser: ${forceBrowser})`);

          const handle = await client.workflow.start(fullAuditWorkflow, {
            args: [{ url: targetUrl, companyName: resolved.companyName, forceBrowser }],
            taskQueue: env.TEMPORAL_TASK_QUEUE,
            workflowId,
            workflowExecutionTimeout: "10 minutes",
            workflowTaskTimeout: "30 seconds",
          });

          activeTemporalWorkflows.set(workflowId, {
            url: targetUrl,
            startTime: Date.now(),
            status: "RUNNING",
          });

          // Notify SSE clients of workflow dispatch (Catelog SSE Protocol)
          const sseInit = sseClients.get(threadId);
          if (sseInit) {
            sseInit.write(
              `event: task.status\ndata: ${JSON.stringify({
                event: "task.status",
                run_id: workflowId,
                status: "working",
                timestamp: Date.now(),
              })}\n\n`
            );
            sseInit.write(
              `event: task.progress\ndata: ${JSON.stringify({
                event: "task.progress",
                run_id: workflowId,
                percent: 25,
                message: `Durable audit active on Temporal Cloud queue "${env.TEMPORAL_TASK_QUEUE}"`,
                step: 1,
                timestamp: Date.now(),
              })}\n\n`
            );
            sseInit.write(
              `event: task.activity\ndata: ${JSON.stringify({
                event: "task.activity",
                run_id: workflowId,
                activity_type: "temporal_workflow_dispatched",
                data: { workflowId, targetUrl, taskQueue: env.TEMPORAL_TASK_QUEUE },
                timestamp: Date.now(),
              })}\n\n`
            );
          }

          // Asynchronously listen for workflow completion -> Push verified report via SSE
          awaitWorkflow<FullAuditWorkflowResult>(handle)
            .then(async (verifiedResult) => {
              console.log(`✅ [Temporal Cloud] Workflow ${workflowId} completed successfully!`);
              const item = activeTemporalWorkflows.get(workflowId);
              if (item) item.status = "COMPLETED";

              threadAuditCache.set(threadId, verifiedResult);

              const report = await generateVerifiedExecutiveReport(verifiedResult);

              const sse = sseClients.get(threadId);
              if (sse) {
                // 1. Emit Catelog Canonical SSE Events
                sse.write(
                  `event: task.progress\ndata: ${JSON.stringify({
                    event: "task.progress",
                    run_id: workflowId,
                    percent: 100,
                    message: "Executive SEO & GEO report synthesized",
                    step: 2,
                    timestamp: Date.now(),
                  })}\n\n`
                );
                sse.write(
                  `event: task.completed\ndata: ${JSON.stringify({
                    event: "task.completed",
                    run_id: workflowId,
                    duration_ms: Date.now() - (item?.startTime || Date.now()),
                    output: {
                      targetUrl,
                      status: "COMPLETED",
                      workflowId,
                      executiveReport: report,
                    },
                  })}\n\n`
                );
                // 2. Emit UI compatibility event
                sse.write(
                  `event: audit_complete\ndata: ${JSON.stringify({
                    report,
                    workflowId,
                    url: targetUrl,
                  })}\n\n`
                );
              }
            })
            .catch((err) => {
              console.error(`❌ [Temporal Cloud] Workflow ${workflowId} failed:`, err);
              const item = activeTemporalWorkflows.get(workflowId);
              if (item) item.status = "FAILED";

              const sse = sseClients.get(threadId);
              if (sse) {
                sse.write(
                  `event: task.failed\ndata: ${JSON.stringify({
                    event: "task.failed",
                    run_id: workflowId,
                    duration_ms: Date.now() - (item?.startTime || Date.now()),
                    error: {
                      code: err.code || "TOOL_FAILURE",
                      message: err.message || String(err),
                      retryable: Boolean(err.retryable),
                    },
                  })}\n\n`
                );
                sse.write(
                  `event: audit_error\ndata: ${JSON.stringify({
                    error: err.message || String(err),
                    workflowId,
                  })}\n\n`
                );
              }
            });

          // Acknowledge immediately to the user
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              reply: `🚀 **Autonomous SEO & GEO Audit Dispatched to Temporal Cloud!**\n\n- **Target URL:** \`${targetUrl}\`\n- **Company / Entity:** \`${resolved.companyName || "Identified Domain"}\`\n- **Workflow ID:** \`${workflowId}\`\n- **Temporal Queue:** \`${env.TEMPORAL_TASK_QUEUE}\`\n\n⚙️ **Parallel Activities Executing:**\n1. Fast Static Crawl & Byte-level SHA-256\n2. Firecrawl Deep Markdown Scraper\n3. JEV Hydration & Escalation Gate\n4. Browserbase Cloud Session (if dynamic SPA)\n5. Google PageSpeed (CWV) & SerpApi Rank\n6. GEO Citations & Internal Link Graph\n\n⏳ **You do not need to poll or ask 'are you done'—the verified report will automatically pop up in this chat as soon as the background workers finish!**`,
              workflowId,
              targetUrl,
            })
          );
          return;
        }

        // Casual conversation / General inquiry -> run LangGraph
        const config = { configurable: { thread_id: threadId } };
        const result = await app.invoke(
          {
            messages: [new HumanMessage(query)],
          },
          config
        );

        const latestMsg = result.messages[result.messages.length - 1];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            reply: latestMsg?.content ?? "No response generated.",
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return;
  }

  // 4. Main HTML Chat Interface
  if (parsedUrl.pathname === "/" && req.method === "GET") {
    try {
      const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Failed to load HTML file: ${err.message}`);
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  const hasKey = !!env.CATELOG_SECRET_KEY;
  console.log("================================================================================");
  console.log(`🌐 Enterprise SEO Platform Web Chat running live at: http://localhost:${PORT}`);
  console.log(`🤖 Catelog Marketplace Protocol Active (Mode: async)`);
  console.log(`🔑 Catelog Secret Key: ${hasKey ? "Configured [LIVE]" : "Not configured (Dev Mode)"}`);
  console.log(`📡 MAPS Endpoints: /health  |  /schema  |  /execute  |  /tasks/:id`);
  console.log(`⚡ Connected to Temporal Cloud Namespace: ${env.TEMPORAL_NAMESPACE}`);
  console.log("================================================================================");
});

// Graceful shutdown: stop taking audits, let running ones finish, stop the worker, then exit.
// (Temporal keeps the workflows durable either way; this just avoids dropping in-flight Catelog tasks.)
let stopping = false;
async function shutdown() {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("[SeoAgent] Shutting down: draining in-flight audits...");
  setTimeout(() => process.exit(1), 30_000).unref();

  server.close();
  await seoCatelogAgent.shutdown(20_000).catch((err) => console.error("Catelog shutdown error:", err));
  workerState.instance?.shutdown();
  await Promise.race([workerState.running, new Promise((r) => setTimeout(r, 8_000))]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
