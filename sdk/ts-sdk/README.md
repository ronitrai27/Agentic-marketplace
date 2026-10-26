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
Wrap any AI agent — Claude Agent SDK, LangGraph, OpenAI, Vercel AI SDK, CrewAI, or vanilla TypeScript — into a production-ready, protocol-compliant marketplace microservice in under 20 lines of code.

---

## Documentation

| Document | Purpose |
| :--- | :--- |
| **[USAGE.md](./USAGE.md)** | Complete developer guide — agent types, framework integrations, schemas, keys, telemetry, testing |
| **[Catelog-TS.md](./Catelog-TS.md)** | Short setup guide incl. SSE events, installed into your project by `npx catelog init` |
| **[DECISION.md](./DECISION.md)** | Architecture decisions — why things work the way they do |

---

## Installation

```bash
pnpm add catelog zod   # or npm / yarn / bun
```

> `zod` is optional — only needed if you want typed schema validation and auto-generated marketplace input forms.

---

## Quickstart (5 lines)

```ts
import { createAgent } from "catelog";

const agent = createAgent({
  name: "Hello Agent",
  async execute({ input }) {
    return { message: `Hello, ${(input as any).name ?? "world"}!` };
  },
});

agent.listen(3000);
```

That's all. You get `/health`, `/schema`, and `/execute` — with streaming, heartbeats, and dev-mode auth — for free.

---

## What You Can Build

### Sync Agent — Fast responses (default)
```ts
createAgent({
  name: "Summarizer",
  async execute({ input, stream }) {
    stream.progress(20, "Analyzing...");
    stream.delta("Here is your summary...\n");
    return { output: { summary: "..." } };
  },
});
```

### Async Agent — Long-running jobs (minutes)
```ts
createAgent({
  name: "Deep Researcher",
  mode: "async",
  async execute({ input, log }) {
    log.info("Starting deep research", { topic: input.topic });
    const report = await longRunningResearch(input.topic);
    return { output: { report } };
  },
});
// Returns 202 immediately. Marketplace polls GET /tasks/:id until done.
```

### Conversational Agent — Ask clarifying questions
```ts
createAgent({
  name: "SQL Assistant",
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

## Production Options

All optional. Beginners can ignore this section.

```ts
import { createAgent, RedisJobStore } from "catelog";

createAgent({
  name: "Deep Researcher",
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

- **Job stores** keep async results across restarts (the default is in-memory). A job that was running when the process died is reported as `TASK_INTERRUPTED` (retryable).
- **Limits** are off unless you set them.
- **Graceful shutdown** is automatic: on SIGTERM/SIGINT the agent refuses new runs (503), lets running tasks finish, then exits.

---

## CLI

```bash
npx catelog init               # add the setup guide (Catelog-TS.md or Catelog-PY.md) to your project
npx catelog init --yes         # no prompts
npx catelog init --lang py     # pick the language
npx catelog --help
```

---

## Framework Adapters

One-line integrations for popular AI frameworks:

```ts
// OpenAI SDK
return pipeOpenAiStream(openaiStream, stream);

// Vercel AI SDK (streamText, generateText)
return pipeAiSdkStream(result, stream);

// LangGraph compiled graph
return pipeLangGraphStream(graph, { input }, stream, { signal });

// Claude Agent SDK (query() from @anthropic-ai/claude-agent-sdk)
return pipeClaudeAgentStream(query({ prompt, options }), stream, { signal });

// Any AsyncIterable<string> — CrewAI, LlamaIndex, custom generators
return pipeAsyncIterableStream(myStream, stream);
```

---

## Endpoints Provided

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/health` | `GET` | Liveness probe — used by marketplace during registration |
| `/schema` | `GET` | Agent manifest with input/output JSON Schemas |
| `/execute` | `POST` | Authenticated execution — SSE streaming or JSON batch |
| `/tasks/:id` | `GET` | Poll async job status *(async mode only)* |

---

## Requirements

- **Node.js** 18+
- **TypeScript** 5+ (optional but strongly recommended)
- **ESM or CommonJS** — `import` and `require` both work
