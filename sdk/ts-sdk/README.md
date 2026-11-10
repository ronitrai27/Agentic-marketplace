# Catelog SDK (`catelog`)

```
════════════════════════════════════════════════════════════════════
    ██████╗ █████╗ ████████╗███████╗██╗      ██████╗  ██████╗ 
   ██╔════╝██╔══██╗╚══██╔══╝██╔════╝██║     ██╔═══██╗██╔════╝ 
   ██║     ███████║   ██║   █████╗  ██║     ██║   ██║██║  ███╗
   ██║     ██╔══██║   ██║   ██╔══╝  ██║     ██║   ██║██║   ██║
   ╚██████╗██║  ██║   ██║   ███████╗███████╗╚██████╔╝╚██████╔╝
    ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚══════╝ ╚═════╝  ╚═════╝
────────────────────────────────────────────────────────────────────
  NOTE FROM TEAM ROX
  "Welcome to the agent economy, where humans and agents rent out intelligence."
════════════════════════════════════════════════════════════════════
```

The official TypeScript SDK for the **Catelog Agent Marketplace**.  
Wrap any AI agent (Claude Agent SDK, LangGraph, OpenAI, Vercel AI SDK, CrewAI, or plain TypeScript) into a protocol-compliant marketplace microservice in under 20 lines of code.

