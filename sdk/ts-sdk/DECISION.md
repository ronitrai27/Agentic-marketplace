# Architecture & Design Decisions: Catelog TypeScript SDK (`catelog`)

> **Note from Team ROX:**  
> *“Welcome to the agent economy, where humans and agents rent out intelligence.”*

---

## 1. Executive Summary & Vision

As AI agents transition from standalone chat interfaces into autonomous economic actors, developers face a fragmented ecosystem. Agents are built using diverse frameworks—**LangGraph, OpenAI Responses API, CrewAI, LlamaIndex, or custom TypeScript loops**. 

However, when developers want to monetize or publish their agents on a decentralized, Bring-Your-Own-Server (BYOS) marketplace, they are forced to reinvent low-level infrastructure:
- Raw HTTP server routing and CORS handling.
- Cryptographic request signing and anti-replay defense.
- Server-Sent Events (SSE) streaming with heartbeat keep-alives.
- JSON Schema generation from TypeScript types.
- Client disconnect / cancellation propagation.

**`catelog` is the official, open-source TypeScript SDK designed to solve this problem.** It acts as a lightweight, framework-agnostic universal adapter that turns any agent logic into a secure, production-ready, protocol-compliant marketplace microservice in **less than 20 lines of code**.

---

## 2. Core Architectural Decisions

### Decision 1: Canonical Protocol Specification (MAPS v1.0.0)
* **Context:** The marketplace requires standardized communication contracts between the Gateway and BYOS agent servers.
* **Decision:** `catelog` strictly implements the **Marketplace Agent Protocol Specification (MAPS v1.0.0)**.
* **Endpoints Exposed:**
  1. `GET /health`: Instantaneous liveness and uptime probe ($< 10\text{ms}$).
  2. `GET /schema`: Agent Manifest document containing standard JSON Schemas (Draft-07).
  3. `POST /execute`: Authenticated execution endpoint supporting both SSE streaming (`text/event-stream`) and batch JSON (`application/json`).

---

### Decision 2: Zero-Trust Security & Anti-Replay Guard
* **Context:** Open-network agent servers are targets for denial-of-service, spoofed executions, and credential burn. Without anti-replay mechanisms, an intercepted request can be replayed to drain the creator's LLM credits.
* **Decision:**
  - **Canonical HMAC-SHA256 Signing:** All `/execute` calls require a signature calculated over normalized components:
    $$\text{BodyHash} = \text{HEX}(\text{SHA256}(\text{RawRequestBodyBytes}))$$
    $$\text{CanonicalString} = \text{METHOD} + "\backslash\text{n}" + \text{PATH} + "\backslash\text{n}" + \text{TIMESTAMP} + "\backslash\text{n}" + \text{NONCE} + "\backslash\text{n}" + \text{RUN\_ID} + "\backslash\text{n}" + \text{BodyHash}$$
    $$\text{Signature} = \text{HEX}(\text{HMAC-SHA256}(\text{Secret}, \text{CanonicalString}))$$
  - **5-Minute Clock Drift Enforcement:** Requests with $|\text{CurrentTime} - \text{Timestamp}| > 300{,}000\text{ms}$ are rejected immediately (`AUTH_TIMESTAMP_OUT_OF_BOUNDS`).
  - **Sliding Nonce Cache:** In-memory LRU cache with 5-minute TTL. Any repeated nonce within the drift window is blocked (`AUTH_REPLAY_DETECTED`).
  - **Run ID Idempotency:** Duplicate active or completed run IDs cannot be re-executed.
  - **Constant-Time Comparison:** Uses `crypto.timingSafeEqual` to eliminate side-channel timing attacks.

---

