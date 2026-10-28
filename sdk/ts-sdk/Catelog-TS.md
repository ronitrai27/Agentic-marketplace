# Catelog SDK (TypeScript) — Setup Guide

> Installed by `npx catelog init`. Read it yourself, or point your coding assistant at it.

`catelog` turns any AI agent (Claude Agent SDK, OpenAI, Vercel AI SDK, LangGraph, or plain TypeScript) into a marketplace-ready HTTP service. You write one `execute()` function; the SDK provides:

| Endpoint | Purpose |
| :--- | :--- |
| `GET /health` | Liveness probe, used when you register the agent |
| `GET /schema` | Manifest + input/output JSON Schemas (builds the buyer's form) |
| `POST /execute` | Runs the agent, via SSE stream or JSON |
| `GET /tasks/:id` | Polls a background job (`mode: "async"` only) |

Requires **Node.js 18+**. Works with `import` (ESM) and `require` (CommonJS).

---

## 1. Install

```bash
npm install catelog zod      # or: pnpm add catelog zod | yarn add catelog zod | bun add catelog zod
```

`zod` is optional. It gives you typed input validation and auto-generated marketplace forms.

## 2. CLI commands

```bash
npx catelog init                 # asks: add this guide? then TypeScript or Python
npx catelog init --yes           # no questions, installs Catelog-TS.md
npx catelog init --lang py       # installs Catelog-PY.md (placeholder until the Python SDK ships)
npx catelog init --force         # overwrite an existing guide
npx catelog --version
npx catelog --help
```

## 3. Environment

```env
CATELOG_SECRET_KEY=cat_sec_live_...     # production auth (required when NODE_ENV=production)
CATELOG_PUBLIC_KEY=cat_pub_live_...     # optional, read-only endpoints
CATELOG_TELEMETRY_URL=https://...       # optional telemetry endpoint
CATELOG_TELEMETRY_DISABLED=false        # optional
CATELOG_SILENT=false                    # optional, hides banner / postinstall output
PORT=3000
```

With no secret key and `NODE_ENV` not `production`, the SDK runs in permissive **dev mode** (no auth, warning logged).

## 4. Minimal agent

```ts
import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Summarizer",
  description: "Summarizes text",
  inputSchema: z.object({ text: z.string().min(1) }),
  async execute({ input, stream }) {
    stream.progress(20, "Reading...");
    stream.delta("Working on it...\n");
    return { output: { summary: input.text.slice(0, 100) } };
  },
});

agent.listen(3000);   // alias: agent.serve(3000)
```

- **Return** a value → task completes. **Throw** → task fails. You never set task state by hand.
- Returning `{ output, telemetry? }` or a plain object both work.

---

### Do I need a separate server file?

**No.** `catelog` *is* the server. Pick one:

| You have... | Do this |
| :--- | :--- |
| Nothing yet (new agent) | `agent.listen(3000)`. Done, that is the whole server. |
| An existing Express / Fastify / `http` / Next.js server | `agent.handleRequest(req, res)` inside it. No second port, no second process. |

A file like `server.ts` is just *where you call* `createAgent()` and `listen()`. Put them in your existing entry file if you like.

```ts
// Existing Express app: add the agent as one more route group
import express from "express";
import { agent } from "./my-agent.js";

const app = express();
app.get("/", (_req, res) => res.send("my existing app"));

app.use("/agent", (req, res) => agent.handleRequest(req, res));   // /agent/health, /agent/schema, /agent/execute, /agent/tasks/:id
app.use(express.json());                                           // your own body parser goes AFTER the mount

app.listen(3000);
```

> **Gotcha:** `handleRequest` reads the raw request body itself. Do **not** run `express.json()` (or any body parser) before the mount, or `/execute` will hang because the body was already consumed. Mount the agent first, or only apply the parser to your own routes.

When you register on the marketplace, give it the URL that serves `/health` and `/schema` (e.g. `https://api.example.com/agent`).

---

## 5. Streaming events (SSE)

Everything you call on `stream` inside `execute()` becomes a **Server-Sent Event** the buyer sees live. No setup needed: call the helper and the SDK sends the event.

### The `stream` helpers

| You call | SSE event sent | Use it for |
| :--- | :--- | :--- |
| `stream.progress(percent, message?)` | `task.progress` | Progress bar + status text (0–100) |
| `stream.step(label)` | `task.progress` (0%) | "Now doing X" labels |
| `stream.delta(text, type?)` | `task.delta` | Live LLM tokens. `type` = `"text"` (default) or `"json_patch"` |
| `stream.write(text)` / `stream.chunk(text)` | `task.delta` | Aliases for `delta` |
| `stream.activity(type, data?)` | `task.activity` | Tool calls, searches, DB queries |
| `stream.emit(name, data)` | `<name>` (your own) | Any custom event |
| `stream.isClosed()` | — | `true` if the client disconnected |

```ts
async execute({ input, stream, signal }) {
  stream.step("Searching the web");
  stream.activity("web_search", { query: input.query });          // task.activity

  stream.progress(40, "Reading 5 sources");                        // task.progress

  for (const token of await generate(input.query)) {
    if (stream.isClosed()) break;                                  // buyer left, stop work
    stream.delta(token);                                           // task.delta
  }

  stream.emit("source_found", { url: "https://example.com" });    // custom event
  return { output: { done: true } };                               // task.completed
}
```

### What the client receives

Each event is `event: <name>` + `data: <json>`. The SDK sends them in this order:

```
event: task.status      data: {"event":"task.status","run_id":"run_1","status":"working","timestamp":1730000000000}
event: task.progress    data: {"event":"task.progress","run_id":"run_1","percent":40,"message":"Reading 5 sources","step":1,"timestamp":...}
event: task.activity    data: {"event":"task.activity","run_id":"run_1","activity_type":"web_search","data":{"query":"..."},"timestamp":...}
event: task.delta       data: {"event":"task.delta","run_id":"run_1","index":0,"delta_type":"text","content":"Hel"}
event: source_found     data: {"url":"https://example.com"}
event: heartbeat        data: {"event":"heartbeat","timestamp":...}          (every 15s, keeps the connection alive)
event: task.completed   data: {"event":"task.completed","run_id":"run_1","duration_ms":1840,"output":{...},"telemetry":{...}}
```

| Event | Payload fields | Terminal? |
| :--- | :--- | :---: |
| `task.status` | `run_id`, `status` (`working`), `timestamp` | No |
| `task.progress` | `run_id`, `percent`, `message?`, `step`, `timestamp` | No |
| `task.delta` | `run_id`, `index`, `delta_type`, `content` | No |
| `task.activity` | `run_id`, `activity_type`, `data?`, `timestamp` | No |
| *your custom event* | exactly the `data` you passed to `stream.emit` | No |
| `heartbeat` | `timestamp` | No |
| `task.completed` | `run_id`, `duration_ms`, `output`, `telemetry?` | **Yes** |
| `task.failed` | `run_id`, `duration_ms`, `error` (`code`, `message`, `retryable`) | **Yes** |
| `task.input_required` | `run_id`, `prompt`, `input_schema?`, `resume_token` | **Yes** (waits for input) |

A cancelled run (buyer disconnects, deadline passes) ends with `task.failed` and code `TASK_CANCELED`.

### Watch the stream with curl

```bash
curl -N -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"input": {"text": "hello world"}}'
```

SSE is the default when no `Accept` header is sent. Send `Accept: application/json` to skip streaming and get one JSON result.

### Consume the stream in a browser or Node client

`EventSource` can't POST, so read the stream with `fetch`:

```ts
const res = await fetch("http://localhost:3000/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer cat_sec_live_..." },
  body: JSON.stringify({ input: { text: "hello" } }),
});

const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  const frames = buffer.split("\n\n");
  buffer = frames.pop()!;                       // keep the unfinished frame
  for (const frame of frames) {
    const event = /^event: (.*)$/m.exec(frame)?.[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? "null");
    if (event === "task.delta") process.stdout.write(data.content);
    if (event === "task.progress") console.log(`${data.percent}% ${data.message ?? ""}`);
    if (event === "task.completed") console.log("\nDONE", data.output);
    if (event === "task.failed") console.error("FAILED", data.error);
  }
}
```

### Streaming from AI frameworks (one line)

The adapters read the framework's stream and call `stream.delta` / `stream.activity` for you:

```ts
import { pipeOpenAiStream, pipeAiSdkStream, pipeLangGraphStream, pipeClaudeAgentStream, pipeAsyncIterableStream } from "catelog";

return pipeOpenAiStream(await openai.chat.completions.create({ model, messages, stream: true }), stream);
return pipeAiSdkStream(streamText({ model, prompt }), stream);                 // Vercel AI SDK
return pipeLangGraphStream(graph, { input }, stream, { signal });              // LangGraph
return pipeClaudeAgentStream(query({ prompt, options }), stream, { signal });   // Claude Agent SDK
return pipeAsyncIterableStream(myAsyncGenerator(), stream);                    // CrewAI, LlamaIndex, custom
```

### Recipes: Claude Agent SDK, OpenAI, LangGraph

All three live inside `execute()`. The agent file below is the *whole* integration (add `agent.listen(3000)` or mount it, see above).

**Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), one line with the adapter. Tool calls become `task.activity`, and cost, tokens and model go into telemetry:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createAgent, pipeClaudeAgentStream } from "catelog";
import { z } from "zod";

