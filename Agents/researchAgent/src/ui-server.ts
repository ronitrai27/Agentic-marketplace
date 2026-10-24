import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, answerDirect } from "./index.js";
import {
  startResearchWorkflow,
  getWorkflowEvents,
} from "./temporal/client.js";
import { ENV } from "./config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = process.env.UI_PORT || process.env.PORT || 3000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export const uiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // 1. Real-time SSE Chat API (Web UI)
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
        sendEvent("progress", { step: "Evaluating prompt guardrails & intent with TypeSafe JEV-1.14..." });
        const guard = await classify(prompt, { sessionId: "ui-sse" });

        console.log(`\n======================================================`);
        console.log(`[JEV TELEMETRY] Prompt: "${prompt}"`);
        console.log(`  - Model: ${ENV.JEV_MODEL}`);
        console.log(`  - Inappropriate Prob: ${guard.scores.inappropriateProb} (Allowed: ${guard.isAllowed})`);
        console.log(`  - Needs Research Prob: ${guard.scores.needsResearchProb}`);
        console.log(`  - Decision Route: ${guard.needsResearch ? "DEEP RESEARCH" : "CHIT-CHAT / DIRECT"}`);
        console.log(`  - Target Engine: ${guard.needsResearch ? "Temporal Workflow + LangGraph" : "Groq openai/gpt-oss-120b"}`);
        console.log(`======================================================\n`);

        // Send JEV Telemetry to UI
        sendEvent("jev_telemetry", {
          prompt,
          model: ENV.JEV_MODEL,
          scores: guard.scores,
          isAllowed: guard.isAllowed,
          needsResearch: guard.needsResearch,
          route: guard.needsResearch ? "Deep Research" : "Chit-chat",
          targetModel: guard.needsResearch ? "gpt-4.1-mini (Temporal)" : "groq-openai/gpt-oss-120b",
        });

        // If guardrail blocked:
        if (!guard.isAllowed) {
          sendEvent("result", {
            status: "GUARDRAIL_BLOCKED",
            prompt,
            answer: guard.rejectionReason || "Request blocked by safety guardrails.",
            sourcesCount: 0,
            durationSeconds: 1,
            metadata: { scores: guard.scores },
          });
          sendEvent("done", { success: false });
          res.end();
          return;
        }

        // Step 2: Chit-Chat / Direct Question -> Direct Groq Answer in 1-2s (No Temporal Worker!)
        if (!guard.needsResearch) {
          sendEvent("progress", {
            step: "Conversational question detected. Generating direct answer via Groq...",
          });
          const directAns = await answerDirect(prompt, { scores: guard.scores });
          sendEvent("result", directAns);
          sendEvent("done", { success: true });
          res.end();
          return;
        }

        // Step 3: Deep Research -> Start Temporal Workflow
        sendEvent("progress", {
          step: "Dispatching deep research workflow to Temporal Cluster...",
        });
        const { workflowId, handle } = await startResearchWorkflow({
          prompt,
          sessionId: "ui-sse",
        });

        sendEvent("temporal_dispatched", { workflowId });
        sendEvent("progress", {
          step: `Temporal workflow running [${workflowId}]. Synthesizing research...`,
        });

        // Poll events periodically to stream progress updates
        const pollInterval = setInterval(async () => {
          try {
            const events = await getWorkflowEvents(workflowId);
            if (events && events.length > 0) {
              const lastEvent = events[events.length - 1];
              sendEvent("progress", { step: lastEvent.message, details: lastEvent.details });
            }
          } catch {}
        }, 3000);

        try {
          const finalResult = await handle.result();
          clearInterval(pollInterval);
          sendEvent("result", finalResult);
          sendEvent("done", { success: true });
        } catch (execErr: any) {
          clearInterval(pollInterval);
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

if (process.argv[1]?.endsWith("ui-server.ts") || process.argv[1]?.endsWith("ui-server.js")) {
  uiServer.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🎨 Deep Research Web UI`);
    console.log(`🌐 Frontend running at: http://localhost:${PORT}`);
    console.log(`💬 Realtime SSE API:    http://localhost:${PORT}/api/chat-sse`);
    console.log(`======================================================\n`);
  });
}