### Decision 3: Framework-Agnostic Adapter Pattern
* **Context:** Forcing developers into a specific LLM library creates friction.
* **Decision:** `catelog` uses the **Adapter Pattern**. The SDK is completely decoupled from agent orchestration frameworks:
  - Works with **LangGraph / LangChain**.
  - Works with **OpenAI SDK** (`client.responses.create`).
  - Works with **LlamaIndex**, **Vercel AI SDK**, or vanilla TypeScript loops.
  Developers simply pass an `execute({ input, stream, signal })` async function.

---

### Decision 4: Native Zod & JSON Schema Support
* **Context:** The marketplace UI and gateway validation engine require explicit JSON Schemas to generate input forms and enforce pre-execution contracts.
* **Decision:** Developers can define schemas using standard [Zod](https://zod.dev) or raw JSON Schema objects. `catelog` automatically converts Zod objects into standard JSON Schema Draft-07 for the `GET /schema` endpoint while providing runtime type safety for incoming buyer payloads.

---

### Decision 5: Real-Time SSE Streaming with Keep-Alive Heartbeats
* **Context:** Long-running deep research or multi-agent loops (e.g. 30–120 seconds) frequently get terminated prematurely by intermediate proxies (Cloudflare Error 524, AWS ALB 504 Gateway Timeout).
* **Decision:**
  - **Automatic 15s Heartbeats:** The SDK spawns an internal timer emitting `{ event: "heartbeat", timestamp: ... }` every 15 seconds during active runs.
  - **Clean Disconnect Handling:** If a buyer or gateway closes the socket, the SDK catches the event and trips an `AbortSignal`, allowing developers to abort downstream LLM calls immediately and prevent wasted API costs.

---

### Decision 6: Simplified Ping Check (No Dry-Run Invariant)
* **Context:** Earlier concepts considered simulated "dry-runs" to check third-party balances. However, third-party API keys can run out mid-job, and dry-runs create false confidence while consuming maintenance overhead.
* **Decision:** Keep `/health` as a pure, lightweight network liveness and uptime probe (`GET /health`). It responds in milliseconds, uses zero credits, and certifies server uptime and protocol readiness.

---

## 3. What the SDK Contains

The SDK codebase is modular, clean, and fully typed:

```
sdk/ts-sdk/
├── package.json               # Package name: "catelog", ESM, type exports
├── tsconfig.json              # NodeNext ES2022 compiler configuration
├── README.md                  # Comprehensive developer documentation
├── DECISION.md                # This architectural decision document
├── scripts/
│   └── postinstall.js         # Zero-dependency install splash for npm/pnpm/yarn/bun
├── src/
│   ├── index.ts               # Clean root exports
│   ├── types.ts               # Protocol interfaces, event contracts & error codes
│   ├── security.ts            # SecurityManager (HMAC-SHA256, nonce cache, replay guard)
│   ├── sse.ts                 # SSEWriter (heartbeat timer, stream formatting, abort signal)
│   ├── schema.ts              # Zod-to-JSON-Schema converter & runtime validator
│   ├── agent.ts               # MarketplaceAgent class & createMarketplaceAgent() factory
│   ├── server.ts              # Lightweight native HTTP server runner (.serve(port))
│   └── banner.ts              # Rich ANSI terminal diagnostics and startup splash
└── test/
    └── index.test.ts          # Automated verification test suite
```

### Module Highlights:

| File | Purpose |
| :--- | :--- |
| **`src/types.ts`** | Defines `ExecuteRequest`, `ExecuteResponse`, `AgentManifest`, `HealthCheckResponse`, and standard error codes (`AUTH_INVALID_SIGNATURE`, `INVALID_INPUT`, `MODEL_RATE_LIMIT`, `INTERNAL_CRASH`, etc.). |
| **`src/security.ts`** | Handles canonical string generation, body hashing (SHA-256), HMAC validation, and sliding nonce memory caches. |
| **`src/sse.ts`** | Handles chunk formatting (`event: ...\ndata: ...\n\n`), sequence numbering for deltas, step reporting, and automatic 15-second heartbeat intervals. |
| **`src/schema.ts`** | Provides unwrapped JSON Schema generation from Zod schemas and validates user inputs against registered contracts. |
| **`src/agent.ts`** | Core engine coordinating CORS, routing (`/health`, `/schema`, `/execute`), authentication, timeout deadlines, and error normalization. |
| **`src/server.ts`** | Zero-dependency Node.js HTTP server supporting standalone execution or mounting into Express/Fastify/Next.js. |

---

## 4. How to Use the SDK

### 1. Installation
`catelog` is universally compatible with all package managers:

```bash
# pnpm
pnpm add catelog zod

# npm
npm install catelog zod

# yarn
yarn add catelog zod

# bun
bun add catelog zod
```

---

### 2. Basic Agent Implementation
Wrap any agent function with `createMarketplaceAgent`:

```typescript
import { createMarketplaceAgent } from "catelog";
import { z } from "zod";
import OpenAI from "openai";

const client = new OpenAI();

// 1. Declare contract schemas
const InputSchema = z.object({
  query: z.string().describe("Target company or topic"),
});

const OutputSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()),
});

// 2. Wrap the agent
export const agent = createMarketplaceAgent({
  name: "B2B Market Research Agent",
  version: "1.0.0",
  description: "Autonomous research agent using OpenAI web search",
  secret: process.env.MARKETPLACE_SECRET, // Provided by the marketplace
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute({ input, stream, signal }) {
    // Report progress steps live to the buyer UI
    stream.step("Initiating web discovery...");

    const response = await client.responses.create({
      model: "gpt-6-luna",
      input: input.query,
      tools: [{ type: "web_search" }],
    });

    stream.step("Formatting structured report...");

    return {
      output: {
        summary: response.output_text || "",
        sources: ["https://example.com/source1"],
      },
      telemetry: {
        model_used: "gpt-6-luna",
        llm_tokens: {
          total: response.usage?.total_tokens || 350,
        },
        cost_usd: 0.002,
      },
    };
  },
});

// 3. Start the server (prints the signature CATELOG banner)
agent.serve(4000);
```

---

### 3. Verification & Testing

#### Test Ping / Liveness:
```bash
curl http://localhost:4000/health
```
```json
{
  "status": "ready",
  "protocol_version": "1.0.0",
  "uptime_seconds": 42,
  "environment_ready": true
}
```

#### Test Manifest Document:
```bash
curl http://localhost:4000/schema
```
Returns the agent manifest with complete JSON Schemas ready for marketplace listing.

#### Test Execution with Signature:
Clients sign requests using HMAC-SHA256 headers:
- `X-Marketplace-Protocol: 1.0.0`
- `X-Marketplace-Timestamp: <timestamp>`
- `X-Marketplace-Nonce: <uuid>`
- `X-Marketplace-Run-Id: <run_id>`
- `X-Marketplace-Signature: <hex_hmac>`

The SDK streams live Server-Sent Events directly to the client:
```
event: run.started
data: {"event":"run.started","run_id":"run_123","timestamp":1729410000000}

event: step.started
data: {"event":"step.started","run_id":"run_123","step_index":1,"label":"Initiating web discovery..."}

event: run.succeeded
data: {"event":"run.succeeded","run_id":"run_123","duration_ms":3410,"output":{...},"telemetry":{...}}
```

---

## 5. Why Developers Love `catelog`

1. **5-Minute Onboarding:** Turn existing scripts or notebooks into a monetizable microservice in $< 5$ minutes.
2. **Zero Framework Lock-in:** Use LangGraph, OpenAI, CrewAI, Anthropic, or pure JavaScript.
3. **Built-in Production Hardening:** Replay attacks, clock drifts, malformed payloads, and reverse proxy timeouts are solved out of the box.
4. **Autonomous Economy Ready:** Seamlessly hooks into PayPal Authorize & Capture and multi-agent escrow networks.

