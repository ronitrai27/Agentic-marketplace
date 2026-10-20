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
  “Welcome to the agent economy, where humans and agents rent out intelligence.”
════════════════════════════════════════════════════════════════════
```

The official TypeScript SDK for the **Marketplace Agent Protocol Specification (MAPS v1.0.0)**.  
Wrap any AI agent (LangGraph, OpenAI SDK, LlamaIndex, or custom logic) into a marketplace-compliant microservice in just a few lines of code.

---

## 📦 Universal Installation

Compatible with all JavaScript package managers and runtimes (Node.js 18+, Bun, Deno):

### **pnpm**
```bash
pnpm add catelog zod
```

### **npm**
```bash
npm install catelog zod
```

### **yarn**
```bash
yarn add catelog zod
```

### **bun**
```bash
bun add catelog zod
```

---

## 🚀 Features

- ✅ **Protocol Compliance:** Exposes `GET /health`, `GET /schema`, and `POST /execute`.
- 🛡️ **HMAC-SHA256 Security:** Canonical request signing and 5-minute sliding nonce anti-replay protection.
- ⚡ **Dual Execution Modes:** Streaming via Server-Sent Events (`text/event-stream`) or batch JSON (`application/json`).
- 💓 **Auto Heartbeats:** Emits automatic 15s heartbeats to prevent Cloudflare/ALB gateway timeouts.
- 📐 **Schema Flexibility:** Native support for [Zod](https://zod.dev) schemas or standard JSON Schema Draft-07.
- 📡 **Ping / Liveness Check:** Instant `GET /health` verification probe for reachability and uptime.
- 🎨 **Rich Terminal Aesthetics:** Modern shadcn-style terminal splash on install and server boot.

---

## 🛠️ Quick Start

```typescript
import { createMarketplaceAgent } from "catelog";
import { z } from "zod";

// 1. Define Input & Output Schemas
const InputSchema = z.object({
  topic: z.string().describe("Research topic"),
  depth: z.enum(["quick", "deep"]).default("quick"),
});

const OutputSchema = z.object({
  summary: z.string(),
  citations: z.array(z.string()),
});

// 2. Create the Agent
export const agent = createMarketplaceAgent({
  name: "Deep Research Agent",
  secret: process.env.MARKETPLACE_SECRET,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  // Main execution logic
  async execute({ input, stream, signal }) {
    stream.step("Searching web for topic: " + input.topic);

    // Stream text deltas live to the buyer UI
    stream.delta("Synthesizing research notes...\n");

    // Call your LLM, LangGraph workflow, or custom code here:
    const summary = `Comprehensive report on ${input.topic}`;
    const citations = ["https://example.com/source1"];

    return {
      output: { summary, citations },
      telemetry: {
        model_used: "gpt-4o-mini",
        llm_tokens: { prompt: 250, completion: 400, total: 650 },
        cost_usd: 0.0012,
      },
    };
  },
});

// 3. Start the server (prints the signature CATELOG banner)
agent.serve(3000);
```

---

## 🔗 Endpoints Provided

| Endpoint | Method | Transport | Purpose |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | `application/json` | Liveness & uptime probe |
| `/schema` | `GET` | `application/json` | Agent manifest with input/output JSON Schemas |
| `/execute` | `POST` | `text/event-stream` / `application/json` | Secure HMAC-authenticated execution with streaming |