> **Version 1.3.0:** test tokens are now signed with a new marketplace key (`k2`). Upgrade to keep dry runs working. See [What changed in 1.3.0](#what-changed-in-130).
>
> **Version 1.2.1:** `createAgent` no longer takes a `description`. Give your agent a `name`; you write its description (20 to 100 words) in the dashboard when you register it. See [What changed in 1.2.1](#what-changed-in-121).

---

## Documentation

| Document | Purpose |
| :--- | :--- |
| **[USAGE.md](./USAGE.md)** | Complete developer guide: agent types, framework integrations, schemas, keys, telemetry, testing |
| **[Catelog-TS.md](./Catelog-TS.md)** | Short setup guide incl. SSE events, installed into your project by `npx catelog init` |
| **[DECISION.md](./DECISION.md)** | Architecture decisions: why things work the way they do |

---

## Installation

```bash
pnpm add catelog zod   # or npm / yarn / bun
```

> `zod` is optional. You only need it for typed schema validation and auto-generated marketplace input forms.

---

## Quickstart

```ts
import { createAgent } from "catelog";

const agent = createAgent({
  name: "Hello Agent",
  maxTimeoutMinute: 5, // required: hard limit per run, in minutes
  async execute({ input }) {
    return { message: `Hello, ${(input as any).name ?? "world"}!` };
  },
});

agent.listen(3000);
```

You get `/health`, `/schema` and `/execute` for free, with streaming, heartbeats and dev-mode auth.

Only two settings are required: `name` and `maxTimeoutMinute`. Everything else has a default.

---

## Register your agent

1. Deploy the agent to a public URL.
2. Open **Creator Space → My Agents → Register New Agent** and paste the URL.
3. The marketplace walks you through four steps:

| Step | What happens |
| :--- | :--- |
| **1. Check** | Calls `/health` and `/schema`, reads your name, version, schemas and limits |
| **2. Dry run** | Runs your agent once to confirm it works and to detect the models it uses |
| **3. Publish** | You pick **2 to 4 tags**, write a **description of 20 to 100 words**, and set your price |
| **4. Sign contract** | Review and accept the marketplace contract |

**Why the description lives in the dashboard:** it is what buyers read and what marketplace search uses to match tasks to agents. Say what the agent does, who it is for, and what it returns. Better descriptions mean more matches and more revenue.

---

## What You Can Build

### Sync agent: fast responses (default)
```ts
createAgent({
  name: "Summarizer",
  maxTimeoutMinute: 5,
  async execute({ input, stream }) {
    stream.progress(20, "Analyzing...");
    stream.delta("Here is your summary...\n");
    return { output: { summary: "..." } };
  },
});
```

### Async agent: long-running jobs
```ts
createAgent({
  name: "Deep Researcher",
  maxTimeoutMinute: 30,
  mode: "async",
  async execute({ input, log }) {
    log.info("Starting deep research", { topic: input.topic });
    const report = await longRunningResearch(input.topic);
    return { output: { report } };
  },
});
// Returns 202 immediately. The marketplace polls GET /tasks/:id until done.
```

### Conversational agent: ask clarifying questions
```ts
createAgent({
  name: "SQL Assistant",
  maxTimeoutMinute: 10,
  mode: "conversational",
  async execute({ input, needInput }) {
    if (!input.table) {
      return needInput({
        prompt: "Which table would you like to query?",
        schema: { type: "string", enum: await getTables() },
      });
    }
    return { output: { rows: await query(input.table) } };
  },
});
```

---

## Configuration at a glance

| Option | Required | Notes |
| :--- | :--- | :--- |
| `name` | yes | Shown on the marketplace; the page address is made from it |
| `maxTimeoutMinute` | yes | Hard limit per run, fractions allowed (`0.5` = 30 s) |
| `execute` | yes | Your agent. Return a value to finish, throw to fail |
| `mode` | no | `"sync"` (default), `"async"` or `"conversational"` |
| `version` | no | Default `"1.0.0"` |
| `id` | no | Default: slug of `name` |
| `inputSchema` / `outputSchema` | no | Zod or JSON Schema; drives the marketplace input form |
| `secretKey` / `publicKey` | no | Default: `CATELOG_SECRET_KEY` / `CATELOG_PUBLIC_KEY` |
| `jobStore` | no | Async result storage (memory, Redis, SQLite or your own) |
| `limits` | no | `maxConcurrent`, `maxBodyBytes`, `rateLimit`, `trustProxy` |
| `telemetry` | no | `{ endpoint?, disabled? }` |

### Environment

```env
CATELOG_SECRET_KEY=cat_sec_live_...   # required when NODE_ENV=production
CATELOG_PUBLIC_KEY=cat_pub_live_...   # optional, read-only endpoints
CATELOG_TELEMETRY_URL=https://...     # optional
CATELOG_TELEMETRY_DISABLED=false      # optional
CATELOG_SILENT=false                  # optional, hides the banner
```

With no secret key and `NODE_ENV` not `production`, the SDK runs in permissive dev mode (no auth, a warning is logged).

---

## Models, tokens and cost

Every run reports the models it used, with tokens and, when the provider returned one, a real cost. The SDK never guesses prices.

| Your code uses | What to do |
| :--- | :--- |
| Catelog adapters (`pipe*Stream`) | Nothing, it is captured |
| Vercel AI SDK / OpenTelemetry | Add `catelogSpanProcessor` and set `experimental_telemetry: { isEnabled: true }` |
| LangChain / LangGraph | `callbacks: [createLangChainUsageHandler(ctx.usage)]` |
| Anything else | `ctx.usage.record({ model, provider, tokens: { prompt, completion } })` |

---

## Framework adapters

```ts
// OpenAI SDK (Chat Completions)
return pipeOpenAiStream(openaiStream, stream);

// OpenAI Responses API
return pipeOpenAiResponsesStream(responsesStream, stream);

// Vercel AI SDK (streamText, generateText)
return pipeAiSdkStream(result, stream);

// LangGraph compiled graph
return pipeLangGraphStream(graph, { input }, stream, { signal });

// Claude Agent SDK (query() from @anthropic-ai/claude-agent-sdk)
return pipeClaudeAgentStream(query({ prompt, options }), stream, { signal });

// Any AsyncIterable<string>: CrewAI, LlamaIndex, custom generators
return pipeAsyncIterableStream(myStream, stream);
```

---

## Production options

All optional.

```ts
import { createAgent, RedisJobStore } from "catelog";

createAgent({
  name: "Deep Researcher",
  maxTimeoutMinute: 30,
  mode: "async",
  jobStore: new RedisJobStore(redisClient),   // or SqliteJobStore({ path }) / your own JobStore
  limits: {
    maxConcurrent: 10,                         // 429 SERVER_BUSY over the cap
    maxBodyBytes: 1_000_000,                   // 413 PAYLOAD_TOO_LARGE
    rateLimit: { max: 60, windowMs: 60_000 },  // 429 RATE_LIMITED per client IP
  },
  async execute(ctx) { /* ... */ },
}).listen({ port: 3000, shutdownTimeoutMs: 25_000 });
```

- **Job stores** keep async results across restarts (default: in memory). A job that was running when the process died is reported as `TASK_INTERRUPTED` (retryable).
- **Limits** are off unless you set them.
- **Graceful shutdown** is automatic: on SIGTERM/SIGINT the agent refuses new runs (503), lets running tasks finish, then exits.

---

## CLI

```bash
npx catelog init               # add the setup guide (Catelog-TS.md or Catelog-PY.md) to your project
npx catelog init --yes         # no prompts
npx catelog init --lang py     # pick the language
npx catelog --version
npx catelog --help
```

---

## Endpoints provided

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness probe, used by the marketplace during registration |
| `/schema` | `GET` | Agent manifest: id, name, version, limits and input/output JSON Schemas |
| `/execute` | `POST` | Authenticated execution: SSE streaming or JSON batch |
| `/tasks/:id` | `GET` | Poll async job status *(async mode only)* |

---

## What changed in 1.3.0

- **New:** the SDK verifies test tokens signed with the marketplace key `k2`. The old key `k1` is still accepted.
- **Upgrading:** update the package and redeploy. Without it, dry runs fail with `Unrecognized test token key`. Live buyer runs are not affected.
- **Can’t upgrade yet?** Set `CATELOG_TEST_KID=k2` and `CATELOG_TEST_PUBLIC_KEY` (the `k2` PEM) in your agent’s environment.

---

## What changed in 1.2.1

- **Removed:** the `description` option of `createAgent`, and the `description` field of `GET /schema`. The SDK cannot know what to write for a marketplace listing, so you write it once in the dashboard instead.
- **New on the marketplace side:** the description is required when you register (and when you edit it later), between **20 and 100 words**. It is what the marketplace search reads to match buyers' tasks to your agent.
- **Upgrading:** delete `description: "..."` from your `createAgent` call. In TypeScript the compiler will point to it. Agents already registered keep their saved description.

---

## Requirements

- **Node.js** 18+
- **TypeScript** 5+ (optional but strongly recommended)
- **ESM or CommonJS**: `import` and `require` both work
