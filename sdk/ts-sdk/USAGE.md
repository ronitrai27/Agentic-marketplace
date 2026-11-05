# Catelog SDK — Usage Guide

> **Node.js 18+ · TypeScript 5+ · ESM + CommonJS**

---

## Table of Contents

1. [Installation](#1-installation)
2. [Environment Setup](#2-environment-setup)
3. [The Minimal Agent](#3-the-minimal-agent)
4. [Agent Types](#4-agent-types)
   - [Sync Agent](#41-sync-agent--fast-direct-response)
   - [Async Agent](#42-async-agent--long-running-background-jobs)
   - [Conversational Agent](#43-conversational-agent--multi-turn--hitl)
5. [Framework Integrations](#5-framework-integrations)
   - [OpenAI SDK](#51-openai-sdk)
   - [Vercel AI SDK](#52-vercel-ai-sdk)
   - [LangGraph / LangChain](#53-langgraph--langchain)
   - [CrewAI / Custom Generators](#54-crewaicustom-async-generator)
   - [Vanilla TypeScript](#55-vanilla-typescript-no-framework)
   - [Claude Agent SDK](#56-claude-agent-sdk)
   - [Do I need a separate server?](#57-do-i-need-a-separate-server)
6. [Streaming Helpers](#6-streaming-helpers)
7. [Schema Definition](#7-schema-definition)
8. [API Keys](#8-api-keys)
9. [Telemetry & Logging](#9-telemetry--logging)
10. [What You Get — Endpoints](#10-what-you-get--endpoints)
11. [Testing Locally](#11-testing-locally)
12. [Registering on the Marketplace](#12-registering-on-the-marketplace)
13. [Error Handling](#13-error-handling)
14. [Production Options](#14-production-options)
15. [CLI](#15-cli)

---

## 1. Installation

```bash
# pnpm (recommended)
pnpm add catelog zod

# npm
npm install catelog zod

# yarn
yarn add catelog zod

# bun
bun add catelog zod
```

> CommonJS projects can use `const { createAgent } = require("catelog")`. After installing, run `npx catelog init` to add a short setup guide to your project (see [CLI](#15-cli)).

> **Note:** `zod` is optional. Only needed if you want typed input validation and auto-generated marketplace forms. If you skip it, the SDK accepts any JSON payload.

---

## 2. Environment Setup

Create a `.env` file in your project root:

```env
# Required for production authentication
CATELOG_SECRET_KEY=cat_sec_live_your_secret_key_here

# Optional — used for public/read-only endpoint auth
CATELOG_PUBLIC_KEY=cat_pub_live_your_public_key_here

# Optional — telemetry reporting endpoint
CATELOG_TELEMETRY_URL=https://telemetry.catelog.io/ingest

# Optional — disable telemetry entirely
CATELOG_TELEMETRY_DISABLED=false

# Optional — silence the startup banner
CATELOG_SILENT=false

# Standard Node.js — controls dev/production behavior
NODE_ENV=development
```

The SDK auto-reads all of these. You never need to pass them manually in code.

> **In development** (`NODE_ENV=development`), you can skip all keys entirely. The SDK runs in permissive dev mode and logs a warning.

---

## 3. The Minimal Agent

The absolute minimum to publish a working agent:

```ts
import { createAgent } from "catelog";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Hello World",
  async execute({ input }) {
    return { message: `Hello, ${(input as any).name ?? "world"}!` };
  },
});

agent.listen(3000);
```

That's it. You get:
- ✅ `GET /health` — ping probe with capabilities
- ✅ `GET /schema` — auto-generated agent manifest
- ✅ `POST /execute` — authenticated execution endpoint
- ✅ SSE streaming with heartbeat keep-alives
- ✅ Dev mode auth (no keys required in development)
- ✅ Beautiful terminal startup banner

---

## 4. Agent Types

Choose the execution mode that matches your agent's behavior.

---

### 4.1 Sync Agent — Fast, Direct Response

**Best for:** Tool calls, Q&A, text generation, summarization, search — anything that completes within ~30 seconds.

**How it works:** The client opens a connection, the agent streams events, and the connection closes when the task completes.

```ts
import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Web Summarizer",
  mode: "sync", // default — can be omitted

  inputSchema: z.object({
    url: z.string().url().describe("The URL to summarize"),
  }),

  outputSchema: z.object({
    title: z.string(),
    summary: z.string(),
    readingTimeMinutes: z.number(),
  }),

  async execute({ input, stream, log, signal }) {
    // Emit progress — does NOT complete the task
    stream.progress(10, "Fetching page content...");
    log.info("Fetching URL", { url: input.url });

    const html = await fetch(input.url, { signal }).then((r) => r.text());

    stream.progress(50, "Summarizing with AI...");
    // stream.delta() pipes text live to the buyer UI
    stream.delta("Analyzing page structure...\n");

    const summary = await summarizeWithAI(html, { signal });

    stream.progress(90, "Formatting output...");
    stream.delta(summary);

    // return completes the task automatically
    return {
      output: {
        title: "Example Page",
        summary,
        readingTimeMinutes: Math.ceil(summary.split(" ").length / 200),
      },
    };
  },
});

agent.listen(3000);
```

**What the marketplace receives:**

```
task.status      → "working" (automatic on start)
task.progress    → 10%, "Fetching page content..."
task.progress    → 50%, "Summarizing with AI..."
task.delta       → "Analyzing page structure..."
task.delta       → "The page covers..."
task.progress    → 90%, "Formatting output..."
task.completed   → { title, summary, readingTimeMinutes } + telemetry
```

---

### 4.2 Async Agent — Long-Running Background Jobs

**Best for:** Deep research, PDF generation, web scraping, multi-agent workflows — anything that takes more than 30 seconds or risks hitting HTTP gateway timeouts.

**How it works:** The SDK immediately returns `202 Accepted` with a job ID. The marketplace polls `GET /tasks/:id` until the job completes. You write normal `async/await` code — the SDK handles the polling infrastructure.

```ts
import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Deep Research Agent",
  mode: "async",

  inputSchema: z.object({
    topic: z.string().describe("Research topic or company name"),
    depth: z.enum(["quick", "deep", "comprehensive"]).default("deep"),
  }),

  outputSchema: z.object({
    report: z.string(),
    sources: z.array(z.string()),
    wordCount: z.number(),
  }),

  async execute({ input, stream, log }) {
    // The client already has the 202 + job ID
    // Live events are automatically recorded in a ring buffer for GET /tasks/:id:
    stream.step("Initializing deep research vectors...");
    stream.progress(10, "Crawling targeted web sources...");
    log.info("Starting deep research", { topic: input.topic, depth: input.depth });

    const sources = await crawlAndScrape(input.topic); // May take minutes
    stream.progress(60, `Synthesizing ${sources.length} sources with LLM...`);

    const report = await generateReport(sources, input.depth);
    stream.progress(100, "Research compiled.");

    log.info("Research complete", { sources: sources.length });

    return {
      output: {
        report,
        sources: sources.map((s) => s.url),
        wordCount: report.split(" ").length,
      },
      telemetry: {
        model_used: "gpt-4o",
        llm_tokens: { prompt: 8500, completion: 3500, total: 12000 },
        cost_usd: 0.052,
      },
    };
  },
});

agent.listen(3000);
```

**The request / response cycle (Live Event-Enriched Polling):**

```
POST /execute
→ 202 Accepted
  { "run_id": "run_abc", "status": "working", "poll_url": "/tasks/run_abc" }

GET /tasks/run_abc?since=0 (marketplace polls every 2-3s with ?since cursor)
→ 200 {
    "status": "working",
    "elapsed_ms": 5200,
    "current_step": "Crawling targeted web sources...",
    "progress_pct": 10,
    "events": [
      { "seq": 1, "type": "step", "timestamp": 172975..., "message": "Initializing deep research vectors..." },
      { "seq": 2, "type": "progress", "timestamp": 172975..., "percent": 10, "message": "Crawling targeted web sources..." }
    ],
    "last_seq": 2
  }

GET /tasks/run_abc?since=2 (when finished)
→ 200 {
    "status": "completed",
    "duration_ms": 14200,
    "current_step": "Research compiled.",
    "progress_pct": 100,
    "events": [
      { "seq": 3, "type": "progress", "timestamp": 172975..., "percent": 60, "message": "Synthesizing sources..." },
      { "seq": 4, "type": "progress", "timestamp": 172975..., "percent": 100, "message": "Research compiled." }
    ],
    "last_seq": 4,
    "output": { "report": "...", "sources": [...], "wordCount": 4200 },
    "telemetry": {
      "model_used": "gpt-4o",
      "llm_tokens": { "prompt": 8500, "completion": 3500, "total": 12000 },
      "cost_usd": 0.052,
      "duration_ms": 14200
    }
  }
```

---

### 4.3 Conversational Agent — Multi-Turn & HITL

**Best for:** Document assistants, workflow agents, code review bots, or any agent that needs to ask the user a clarifying question mid-run before proceeding.

**How it works:** The agent calls `needInput({...})` (from the `execute` context) to suspend execution and emit a `task.input_required` SSE event with a resume token. The marketplace shows a form to the buyer. When the buyer submits, the agent is re-invoked with the resume token and the previous session state intact.

```ts
import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "SQL Query Assistant",
  mode: "conversational",

  inputSchema: z.object({
    question: z.string().describe("What would you like to know?"),
    // resume fields — optional, provided on second invocation
    selectedTable: z.string().optional(),
  }),

  async execute({ input, needInput, session, stream, log }) {
    // ── First invocation: user sends { question: "show me orders" } ──
    if (!input.selectedTable) {
      stream.progress(20, "Checking available tables...");
      const tables = await getAvailableTables();
      log.info("Tables discovered", { count: tables.length });

      // Suspend and ask for input — does NOT complete the task
      return needInput({
        prompt: `I found ${tables.length} tables. Which one would you like to query?`,
        schema: {
          type: "object",
          properties: {
            selectedTable: {
              type: "string",
              enum: tables,
              description: "Choose the table to query",
            },
          },
          required: ["selectedTable"],
        },
      });
    }

    // ── Second invocation: user submits { question: "...", selectedTable: "orders" } ──
    stream.progress(30, `Querying ${input.selectedTable}...`);
    log.info("Querying table", { table: input.selectedTable });

    const results = await runQuery(input.selectedTable, input.question);

    // Session state is available across turns
    const previousQueries = session.get<string[]>("queryHistory") ?? [];
    session.set("queryHistory", [...previousQueries, input.question]);

    stream.delta(`Found ${results.length} records in ${input.selectedTable}.\n`);

    return {
      output: {
        table: input.selectedTable,
        rowCount: results.length,
        preview: results.slice(0, 5),
      },
    };
  },
});

agent.listen(3000);
```

**The SSE event flow:**

```
First invocation:
  task.status → "working"
  task.progress → 20%, "Checking available tables..."
  task.input_required → { prompt: "...", resume_token: "resume_abc", input_schema: {...} }

  [Marketplace shows a form to the buyer]
  [Buyer selects "orders" and submits]

Second invocation (resume):
  POST /execute { input: { question: "...", selectedTable: "orders" }, resume_token: "resume_abc" }
  task.status → "working"
  task.progress → 30%, "Querying orders..."
  task.delta → "Found 142 records..."
  task.completed → { table: "orders", rowCount: 142, preview: [...] }
```

---

## 5. Framework Integrations

The SDK provides one-line adapter functions that translate framework-specific streaming into Catelog's task event protocol.

---

### 5.1 OpenAI SDK

Works with both streaming and non-streaming completions. Automatically extracts token usage.

```ts
import OpenAI from "openai";
import { createAgent, pipeOpenAiStream } from "catelog";
import { z } from "zod";

const openai = new OpenAI(); // Uses OPENAI_API_KEY from env

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "OpenAI Analyst",
  inputSchema: z.object({
    prompt: z.string(),
    model: z.enum(["gpt-4o", "gpt-4o-mini"]).default("gpt-4o-mini"),
  }),

  async execute({ input, stream, signal }) {
    stream.progress(10, "Calling OpenAI...");

    // Streaming chat completion
    const openaiStream = await openai.chat.completions.create({
      model: input.model,
      messages: [{ role: "user", content: input.prompt }],
      stream: true,
      // Optional: get token counts in final chunk
      stream_options: { include_usage: true },
    });

    // One line: pipes chunks → task.delta, extracts token usage → telemetry
    return pipeOpenAiStream(openaiStream, stream);
    // Returns: { output: { text: "..." }, telemetry: { llm_tokens: {...}, model_used: "..." } }
  },
});

agent.listen(3000);
```

**What you get from the adapter:**
- Each `choices[0].delta.content` chunk → emitted as `task.delta`
- Tool calls in stream → emitted as `task.activity` events
- Final `usage` chunk → captured as `telemetry.llm_tokens`
- Model name → captured as `telemetry.model_used`

Using the Responses API (e.g. built-in web search)? Use `pipeOpenAiResponsesStream(await openai.responses.create({ model, input, tools: [{ type: "web_search" }] }), stream)`. It emits `web_search` activity events and token telemetry.

---

### 5.2 Vercel AI SDK

Works with `streamText`, `generateText`, `streamObject`, and any Vercel AI provider (OpenAI, Anthropic, Google, etc.).

```ts
import { streamText, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { createAgent, pipeAiSdkStream } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Vercel AI Coding Assistant",
  inputSchema: z.object({
    prompt: z.string(),
    provider: z.enum(["openai", "anthropic"]).default("openai"),
  }),

  async execute({ input, stream, signal }) {
    stream.progress(10, "Generating response...");

    // Works with any Vercel AI provider
    const model = input.provider === "anthropic"
      ? anthropic("claude-3-5-sonnet-20241022")
      : openai("gpt-4o");

    // Streaming mode
    const result = streamText({
      model,
      prompt: input.prompt,
      abortSignal: signal, // Propagate cancellation
    });

    // One line: pipes textStream → task.delta, extracts usage → telemetry
    return pipeAiSdkStream(result, stream);
  },
});

agent.listen(3000);
```

**What you get from the adapter:**
- Each text chunk → emitted as `task.delta`
- Final `usage` object → captured as `telemetry.llm_tokens`
- Tool calls → captured as `telemetry.framework.tool_calls`

---

### 5.3 LangGraph / LangChain

Works with compiled LangGraph graphs. Translates node transitions to `task.activity` events and message content to `task.delta`.

```ts
import { createAgent, pipeLangGraphStream } from "catelog";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// Build your LangGraph normally
const GraphState = Annotation.Root({ messages: Annotation<string[]>() });
const llm = new ChatOpenAI({ model: "gpt-4o-mini" });

const graph = new StateGraph(GraphState)
  .addNode("research", async (state) => { /* ... */ })
  .addNode("synthesize", async (state) => { /* ... */ })
  .addEdge("__start__", "research")
  .addEdge("research", "synthesize")
  .compile();

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "LangGraph Research Pipeline",
  inputSchema: z.object({
    topic: z.string(),
  }),

  async execute({ input, stream, signal }) {
    stream.progress(5, "Starting graph...");

    // One line: runs graph, emits node transitions as task.activity
    return pipeLangGraphStream(
      graph,
      { messages: [input.topic] },
      stream,
      { signal }
    );
  },
});

agent.listen(3000);
```

**What you get from the adapter:**
- Each graph node entry → emitted as `task.activity` with `{ node: "research", step: 1 }`
- Message content from nodes → emitted as `task.delta`
- Visited nodes list → captured in `telemetry.framework.nodes_visited`

---

### 5.4 CrewAI / Custom Async Generator

For any framework that doesn't have a built-in adapter, use `pipeAsyncIterableStream`. This works with CrewAI agents, LlamaIndex, custom generators, or any `AsyncIterable<string>`.

```ts
import { createAgent, pipeAsyncIterableStream } from "catelog";
import { z } from "zod";

// Example: a custom async generator (replace with your framework)
async function* myCrewAiAgent(input: string): AsyncGenerator<string> {
  yield "Agent 1 is researching...\n";
  await new Promise((r) => setTimeout(r, 1000));
  yield "Agent 2 is writing the report...\n";
  await new Promise((r) => setTimeout(r, 1000));
  yield `Final report on: ${input}\n`;
}

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "CrewAI Research Crew",
  inputSchema: z.object({
    topic: z.string(),
  }),

  async execute({ input, stream }) {
    stream.progress(10, "Spinning up the crew...");

    // Pipe any async iterable directly — works with CrewAI, LlamaIndex, etc.
    return pipeAsyncIterableStream(
      myCrewAiAgent(input.topic),
      stream
    );
  },
});

agent.listen(3000);
```

---

### 5.5 Vanilla TypeScript (No Framework)

No framework? No problem. Use the stream helpers directly.

```ts
import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Custom Logic Agent",
  inputSchema: z.object({
    data: z.array(z.number()),
    operation: z.enum(["sum", "avg", "max"]),
  }),

  async execute({ input, stream, log, metric, signal }) {
    log.info("Running computation", { operation: input.operation });
    stream.progress(10, `Computing ${input.operation}...`);

    let result: number;
    switch (input.operation) {
      case "sum": result = input.data.reduce((a, b) => a + b, 0); break;
      case "avg": result = input.data.reduce((a, b) => a + b, 0) / input.data.length; break;
      case "max": result = Math.max(...input.data); break;
    }

    // Track custom metrics
    metric.count("numbers_processed", input.data.length);
    metric.gauge("result_value", result);

    stream.progress(100, "Done!");
    stream.delta(`The ${input.operation} of ${input.data.length} numbers is: ${result}`);

    return { output: { result, operation: input.operation } };
  },
});

agent.listen(3000);
```

---

### 5.6 Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` runs Claude with built-in tools (`WebSearch`, `WebFetch`, `Read`, `Bash`...). One line connects it to Catelog:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createAgent, pipeClaudeAgentStream } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Claude Researcher",
  mode: "async",                                     // Claude runs take 10-60s
  inputSchema: z.object({ prompt: z.string() }),

  async execute({ input, stream, signal, metric }) {
    const run = query({
      prompt: input.prompt,
      options: {
        model: "claude-haiku-5-5",                    // cheap model
        tools: ["WebSearch", "WebFetch"],
        allowedTools: ["WebSearch", "WebFetch"],
        permissionMode: "dontAsk",
        settingSources: [], persistSession: false,
        maxTurns: 10, maxBudgetUsd: 0.15,             // hard spend cap per run
      },
    });

    return pipeClaudeAgentStream(run, stream, {
      signal,                                         // client gone / timeout => query.interrupt()
      onUsage: (t) => metric.gauge("cost_usd", t.cost_usd ?? 0),   // optional: cost kept even on failure
    });
    // => { output: { text: "..." }, telemetry: { model_used, llm_tokens, cost_usd, framework: {...} } }
  },
});

agent.listen(3000);
```

**What you get from the adapter:**
- Each tool call (`WebSearch`, `Read`...) → `task.activity` + a `task.progress` step
- Assistant text → `task.delta`
- `total_cost_usd`, per-model tokens, model name, turns, per-tool counts → `telemetry`
- Aborting `signal` → `query.interrupt()`, so a cancelled run stops spending money
- Failures → thrown errors with a Catelog `code` + `retryable`:

| Claude Agent SDK problem | Catelog error code | Retryable |
| :--- | :--- | :---: |
| `rate_limit`, `overloaded` | `MODEL_RATE_LIMIT` | yes |
| `server_error` | `UPSTREAM_TIMEOUT` | yes |
| `error_max_budget_usd` | `BUDGET_EXCEEDED` | no |
| `error_max_turns` | `TOOL_FAILURE` | yes |
| bad structured output | `INTERNAL_CRASH` | yes |
| `authentication_failed`, `billing_error` | `MODEL_AUTH_FAILED`, `MODEL_BILLING_ERROR` | no |

**Typed JSON output instead of text:**

```ts
const Out = z.object({
  response: z.string(),
  jobs: z.array(z.object({ title: z.string(), company: z.string(), url: z.string() })),
});
// The Claude CLI rejects the "$schema" key that zod emits, so strip it.
const { $schema, ...schema } = z.toJSONSchema(Out) as Record<string, unknown>;

// in execute():
const run = query({ prompt, options: { /* ...as above... */ outputFormat: { type: "json_schema", schema } } });
return pipeClaudeAgentStream(run, stream, { signal, parse: (v) => Out.parse(v) });   // => { output: Out, telemetry }
```

**Adapter options**

| Option | Purpose |
| :--- | :--- |
| `signal` | Pass `ctx.signal`; abort calls `query.interrupt()` |
| `parse` | Validate/shape the structured output (e.g. `Out.parse`) |
| `onUsage` | Called with final telemetry on success *and* failure |
| `hideTools` | Internal tools not shown as activity (default `["StructuredOutput"]`) |

A complete example lives in `Agents/JobFitAgent/`.

---

### 5.7 Do I need a separate server?

**No.** `catelog` *is* the server. Choose one:

| You have... | Do this |
| :--- | :--- |
| A new agent | `agent.listen(3000)` is the whole server |
| An existing Express / Fastify / `http` / Next.js server | `agent.handleRequest(req, res)` inside it. Same port, same process |

A `server.ts` is just a file where you call `createAgent()` + `listen()`. You can put it in your existing entry file.

```ts
import express from "express";
import { agent } from "./my-agent.js";

const app = express();
app.get("/", (_req, res) => res.send("my existing app"));

// Serves /agent/health, /agent/schema, /agent/execute, /agent/tasks/:id
app.use("/agent", (req, res) => agent.handleRequest(req, res));
app.use(express.json());          // your own body parser goes AFTER the agent mount

app.listen(3000);
```

> **Gotcha:** `handleRequest` reads the raw body itself. A body parser such as `express.json()` placed **before** the mount consumes the stream and `/execute` will hang. Mount the agent first, or apply the parser only to your own routes.

Register the URL that serves `/health` and `/schema` (here `https://your-host/agent`) on the marketplace.

---

## 6. Streaming Helpers

All of these are available on the `stream` object inside `execute()`:

| Method | Signature | What It Does | Completes Task? |
| :--- | :--- | :--- | :---: |
| `stream.progress()` | `(percent: number, message?: string)` | Emits a `task.progress` event for the progress bar | No |
| `stream.delta()` | `(text: string, type?: "text" \| "json_patch")` | Emits a `task.delta` event — live text token | No |
| `stream.write()` | `(text: string)` | Alias for `stream.delta(text)` | No |
| `stream.activity()` | `(type: string, data?: object)` | Emits a `task.activity` event (tool calls, etc.) | No |
| `stream.step()` | `(label: string)` | Legacy alias — maps to `stream.progress(0, label)` | No |
| `stream.emit()` | `(event: string, data: unknown)` | Raw SSE event emitter | No |
| `stream.isClosed()` | `() => boolean` | Check if client disconnected | — |
| `return value` | any | Completes the task with output | **Yes** |
| `throw error` | Error | Fails the task | **Yes** |
| `needInput()` | `(opts)` | Suspends with input-required | **Yes** |

---

## 7. Schema Definition

Schemas are **optional** but recommended for marketplace listings. They generate the buyer input form and validate payloads at the gateway.

### With Zod (Recommended)

```ts
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Research Agent",
  inputSchema: z.object({
    query: z.string().min(3).describe("The research question"),
    maxSources: z.number().min(1).max(20).default(5).describe("Max sources to cite"),
    language: z.enum(["en", "es", "fr", "de"]).default("en"),
  }),
  outputSchema: z.object({
    report: z.string(),
    sources: z.array(z.string().url()),
    language: z.string(),
  }),
  async execute({ input }) {
    // input is fully typed: { query: string, maxSources: number, language: string }
    return { output: { report: "...", sources: [], language: input.language } };
  },
});
```

### With Raw JSON Schema

```ts
const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Data Agent",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 3, description: "The research question" },
      maxSources: { type: "number", minimum: 1, maximum: 20, default: 5 },
    },
    required: ["query"],
  },
  async execute({ input }) { /* ... */ },
});
```

### Without Schema (Accepts Any JSON)

```ts
const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Flexible Agent",
  // No inputSchema or outputSchema — accepts any JSON
  async execute({ input }) {
    return { output: { received: input } };
  },
});
```

---

## 8. API Keys

### Where Keys Come From

Your Catelog dashboard generates two keys per workspace:

| Key | Format | Purpose |
| :--- | :--- | :--- |
| **Secret key** | `cat_sec_live_...` | Authenticates `/execute` calls |
| **Publishable key** | `cat_pub_live_...` | Safe to use in frontend code for `/health` and `/schema` |

### Setting Keys

Put them in your `.env` — the SDK auto-reads them:

```env
CATELOG_SECRET_KEY=cat_sec_live_your_key_here
CATELOG_PUBLIC_KEY=cat_pub_live_your_key_here
```

Or pass them explicitly in the constructor:

```ts
const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "My Agent",
  secretKey: "cat_sec_live_your_key_here",
  publicKey: "cat_pub_live_your_key_here",
  async execute({ input }) { /* ... */ },
});
```

### How Authentication Works

| Caller | Auth Method | Header |
| :--- | :--- | :--- |
| **Marketplace Gateway** | HMAC-SHA256 (automatic) | `X-Marketplace-Signature: ...` |
| **Your curl / Postman** | Bearer secret key | `Authorization: Bearer cat_sec_live_...` |
| **Your frontend app** | Bearer public key | `Authorization: Bearer cat_pub_live_...` |
| **Local development** | None (dev mode) | *(no header required)* |

In development, you don't need any keys. The SDK runs in permissive mode and logs a warning.

---

## 9. Telemetry & Logging

### Structured Logging

A `log` helper is available inside every `execute()`:

```ts
async execute({ input, log }) {
  log.info("Processing request", { query: input.query });
  log.warn("Rate limit approaching", { remaining: 10 });
  log.error("Failed to fetch", { url: "https://...", status: 429 });
  log.debug("Cache hit", { key: "results:abc" }); // Only in development
}
```

Output is color-coded by level with run ID prefix. Debug logs are suppressed in production.

### Custom Metrics

A `metric` helper is available for tracking custom counters and gauges:

```ts
async execute({ input, metric }) {
  metric.count("tokens_processed", 142);
  metric.gauge("queue_depth", 5);
  metric.timing("llm_latency_ms", 1240);
}
```

All custom metrics appear in the `telemetry.framework.custom_metrics` field of the final response.

### Models, tokens & cost

Every run reports `telemetry.models: [{ id, provider, calls, tokens, cost_usd? }]`. The SDK never estimates
cost from a price list: `cost_usd` appears only when a provider or your code reported a real number
(`cost_source: "provider" | "agent"`). Otherwise the marketplace prices `tokens` itself.

| Your code uses | What to do |
|---|---|
| Catelog adapters (`pipe*Stream`) | Nothing. Models and tokens are captured. |
| Vercel AI SDK / OpenTelemetry | Add `catelogSpanProcessor` to your OTel setup, and pass `experimental_telemetry: { isEnabled: true }`. |
| LangChain / LangGraph | `graph.invoke(input, { callbacks: [createLangChainUsageHandler(ctx.usage)] })`, or `pipeLangGraphStream(..., { usage: ctx.usage })`. |
| Custom code (Groq, Ollama, fine-tuned...) | `ctx.usage.record({ model, provider, tokens: { prompt, completion } })` |

Capture never throws: missing or invalid data is skipped. Failed runs keep the usage they already spent.

### Returning Telemetry

You can provide model usage data in the return value for accurate billing and analytics:

```ts
return {
  output: { summary: "..." },
  telemetry: {
    model_used: "gpt-4o",
    llm_tokens: {
      prompt: 250,
      completion: 400,
      total: 650,
    },
    cost_usd: 0.0013,
  },
};
```

If using a framework adapter (`pipeOpenAiStream`, `pipeAiSdkStream`), token counts are extracted automatically — no need to provide them manually.

---

## 10. What You Get — Endpoints

Once `agent.listen(3000)` is called, the SDK exposes these endpoints:

### `GET /health`
No auth required. Used by the marketplace registration probe.

```bash
curl http://localhost:3000/health
```
```json
{
  "status": "ready",
  "protocol_version": "1.0.0",
  "uptime_seconds": 1284,
  "environment_ready": true,
  "capabilities": {
    "streaming": true,
    "delta_stream": true,
    "max_timeout_seconds": 300,
    "execution_modes": ["sync"]
  }
}
```

### `GET /schema`
No auth required. Returns the agent manifest for marketplace listing.

```bash
curl http://localhost:3000/schema
```
```json
{
  "id": "my-research-agent",
  "name": "My Research Agent",
  "version": "1.0.0",
  "description": "...",
  "protocol_version": "1.0.0",
  "capabilities": { "streaming": true, "execution_modes": ["sync"] },
  "input_schema": { "type": "object", "properties": { "query": { "type": "string" } } },
  "output_schema": { "type": "object", "properties": { "report": { "type": "string" } } }
}
```

### `POST /execute`
Runs the agent. Accepts SSE (`Accept: text/event-stream`) or JSON (`Accept: application/json`).

```bash
# Dev mode — no auth required
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"query": "AI trends 2025"}}'

# With Bearer auth
curl -X POST http://localhost:3000/execute \
  -H "Authorization: Bearer cat_sec_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"input": {"query": "AI trends 2025"}}'
```

### `GET /tasks/:id` *(async mode only)*
Polls the status of a background async job.

```bash
curl http://localhost:3000/tasks/run_abc123
```
```json
{ "run_id": "run_abc123", "status": "working", "elapsed_ms": 4200 }
```

## Stream

stream.delta(content, type?)	Streams text/token deltas (task.delta event)
stream.write(text)	Convenience alias for delta
stream.progress(percent, message?)	Emits a progress tick (task.progress event)
stream.step(label)	Convenience alias for progress label
stream.activity(type, data?)	Emits named activity events (tool calls, etc.)
stream.emit(event, data)	Emits raw SSE events
stream.isClosed()	Checks if connection is active

---

## 11. Testing Locally

### Basic curl test

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. See the agent schema
curl http://localhost:3000/schema | jq .

# 3. Run the agent (SSE stream)
curl -N -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"input": {"query": "test query"}}'

# 4. Run the agent (JSON batch, no streaming)
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"input": {"query": "test query"}}'
```

### Running the test suite

```bash
pnpm test
# or
npx tsx test/index.test.ts
```

---

## 12. Registering on the Marketplace

1. Deploy your agent to a public URL (Fly.io, Railway, Render, AWS, etc.)
2. Go to **Catelog Dashboard → Creator Space → My Agents**
3. Click **Register New Agent**
4. Paste your public URL (e.g. `https://my-agent.fly.dev`)
5. The marketplace automatically:
   - Pings `GET /health` — verifies reachability and protocol version
   - Fetches `GET /schema` — populates agent name, description, and input form
   - Checks `capabilities.execution_modes` — marks sync/async/conversational support
6. Review auto-populated fields, set your price, and publish

---

## 13. Error Handling

### Automatic Error Capture

You don't need to catch errors manually. Any uncaught exception in `execute()` is automatically converted to a `task.failed` event:

```ts
async execute({ input }) {
  // If this throws, the SDK emits task.failed automatically
  const result = await riskyOperation(input);
  return { output: result };
}
```

### Custom Error Codes

For domain-specific errors, attach a `code` and `retryable` flag:

```ts
async execute({ input }) {
  const balance = await checkCredits();
  if (balance < 0.01) {
    const err = new Error("Insufficient credits to run this model");
    (err as any).code = "MODEL_RATE_LIMIT";
    (err as any).retryable = true;
    throw err;
  }
  // ...
}
```

### Cancellation via AbortSignal

When a buyer cancels or the gateway times out, `signal.aborted` becomes `true`. Pass the signal to your LLM or fetch calls to propagate cancellation and avoid wasted credits:

```ts
async execute({ input, stream, signal }) {
  // signal propagates cancellation to fetch, OpenAI, LangGraph, etc.
  const response = await fetch("https://api.example.com", { signal });
  const result = await openai.chat.completions.create({ ..., stream: true });

  // Check manually if needed
  if (signal.aborted) {
    return { output: { partial: true } };
  }
}
```

---

## 14. Production Options

Everything here is optional.

### 14.1 Job stores (async mode)

By default async jobs live in memory and vanish on restart. Plug in a store to keep them:

```ts
import { createAgent, RedisJobStore, SqliteJobStore } from "catelog";
import Redis from "ioredis";

createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Deep Researcher",
  mode: "async",
  jobStore: new RedisJobStore(new Redis(process.env.REDIS_URL!), { ttlMs: 86_400_000 }),
  // jobStore: new SqliteJobStore({ path: "/data/jobs.db" }),   // Node 22.5+, needs a persistent volume
  async execute(ctx) { /* ... */ },
});
```

| Store | Needs | Notes |
| :--- | :--- | :--- |
| `MemoryJobStore` (default) | nothing | Lost on restart |
| `RedisJobStore(client, { prefix?, ttlMs? })` | an `ioredis` or `redis` (node-redis v4+) client you create | Shared across instances |
| `SqliteJobStore({ path?, ttlMs? })` | Node 22.5+ (`node:sqlite`) | Single instance, file on a volume |
| your own | implement `JobStore` | `get(runId)`, `set(job)`, optional `close()` |

**What survives a restart:** finished results (`completed` / `failed`) stay pollable. A task that was *running* when the process died cannot be resumed. Once its heartbeat is 20 seconds old it is reported as `failed` with code `TASK_INTERRUPTED` and `retryable: true`, so the buyer can resubmit. Store errors are logged and never crash a running agent.

### 14.2 Limits

```ts
createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "My Agent",
  limits: {
    maxConcurrent: 10,
    maxBodyBytes: 1_000_000,
    rateLimit: { max: 60, windowMs: 60_000 },
    trustProxy: true,
  },
  async execute(ctx) { /* ... */ },
});
```

| Option | Effect when exceeded | Response |
| :--- | :--- | :--- |
| `maxConcurrent` | Too many runs at once | `429 SERVER_BUSY` + `Retry-After` |
| `maxBodyBytes` | Request body too large | `413 PAYLOAD_TOO_LARGE` |
| `rateLimit` | Too many requests per client in the window | `429 RATE_LIMITED` + `Retry-After` |
| `trustProxy` | Rate limit keys on `X-Forwarded-For` instead of the socket IP | — |

Limits apply to `POST /execute` only. With nothing set there are no limits.

### 14.3 Graceful shutdown

`agent.listen()` listens for `SIGTERM` and `SIGINT`. It stops taking new runs (`503 SHUTTING_DOWN`), waits for running tasks, then exits. After `shutdownTimeoutMs` (default 25000) remaining tasks are aborted and marked `TASK_INTERRUPTED`. A second signal exits immediately.

```ts
agent.listen({ port: 3000, shutdownTimeoutMs: 20_000 });
agent.listen({ port: 3000, handleSignals: false });   // your own handler: await agent.shutdown(20_000)
```

Set your container stop grace period (Docker `--stop-timeout`, Kubernetes `terminationGracePeriodSeconds`) a few seconds above `shutdownTimeoutMs`. Docker's default is 10 seconds.

### 14.4 New error codes

`TASK_INTERRUPTED`, `RATE_LIMITED`, `SERVER_BUSY`, `SHUTTING_DOWN`, `PAYLOAD_TOO_LARGE`.

---

## 15. CLI

```bash
npx catelog init              # asks to add the setup guide, then TypeScript or Python
npx catelog init --yes        # no prompts (TypeScript unless --lang is given)
npx catelog init --lang py    # Catelog-PY.md (empty placeholder until the Python SDK ships)
npx catelog init --force      # overwrite an existing guide
npx catelog --version
npx catelog --help
```

The guide (`Catelog-TS.md`) is written to your project root. It covers setup, SSE events, modes and production options.

---

## Quick Reference

```ts
import { createAgent, pipeOpenAiStream, pipeAiSdkStream, pipeLangGraphStream, pipeClaudeAgentStream } from "catelog";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: string,                    // Required
  id?: string,                     // Auto-slugified from name
  version?: string,                // Default: "1.0.0"
  description?: string,
  mode?: "sync" | "async" | "conversational", // Default: "sync"
  secretKey?: string,              // Auto-read from CATELOG_SECRET_KEY
  publicKey?: string,              // Auto-read from CATELOG_PUBLIC_KEY
  inputSchema?: ZodSchema | JSONSchema,  // Optional
  outputSchema?: ZodSchema | JSONSchema, // Optional
  telemetry?: { endpoint?: string; disabled?: boolean },
  maxTimeoutMinute: number, // REQUIRED — hard per-run limit; advertised as capabilities.max_timeout_seconds
  jobStore?: JobStore,             // async persistence (Redis / SQLite / custom)
  limits?: { maxConcurrent?, maxBodyBytes?, rateLimit?, trustProxy? },

  async execute(ctx) {
    // ctx.runId        string
    // ctx.input        typed input
    // ctx.stream       streaming helpers
    // ctx.signal       AbortSignal
    // ctx.log          structured logger
    // ctx.metric       metric recorder
    // ctx.metadata     buyer/session metadata
    // ctx.session      get/set for conversational state
    // ctx.needInput()  suspend for HITL input

    return { output: { ... }, telemetry: { ... } }; // or just return { ... }
  },
});

agent.listen(3000); // or agent.listen({ port, shutdownTimeoutMs, handleSignals })
```
