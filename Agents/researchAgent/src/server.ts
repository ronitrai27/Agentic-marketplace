import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateInputGuardrail } from "./guardrail/jev-guard.js";
import { runResearchAgent } from "./index.js";
import { tasks } from "@trigger.dev/sdk";
import { ENV } from "./config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = process.env.PORT || 3005;

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
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // 1. Handle Real-time SSE Chat API
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
  console.log(`🚀 Research Agent UI running at: http://localhost:${PORT}`);
  console.log(`Realtime SSE Endpoint: http://localhost:${PORT}/api/chat-sse`);
  console.log(`======================================================\n`);
});
