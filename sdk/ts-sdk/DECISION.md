# Catelog TypeScript SDK — Architecture & Design Decisions

> **From Team ROX:**  
> *"Welcome to the agent economy, where humans and agents rent out intelligence."*

---

## What Is Catelog?

`catelog` is the official TypeScript SDK for the **Catelog Marketplace**. It solves one problem cleanly: turning any AI agent — regardless of the framework, model, or runtime — into a production-ready, marketplace-compliant microservice in **under 20 lines of code**.

You bring your agent logic. The SDK handles everything else:

- HTTP routing, CORS, and error handling
- Authentication (Bearer token, HMAC-SHA256, or permissive dev mode)
- Real-time SSE streaming with heartbeat keep-alives
- Task lifecycle state management (working → completed / failed / canceled / input-required)
- Schema validation and manifest generation
- Background telemetry reporting

---

## Guiding Principle: Progressive Disclosure

Senior engineers should never struggle with the SDK. The design follows a **progressive disclosure** model:

```
Level 1 — Zero friction (5 lines, no config)
Level 2 — Add schemas for validation and marketplace forms
Level 3 — Add keys for production auth
Level 4 — Add mode, telemetry, and framework adapters
```

At every level, the SDK adds features without breaking the previous level.

---

## Core Architectural Decisions

### Decision 1: Inferred Task Lifecycle (No Manual State Management)

**Problem:** If developers must manually call `task.setStatus("working")`, `task.setStatus("completed")`, etc., they will forget — leaving tasks stuck in a "working" state forever on unhandled exceptions.

**Decision:** The SDK infers the full task state machine from standard async function semantics:

```
execute() starts      → SDK emits task.status = "working"
stream.delta(...)     → SDK emits task.delta (task stays "working")
stream.progress(...)  → SDK emits task.progress (task stays "working")
return value          → SDK emits task.completed automatically
throw error           → SDK emits task.failed automatically
client disconnects    → SDK emits task.canceled automatically
ctx.needInput(...)    → SDK emits task.input_required (HITL suspension)
```

The developer only writes normal `async/await` code. Task state is never their concern.

---

### Decision 2: Dual-Mode Authentication (Not Strict HMAC-Only)

**Problem:** Requiring full HMAC-SHA256 headers for every request means a senior engineer can't test with `curl` or Postman without writing a custom signing script. This kills developer experience.

**Decision:** The SDK detects the best available authentication method from the request:

| Priority | Method | How It's Detected | When Used |
| :---: | :--- | :--- | :--- |
| 1 | **HMAC-SHA256** | `X-Marketplace-Signature` header present | Marketplace Gateway → Agent |
| 2 | **Bearer secret** | `Authorization: Bearer cat_sec_live_...` | curl, Postman, internal services |
| 3 | **Bearer public** | `Authorization: Bearer cat_pub_live_...` | Frontend, schema/health calls |
| 4 | **Dev mode** | No auth, `NODE_ENV !== "production"` | Local development |
| 5 | **Rejected** | No auth in production | Security enforcement |

Keys are auto-discovered from environment variables (`CATELOG_SECRET_KEY`, `CATELOG_PUBLIC_KEY`). The developer never needs to pass them manually if `.env` is configured.

---

### Decision 3: Three Execution Modes

**Problem:** Agents have fundamentally different execution profiles. A web search agent finishes in 2 seconds. A deep research graph may take 4 minutes. A document assistant may need to ask a clarifying question mid-run.

**Decision:** Three first-class execution modes, selectable with a single config field:

```
"sync"           → Direct HTTP/SSE connection, resolves in same request
"async"          → Returns 202 Accepted + jobId, polled via GET /tasks/:id
"conversational" → Supports ctx.needInput() for HITL suspension and resume
```

The developer sets `mode: "async"` and writes normal async code. The SDK handles the 202 response, background execution, job store, and polling endpoint automatically.

---

### Decision 4: Optional Schemas (Not Required)

**Problem:** Forcing `inputSchema` and `outputSchema` as required fields blocks rapid prototyping. A developer testing locally shouldn't need to write a Zod schema just to get a server running.

**Decision:** Both `inputSchema` and `outputSchema` are optional:

- If provided, the SDK validates inputs at the gateway and generates marketplace forms from the schema
- If omitted, the SDK accepts any valid JSON payload and returns an open `{ type: "object" }` schema

Zod v3, Zod v4, and raw JSON Schema Draft-07 objects are all supported natively.

---

### Decision 5: Two-Layer Non-Blocking Telemetry

**Problem:** Telemetry is valuable but must never break or slow down agent execution. If a telemetry endpoint is unreachable, the buyer's run must still complete normally.

**Decision:** Two independent telemetry layers:

**Layer 1 — Universal Base (automatic, zero developer effort):**
Collected for every agent regardless of framework: execution duration, input/output byte sizes, chunks streamed, task final state, error codes.

**Layer 2 — Framework-Specific Enrichment (progressive, graceful):**
When using OpenAI, Vercel AI SDK, or LangGraph adapters, the SDK extracts token counts, tool call counts, and graph node transitions. If extraction fails, it silently falls back to Layer 1.

**Background reporting** is fire-and-forget with a 3-second timeout. Network failures are silently discarded. The agent response is never blocked.

---

### Decision 6: Framework Adapters (One-Line Integration)