export const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Claude Researcher",
  mode: "async",                                   // Claude runs take 10-60s
  inputSchema: z.object({ prompt: z.string() }),
  async execute({ input, stream, signal, metric }) {
    const run = query({
      prompt: input.prompt,
      options: {
        model: "claude-haiku-5-5",
        tools: ["WebSearch", "WebFetch"], allowedTools: ["WebSearch", "WebFetch"],
        permissionMode: "dontAsk", settingSources: [], persistSession: false,
        maxTurns: 10, maxBudgetUsd: 0.15,          // hard spend cap per run
      },
    });
    return pipeClaudeAgentStream(run, stream, {
      signal,                                      // client leaves / timeout => query.interrupt()
      onUsage: (t) => metric.gauge("cost_usd", t.cost_usd ?? 0),   // optional: keep cost even when the run fails
    });                                            // => { output: { text }, telemetry }
  },
});
```

Want typed JSON back instead of text? Add `outputFormat: { type: "json_schema", schema }` to the query options and pass `parse` to the adapter:

```ts
const Out = z.object({ answer: z.string() });
const { $schema, ...schema } = z.toJSONSchema(Out) as Record<string, unknown>;   // the Claude CLI rejects "$schema"
// query options: outputFormat: { type: "json_schema", schema }
return pipeClaudeAgentStream(run, stream, { signal, parse: (v) => Out.parse(v) });   // => { output: { answer }, telemetry }
```

The adapter maps Claude failures to Catelog error codes: rate limit / overloaded → `MODEL_RATE_LIMIT` (retryable), budget cap → `BUDGET_EXCEEDED`, out of turns → `TOOL_FAILURE`, bad structured output → `INTERNAL_CRASH`. Full production example: `Agents/JobFitAgent/`.

**OpenAI SDK**, one line with the adapter (streams tokens, captures model + usage):

```ts
import OpenAI from "openai";
import { createAgent, pipeOpenAiStream } from "catelog";
const client = new OpenAI();

