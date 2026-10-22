import * as http from "node:http";
import * as fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import * as path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Worker } from "@temporalio/worker";
import { createSeoAgentGraph } from "./graph/index.js";
import { createTemporalClient, createNativeConnection } from "./temporal/connection.js";
import { fullAuditWorkflow, type FullAuditWorkflowResult } from "./temporal/workflows/full-audit.workflow.js";
import { resolveAuditTarget } from "./core/target-resolver.js";
import { getChatModel } from "./graph/model.js";
import { env } from "./config/env.js";
import * as activities from "./activities/index.js";

const PORT = 3000;
const app = createSeoAgentGraph();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlFilePath = path.join(__dirname, "public", "index.html");

// SSE Client connections keyed by threadId
const sseClients = new Map<string, http.ServerResponse>();

// Tracked active background workflows
const activeTemporalWorkflows = new Map<string, { url: string; startTime: number; status: string }>();

// Cache of latest completed audit result per thread
const threadAuditCache = new Map<string, FullAuditWorkflowResult>();

// ----------------------------------------------------
// Start Embedded Temporal Worker
// ----------------------------------------------------
async function startEmbeddedWorker() {
  try {
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
    worker.run().catch((err) => console.error("Worker error:", err));
  } catch (err: any) {
    console.log(`⚠️ Worker initialization note: ${err.message || String(err)}`);
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
// Synthesize Executive Report from Verified Audit Data
// ----------------------------------------------------
async function generateVerifiedExecutiveReport(data: FullAuditWorkflowResult): Promise<string> {
  const model = getChatModel();

  const prompt = `You are an Autonomous Technical SEO & GEO Senior Director.
Synthesize the verified audit findings for: ${data.url}.

VERIFIED AUDIT EVIDENCE (From Temporal Cloud execution):
1. Static Ingestion:
   - Status: ${data.staticResult.statusCode}
   - Title: "${data.staticResult.metadata.title || "None"}"
   - Description: "${data.staticResult.metadata.metaDescription || "None"}"
   - Canonical: "${data.staticResult.metadata.declaredCanonical || "None"}"
   - Fetch Latency: ${data.staticResult.timing.totalDurationMs}ms

2. Firecrawl Verified Deep Markdown Content:
   - Scrape Success: ${data.firecrawlResult.success}
   - Scraped Title: "${data.firecrawlResult.title || "None"}"
   - Scraped Description: "${data.firecrawlResult.description || "None"}"
   - Page Content Markdown:
${data.firecrawlResult.markdown ? data.firecrawlResult.markdown.slice(0, 3000) : "No markdown returned"}

3. JEV Escalation & Browser Proof (Browserbase / Playwright):
   - Browser Escalation Required: ${data.escalationDecision.requiresBrowser}
   - JEV Reasons: [${data.escalationDecision.reasons.join("; ")}]
   - DOM Diff Discrepancies Count: ${data.browserEvidence?.domDiff.discrepancies.length ?? 0}
   - Diff Details: ${JSON.stringify(data.browserEvidence?.domDiff.discrepancies ?? [])}

4. Google Ground Truth & Core Web Vitals:
   - Performance Score: ${data.groundTruth.pageSpeed?.performanceScore ?? "N/A"}/100
   - LCP: ${data.groundTruth.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms
   - CLS: ${data.groundTruth.pageSpeed?.coreWebVitals?.cls ?? "N/A"}
   - SerpApi Organic Position: #${data.groundTruth.serp?.position ?? "Unranked"}
   - Top Competitors: ${data.groundTruth.serp?.topCompetitors.join(", ") || "None"}

5. GEO Engine Visibility & Internal Link Graph:
   - Domain Cited in AI Engines: ${data.geoSemantic.geoCitation?.isDomainCited ?? false}
   - Engine: ${data.geoSemantic.geoCitation?.aiEngine ?? "None"}
   - Keyword Cannibalization Alerts: ${data.geoSemantic.cannibalizationIssues.length}
   - Orphan Pages: ${data.linkGraph.orphanPages.length}
   - Deep Pages (>3 Clicks): ${data.linkGraph.deepPages.length}

INSTRUCTIONS:
- First, clearly state what the website and company ACTUALLY do based STRICTLY on the Firecrawl Verified Scraped Content above. DO NOT guess or invent fake service categories.
- Provide a crisp, structured report with:
  - 🟢 Highlights (what's great)
  - ⚠️ Critical Technical Risks
  - 🎯 Actionable Fixes (Code & Strategy)
- Reference the exact metrics above. DO NOT invent fake numbers.`;

  try {
    const res = await model.invoke([new SystemMessage(prompt)]);
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  } catch {
    const fallback = getChatModel("gpt-4o-mini");
    const res = await fallback.invoke([new SystemMessage(prompt)]);
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  }
}

// ----------------------------------------------------
// HTTP Server
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
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
          });

          activeTemporalWorkflows.set(workflowId, {
            url: targetUrl,
            startTime: Date.now(),
            status: "RUNNING",
          });

          // Asynchronously listen for workflow completion -> Push verified report via SSE
          handle
            .result()
            .then(async (verifiedResult) => {
              console.log(`✅ [Temporal Cloud] Workflow ${workflowId} completed successfully!`);
              const item = activeTemporalWorkflows.get(workflowId);
              if (item) item.status = "COMPLETED";

              threadAuditCache.set(threadId, verifiedResult);

              const report = await generateVerifiedExecutiveReport(verifiedResult);

              const sse = sseClients.get(threadId);
              if (sse) {
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
  console.log("================================================================================");
  console.log(`🌐 Enterprise SEO Platform Web Chat running live at: http://localhost:${PORT}`);
  console.log(`⚡ Connected to Temporal Cloud Namespace: ${env.TEMPORAL_NAMESPACE}`);
  console.log("================================================================================");
});

// Graceful cleanup on Ctrl+C to guarantee Port 3000 is immediately freed
function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  try {
    server.close();
  } catch {}
});
