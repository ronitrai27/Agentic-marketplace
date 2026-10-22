import * as http from "node:http";
import * as fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createSeoAgentGraph } from "./graph/index.js";
import { createTemporalClient } from "./temporal/connection.js";
import { dualTierCrawlWorkflow } from "./temporal/workflows/dual-tier-crawl.workflow.js";
import { env } from "./config/env.js";

const PORT = 3000;
const app = createSeoAgentGraph();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlFilePath = path.join(__dirname, "public", "index.html");

// In-memory set of background Temporal workflow IDs dispatched from this session
const activeTemporalWorkflows = new Map<string, { url: string; startTime: number; status: string }>();

async function getTemporalStatus() {
  try {
    const client = await createTemporalClient();
    for (const [wfId, info] of activeTemporalWorkflows.entries()) {
      try {
        const handle = client.workflow.getHandle(wfId);
        const desc = await handle.describe();
        if (desc.status.name === "RUNNING") {
          info.status = "RUNNING";
        } else {
          info.status = desc.status.name;
        }
      } catch {
        // Query error, keep current
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS headers
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

  // 2. Temporal Background Trigger API: Run real workflow on Temporal Cloud
  if (parsedUrl.pathname === "/api/temporal/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const targetUrl = payload.url || "https://example.com";
        const client = await createTemporalClient();
        const workflowId = `bg-crawl-${Date.now()}`;

        const handle = await client.workflow.start(dualTierCrawlWorkflow, {
          args: [{ url: targetUrl }],
          taskQueue: env.TEMPORAL_TASK_QUEUE,
          workflowId,
        });

        activeTemporalWorkflows.set(workflowId, {
          url: targetUrl,
          startTime: Date.now(),
          status: "RUNNING",
        });

        // Background poller to update state when complete
        handle
          .result()
          .then(() => {
            const item = activeTemporalWorkflows.get(workflowId);
            if (item) item.status = "COMPLETED";
          })
          .catch(() => {
            const item = activeTemporalWorkflows.get(workflowId);
            if (item) item.status = "FAILED";
          });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            workflowId,
            status: "RUNNING",
            message: `Temporal Cloud workflow dispatched in background for ${targetUrl}`,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
      }
    });
    return;
  }

  // 3. Conversational LangGraph Chat API
  if (parsedUrl.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const query = payload.message || "";
        const threadId = payload.threadId || "web-chat-default";

        if (!query.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Empty query provided" }));
          return;
        }

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
            guardrailBlocked: result.guardrailBlocked ?? false,
            currentUrl: result.currentUrl,
            scrapedContentPreview: result.scrapedContent?.markdown
              ? result.scrapedContent.markdown.slice(0, 300)
              : null,
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
  console.log(`🌐 SEO Platform Web Chat running live at: http://localhost:${PORT}`);
  console.log("================================================================================");
});