export const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "OpenAI Assistant",
  inputSchema: z.object({ prompt: z.string() }),
  async execute({ input, stream }) {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini", stream: true, stream_options: { include_usage: true },
      messages: [{ role: "user", content: input.prompt }],
    });
    return pipeOpenAiStream(res, stream);          // => { output: { text }, telemetry }
  },
});
```

(Responses API / web search: use `pipeOpenAiResponsesStream(await client.responses.create({...}), stream)`.)

**LangGraph (TypeScript)**, one line; each graph node becomes a `task.activity` event:

```ts
import { createAgent, pipeLangGraphStream } from "catelog";
import { graph } from "./my-graph.js";             // your compiled StateGraph

export const agent = createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Research Graph",
  mode: "async",
  inputSchema: z.object({ topic: z.string() }),
  async execute({ input, stream, signal }) {
    return pipeLangGraphStream(graph, { messages: [input.topic] }, stream, { signal });
  },
});
```

| Framework | How | Telemetry you get for free |
| :--- | :--- | :--- |
| Claude Agent SDK | `pipeClaudeAgentStream` | model, tokens, cost, turns, per-tool counts |
| OpenAI | `pipeOpenAiStream` / `pipeOpenAiResponsesStream` | model, tokens (+ cost for Responses) |
| LangGraph | `pipeLangGraphStream` | nodes visited |
| Vercel AI SDK | `pipeAiSdkStream` | tokens, tool calls |

> Adapter output shape: OpenAI/AI SDK adapters return `{ text }`; LangGraph returns the last node's output. If your `outputSchema` needs a different shape, call the framework yourself and `return { output, telemetry }`.

### Events in `async` mode

Async agents don't hold an SSE connection. The buyer polls instead, and the same helpers still work:

```bash
curl http://localhost:3000/tasks/<run_id>?since=<last_seq>
```

```json
{ "run_id": "run_1", "status": "working", "elapsed_ms": 4200,
  "current_step": "Reading 5 sources", "progress_pct": 40,
  "events": [ { "seq": 3, "type": "progress", "percent": 40, "message": "Reading 5 sources", "timestamp": 1730000000000 } ],
  "last_seq": 3 }
