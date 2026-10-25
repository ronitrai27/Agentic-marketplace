# 🐾 Catelog SDK — The Beginner Developer Guide

> **Learn how to build, stream, and publish production-grade AI Marketplace Agents in under 5 minutes.**

---

## 1. What is Catelog?

**Catelog** is the official TypeScript SDK for the **Marketplace Agent Protocol Specification (MAPS)**.

In simple terms: **it turns your AI code into an autonomous microservice** that can be discovered, tested, and called on the AI Agent Marketplace.

When you wrap your AI agent with Catelog, the SDK automatically gives you:
- 🩺 **`/health`** — Liveness probe and health monitoring
- 📋 **`/schema`** — Self-describing agent manifest (auto-generates marketplace forms using Zod)
- ⚡ **`/execute`** — Authenticated execution supporting both **Sync**, **Async (Background)**, and **Live SSE Streaming**
- ⏳ **`/tasks/:id`** — Polling endpoint for long-running background tasks with live progress events
- 🔐 **Zero-config Security** — Built-in Bearer auth and HMAC signatures for production, with painless local dev mode
- 📡 **Native SSE Protocol** — Canonical task event streams (`task.status`, `task.progress`, `task.activity`, `task.delta`, `task.completed`)

---

## 2. Installation & Quick Setup

### Step 1: Install the SDK
Catelog works with modern Node.js (18+), Bun, or Deno. In your project directory:

```bash
# Using pnpm (recommended)
pnpm add catelog zod

# Using npm
npm install catelog zod

# Using yarn
yarn add catelog zod
```

> 💡 **Note:** `zod` is optional but strongly recommended. It gives you automatic TypeScript typing, runtime input validation, and lets the Marketplace UI render input forms for your users automatically.

### Step 2: Configure ESM in `package.json`
Catelog is a modern pure ESM package. Make sure your `package.json` includes:

```json
{
  "name": "my-first-agent",
  "type": "module"
}
```

### Step 3: Add Your Environment Keys
Create a `.env` file in the root of your project:

```env
# Catelog Marketplace API Keys
CATELOG_SECRET_KEY=cat_sec_live_c67619ac727df612b50a6cb1be786046929dc48bf8b8daeca44556e91e5be7e1
CATELOG_PUBLIC_KEY=cat_pub_live_21030fbabcbe3b8a1b8a09dd
```

> 🌟 **Dev Mode Tip:** When developing locally without keys, Catelog automatically runs in permissive **dev mode** with no authentication required, so you can test immediately.

---

## 3. Your First Agent in 5 Lines of Code

Here is the simplest possible Catelog agent:

```ts
import { createAgent } from "catelog";

const agent = createAgent({
  name: "Greeter Agent",
  async execute({ input }) {
    return { reply: `Hello, ${(input as any).prompt || "World"}!` };
  },
});

// Starts the server on port 3000
agent.listen(3000);
```

Run this file with `npx tsx agent.ts`. You will see the Catelog startup banner:
```
================================================================================
🤖 Catelog Marketplace Agent running live on port 3000
📡 Endpoints: /health | /schema | /execute | /tasks/:id
================================================================================
```

---

## 4. Understanding Execution Modes: Sync vs Async

Every AI task is different. Some finish in 1 second; others take 45 seconds to crawl websites or run Temporal workflows. Catelog supports both:

| Mode | Best For | What `/execute` Returns |
| :--- | :--- | :--- |
| **`sync`** (Default) | Fast LLM chats, quick translations, single API calls (< 15s) | Direct HTTP/SSE stream containing the answer in the same connection |
| **`async`** | Deep research, SEO audits, Temporal workflows, web scraping (> 15s) | HTTP `202 Accepted` immediately with a `poll_url: /tasks/:run_id` |
| **`conversational`** | Human-in-the-loop workflows where the agent needs follow-up confirmation | `task.input_required` SSE event via `ctx.needInput()` |

### Is SEO Agent Async?
**Yes!** A full SEO audit runs static HTML parsing, Firecrawl deep markdown scrapes, Browserbase browser sessions, and Google PageSpeed tests. Because this takes 15–40 seconds, setting `mode: "async"` prevents gateway/browser timeouts and allows the caller to poll `/tasks/:id` to receive buffered progress events in real-time.

---

## 5. Adding Real-Time SSE Streaming

Catelog provides a built-in `stream` object in every `execute` function. You can use it to send live updates to your users while your agent works:

```ts
async execute({ input, stream }) {
  // 1. Status step updates
  stream.step("Analyzing the prompt...");

  // 2. Progress percentage (0 - 100)
  stream.progress(25, "Searching Google ground truth...");

  // 3. Structured tool/activity events
  stream.activity("web_search", { query: input.prompt, resultsFound: 5 });

  stream.progress(75, "Synthesizing answer with AI model...");

  // 4. Token-by-token streaming delta (text chunk)
  stream.delta("Here is the answer: ");
  stream.delta("Technical SEO is optimized!");

  stream.progress(100, "Done");

  return { answer: "Completed audit" };
}
```