**Problem:** Developers using OpenAI streams, LangGraph runnables, or Vercel AI SDK results must manually loop over chunks and call `stream.delta()` for every piece. This is repetitive glue code.

**Decision:** Native adapter functions that pipe framework-specific outputs directly into Catelog's task event stream:

```ts
// Before (verbose glue):
for await (const chunk of openaiStream) {
  if (chunk.choices[0].delta.content) {
    stream.delta(chunk.choices[0].delta.content);
  }
}

// After (one line):
return pipeOpenAiStream(openaiStream, stream);
```

Adapters handle streaming, telemetry extraction, tool call events, and graceful error recovery — all in a single call.

---

### Decision 7: Health Check as Registration Probe

**Problem:** When a creator registers their agent server on the marketplace, the platform needs to verify the server is reachable, running the right protocol version, and capable of the declared features — before accepting the listing.

**Decision:** `GET /health` returns a rich response with capabilities, used for one-click registration verification:

```json
{
  "status": "ready",
  "protocol_version": "1.0.0",
  "uptime_seconds": 1284,
  "environment_ready": true,
  "capabilities": {
    "streaming": true,
    "delta_stream": true,
    "execution_modes": ["async"]
  }
}
```

The marketplace fires `/health` then `/schema` in sequence. The creator sees their agent's name, input fields, and capabilities auto-populated on the listing page — no manual configuration.

---

## Source File Map

```
sdk/ts-sdk/src/
├── index.ts        Clean root exports for everything below
├── types.ts        Protocol types, task states, SSE events, error codes
├── agent.ts        CatelogAgent class — the core engine
├── security.ts     Dual-mode auth: Bearer, HMAC-SHA256, public key, dev
├── sse.ts          SSEWriter — task lifecycle events, heartbeat, disconnect
├── context.ts      AgentExecutionContext — session, needInput(), log, metric
├── telemetry.ts    2-layer telemetry collector + background reporter
├── adapters.ts     Framework adapters: OpenAI, Vercel AI SDK, LangGraph
├── schema.ts       Zod-to-JSON-Schema + runtime input validation
├── server.ts       Lightweight native Node.js HTTP server
└── banner.ts       ANSI terminal startup splash
```

| File | Responsibility |
| :--- | :--- |
| `agent.ts` | Routes `/health`, `/schema`, `/execute`, `/tasks/:id`. Dispatches execution modes. Normalizes results and errors. |
| `security.ts` | Detects auth method, verifies Bearer tokens, validates HMAC-SHA256 signatures, manages nonce replay cache. |
| `sse.ts` | Writes canonical SSE frames, emits 8 task lifecycle event types, manages heartbeat timer and client disconnect detection. |
| `context.ts` | Builds the `ctx` object passed to `execute()`. Manages session store for conversational agents. |
| `telemetry.ts` | Collects base metrics, provides structured logger, fires background telemetry reports with silent failure. |
| `adapters.ts` | Translates OpenAI, Vercel AI SDK, LangGraph, and generic async iterable outputs into Catelog stream events. |

---

## The SSE Event Protocol (What the Marketplace Receives)

Every streaming execution produces this sequence of events:

```
event: task.status
data: {"event":"task.status","run_id":"run_abc","status":"working","timestamp":1729410000000}

event: task.progress                         ← from stream.progress(40, "Searching...")
data: {"event":"task.progress","run_id":"run_abc","percent":40,"message":"Searching...","step":1}

event: task.delta                            ← from stream.delta("Found 3 results...")
data: {"event":"task.delta","run_id":"run_abc","index":0,"delta_type":"text","content":"Found 3 results..."}

event: task.activity                         ← from stream.activity("tool_call", {...})
data: {"event":"task.activity","run_id":"run_abc","activity_type":"tool_call","data":{...}}

event: heartbeat                             ← automatic every 15 seconds
data: {"event":"heartbeat","timestamp":1729410015000}

event: task.completed                        ← from return result
data: {"event":"task.completed","run_id":"run_abc","duration_ms":3412,"output":{...},"telemetry":{...}}
```

For `input-required` agents:
```
event: task.input_required                   ← from ctx.needInput({...})
data: {"event":"task.input_required","run_id":"run_abc","prompt":"...","resume_token":"resume_abc123","input_schema":{...}}
```

For failed agents:
```
event: task.failed                           ← from throw new Error(...)
data: {"event":"task.failed","run_id":"run_abc","duration_ms":812,"error":{"code":"INTERNAL_CRASH","message":"...","retryable":false}}
```

---

## API Keys: Public vs Secret

| Key | Format | Where It Lives | Used For |
| :--- | :--- | :--- | :--- |
| **Publishable** | `cat_pub_live_...` | Frontend, client apps | `/health`, `/schema` calls, analytics |
| **Secret** | `cat_sec_live_...` | Server `.env` only | `/execute` auth, agent registration, webhooks |

The secret key is revealed **once** at creation. It is stored in the database as a SHA-256 hash. The preview characters shown in the UI (`cat_sec_live_...xxxx`) are for identification only.

On the agent server, set the secret key in `.env`:
```
CATELOG_SECRET_KEY=cat_sec_live_your_key_here
CATELOG_PUBLIC_KEY=cat_pub_live_your_key_here
```

The SDK auto-reads both from `process.env`. No manual passing required.