```

Pass `last_seq` back as `?since=` to receive only new events. `step`, `progress`, `activity` and `emit` events are recorded; `delta` text is **not** (it is for live SSE only), so put final text in your `output`.

---

## 6. Execution modes

| `mode` | Behaviour |
| :--- | :--- |
| `"sync"` (default) | Result streams back on the same connection (SSE or JSON). |
| `"async"` | `POST /execute` returns `202` + `poll_url`; buyer polls `GET /tasks/:id`. For jobs that take minutes. |
| `"conversational"` | `needInput(...)` pauses the task and asks the buyer a question (human-in-the-loop). |

```ts
// Conversational: ask a question, then continue when the buyer answers
createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "SQL Assistant",
  mode: "conversational",
  async execute({ input, needInput, session, stream }) {
    if (!input.table) {
      return needInput({
        prompt: "Which table?",
        schema: { type: "object", properties: { table: { type: "string", enum: ["orders", "users"] } }, required: ["table"] },
      });                                                  // → task.input_required with a resume_token
    }
    stream.progress(50, `Querying ${input.table}`);
    session.set("last_table", input.table);                // kept between turns
    return { output: { table: input.table } };
  },
});
```

On resume the client sends `POST /execute` with the new `input` and the `resume_token` from `task.input_required`.

## 7. The `execute(ctx)` context

| Field | What it is |
| :--- | :--- |
| `input` | Validated input (typed from your Zod schema) |
| `stream` | Streaming helpers (section 5) |
| `signal` | `AbortSignal`: pass to `fetch` / LLM calls so cancellation stops the work |
| `log` | `log.info/warn/error/debug(message, data?)` |
| `metric` | `metric.count/gauge/timing(name, value)` → sent in telemetry |
| `runId`, `metadata`, `deadlineMs`, `resumeToken` | Run info from the marketplace |
| `needInput(opts)` | Pause for buyer input (conversational mode) |
| `session` | `get/set/getAll` state that persists across turns |

Custom errors: `throw Object.assign(new Error("Out of credits"), { code: "MODEL_RATE_LIMIT", retryable: true })`.

## 8. Production options

### Keep async jobs across restarts

```ts
import { createAgent, RedisJobStore, SqliteJobStore } from "catelog";

createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "Deep Researcher",
  mode: "async",
  jobStore: new RedisJobStore(redisClient),                   // ioredis or node-redis client
  // jobStore: new SqliteJobStore({ path: "/data/jobs.db" }), // Node 22.5+, needs a persistent volume
  async execute(ctx) { /* ... */ },
});
```

Default is in-memory (lost on restart). With a store, finished results survive restarts. A task that was *running* when the process died is reported as `failed` with code `TASK_INTERRUPTED` (retryable) so the buyer can resubmit. You can also implement the `JobStore` interface (`get`, `set`, optional `close`) for any other database.

### Limits (all optional, off by default)

```ts
createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: "My Agent",
  limits: {
    maxConcurrent: 10,                         // over the cap → 429 SERVER_BUSY
    maxBodyBytes: 1_000_000,                   // bigger bodies → 413 PAYLOAD_TOO_LARGE
    rateLimit: { max: 60, windowMs: 60_000 },  // per client IP → 429 RATE_LIMITED (+ Retry-After)
    trustProxy: true,                          // read X-Forwarded-For; only behind a trusted proxy
  },
  async execute(ctx) { /* ... */ },
});
```

### Graceful shutdown

`agent.listen()` handles `SIGTERM` / `SIGINT`: it stops accepting new runs (503 `SHUTTING_DOWN`), lets in-flight tasks finish, then exits. A second Ctrl+C exits immediately.

```ts
agent.listen({ port: 3000, shutdownTimeoutMs: 25_000 });   // default wait: 25s
agent.listen({ port: 3000, handleSignals: false });        // do it yourself: await agent.shutdown()
```

In Docker/Kubernetes set the stop grace period to at least `shutdownTimeoutMs` (Docker's default is 10s).

### Mount inside an existing server

```ts
import http from "node:http";
http.createServer((req, res) => agent.handleRequest(req, res)).listen(3000);
```

Express under a prefix (`app.use("/agent", (req, res) => agent.handleRequest(req, res))`) works too. Mount it **before** `express.json()`. See "Do I need a separate server file?" in section 4.

## 9. Authentication

| Caller | Method | Header |
| :--- | :--- | :--- |
| Marketplace gateway | HMAC-SHA256 (automatic) | `X-Marketplace-Signature` |
| curl / Postman / your server | Bearer secret key | `Authorization: Bearer cat_sec_live_...` |
| Your frontend | Bearer public key | `Authorization: Bearer cat_pub_live_...` |
| Local dev | none | — |

## 10. Error codes

`AUTH_INVALID_SIGNATURE`, `AUTH_TIMESTAMP_OUT_OF_BOUNDS`, `AUTH_REPLAY_DETECTED`, `AUTH_MISSING_KEY`, `AUTH_INVALID_KEY`, `INVALID_INPUT`, `MODEL_RATE_LIMIT`, `UPSTREAM_TIMEOUT`, `EXECUTION_TIMEOUT`, `INTERNAL_CRASH`, `TOOL_FAILURE`, `TASK_CANCELED`, `TASK_INTERRUPTED`, `RATE_LIMITED`, `SERVER_BUSY`, `SHUTTING_DOWN`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`.

Every error has the shape `{ code, message, retryable, details? }`.

## 11. Test locally

```bash
npm test                                   # in the SDK repo
curl http://localhost:3000/health
curl http://localhost:3000/schema
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"input": {"text": "hello world"}}'
```

## 12. Register on the marketplace

1. Deploy the agent to a public URL.
2. Dashboard → Creator Space → My Agents → Register New Agent.
3. Paste the URL. The marketplace calls `/health` and `/schema`, then you set a price and publish.

## 13. Quick reference

```ts
createAgent({
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  name: string,                         // required
  id?, version?, description?,
  mode?: "sync" | "async" | "conversational",
  secretKey?, publicKey?,               // default: CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY
  inputSchema?, outputSchema?,          // Zod or JSON Schema
  maxTimeoutMinute: number,   // REQUIRED — hard per-run limit (sync, async, conversational)
  telemetry?: { endpoint?, disabled? },
  jobStore?: JobStore,                  // async persistence
  limits?: { maxConcurrent?, maxBodyBytes?, rateLimit?, trustProxy? },
  execute: async (ctx) => output | { output, telemetry? } | needInput(...),
});

agent.listen(port | { port, host, silent, handleSignals, shutdownTimeoutMs });
agent.handleRequest(req, res);   // mount in your own server
agent.shutdown(timeoutMs);       // drain + close
agent.getHealth(); agent.getManifest();
```

More: `USAGE.md` (full guide) · `DECISION.md` (design decisions).