### The Catelog SSE Protocol Contract:
When a client connects with `Accept: text/event-stream`, Catelog emits clean standard events:
- `event: task.status` — e.g. `{"status":"working"}`
- `event: task.progress` — e.g. `{"percent":50,"message":"Ingesting HTML..."}`
- `event: task.activity` — e.g. `{"activity_type":"temporal_dispatched","data":{...}}`
- `event: task.delta` — e.g. `{"content":"chunk","delta_type":"text"}`
- `event: task.completed` — e.g. `{"output":{...},"duration_ms":1420}`

---

## 6. Defining Clean Input & Output Schemas with Zod

By keeping your schemas clean and natural, the agent can output its full rich response freely without breaking on strict types:

```ts
import { z } from "zod";
import { createAgent } from "catelog";

// Clean, simple input: user can just type their prompt or supply a URL
const InputSchema = z.object({
  prompt: z
    .string()
    .describe("Natural language prompt or query"),
  url: z
    .string()
    .optional()
    .describe("Website URL to analyze"),
  forceBrowser: z
    .boolean()
    .default(false)
    .optional()
    .describe("Force headless browser execution"),
});

// Non-restrictive output: rich report + optional high-level metrics
const OutputSchema = z.object({
  status: z.string().default("COMPLETED").describe("Execution status"),
  report: z.string().describe("Comprehensive AI report in Markdown"),
  targetUrl: z.string().optional().describe("Analyzed target"),
  metrics: z
    .record(z.any())
    .optional()
    .describe("Key verified scores and metrics"),
});

export const agent = createAgent({
  id: "my-smart-agent",
  name: "My Smart Agent",
  version: "1.0.0",
  mode: "async", // or "sync"
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute({ input, stream }) {
    stream.step("Processing input...");
    // Your AI logic here
    return {
      status: "COMPLETED",
      report: "### Executive Analysis\nEverything looks great!",
      metrics: { score: 95 },
    };
  },
});
```

---

## 7. Mounting Catelog into an Existing Server

If you already have an existing Node.js HTTP server or Express app (like `SeoAgent` or `researchAgent2`), you don't need a separate port! Just forward the MAPS routes to `agent.handleRequest(req, res)`:

```ts
import http from "node:http";
import { agent } from "./catelog-agent.js";

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Catelog MAPS protocol endpoints:
  if (
    ["/health", "/schema", "/execute"].includes(url.pathname) ||
    url.pathname.startsWith("/tasks/")
  ) {
    return agent.handleRequest(req, res);
  }

  // Your existing Web UI routes:
  if (url.pathname === "/") {
    res.end("<h1>My Agent Web UI</h1>");
  }
});

server.listen(3000);
```

---

## 8. How to Test Your Agent Locally

You can test your agent using standard `curl` commands in your terminal:

### 1. Check Health Probe (`GET /health`)
```bash
curl http://localhost:3000/health
```

### 2. View Agent Manifest (`GET /schema`)
```bash
curl http://localhost:3000/schema
```

### 3. Execute with Bearer Secret Key (`POST /execute`)
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cat_sec_live_c67619ac727df612b50a6cb1be786046929dc48bf8b8daeca44556e91e5be7e1" \
  -d '{"input": {"prompt": "Audit https://stripe.com for technical SEO"}}'
```

### 4. Poll Live Events (`GET /tasks/:id`)
```bash
curl http://localhost:3000/tasks/run-4ac3e9b7
```

---

## 9. Summary Cheatsheet

| Helper / Feature | What it does | Example |
| :--- | :--- | :--- |
| `createAgent({...})` | Factory that sets up an agent instance | `const agent = createAgent({ name: "...", execute })` |
| `mode: "async"` | Handles long-running jobs (Temporal, crawling) | Returns `202 Accepted` + `/tasks/:id` polling |
| `stream.step(msg)` | Emits a human-readable stage label | `stream.step("Validating links...")` |
| `stream.progress(pct, msg)` | Emits percentage progress (0 - 100) | `stream.progress(50, "Crawl 50% complete")` |
| `stream.activity(name, data)` | Emits structured telemetry & tool calls | `stream.activity("ground_truth", { rank: 1 })` |
| `stream.delta(text)` | Streams text chunks / tokens | `stream.delta("First paragraph of report...")` |
| `agent.listen(port)` | Starts standalone HTTP server | `agent.listen(3000)` |
| `agent.handleRequest(req, res)` | Mounts into existing Node server | Use inside `http.createServer()` |
