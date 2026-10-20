import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY;
if (!apiKey) {
  console.error("❌ Warning: OPENAI_API_KEY or OPENAPI_KEY not found in .env");
}

const client = new OpenAI({ apiKey: apiKey || "" });

const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT) || 3001;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Chat Endpoint
  if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      let prompt = "";
      let mode = "fast"; // "fast" | "deep"

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

      // Initialize SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
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
          });

          const durationMs = Date.now() - startTime;
          sendEvent("done", {
            output: response.output_text,
            model: "gpt-6-luna",
            mode: "fast",
            durationMs,
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
          });

          sendEvent("status", {
            phase: "dispatched",
            taskId: response.id,
            status: response.status,
            model: "gpt-5.4-mini",
            message: `Background task started [${response.id}] with status: ${response.status}`,
          });

          // Polling loop
          while (response.status === "queued" || response.status === "in_progress") {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            sendEvent("status", {
              phase: "polling",
              taskId: response.id,
              status: response.status,
              elapsedSeconds: elapsed,
              message: `Deep reasoning & searching in background... (${elapsed}s elapsed, status: ${response.status})`,
            });

            await new Promise((resolve) => setTimeout(resolve, 2000));
            response = await client.responses.retrieve(response.id);
          }

          const durationMs = Date.now() - startTime;
          if (response.status === "completed") {
            sendEvent("done", {
              output: response.output_text,
              model: "gpt-5.4-mini",
              mode: "deep",
              taskId: response.id,
              durationMs,
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

  // Serve static files from public/
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);

  // Security check: avoid directory traversal
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
  console.log(`\n======================================================`);
  console.log(`🚀 Research Agent 2 UI running at: http://localhost:${PORT}`);
  console.log(`💬 Open the URL in your browser to test!`);
  console.log(`======================================================\n`);
});
