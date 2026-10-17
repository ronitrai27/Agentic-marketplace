. How Buyers & Creators Connect
Creators / Sellers (BYOS):
Wrap agent logic using your-marketplace-sdk (export default createMarketplaceAgent(...)).
Deploy it anywhere with a public URL.
In Marketplace Dashboard: Enter Agent Name, Server URL (e.g. https://my-leadfinder.fly.dev), and API Secret.
Buyers (Humans):
Use the Web UI to trigger jobs, view outputs, and pay per run or subscription.
Buyers (AI Agents like Claude / Cursor / Antigravity):
Connect via an MCP (Model Context Protocol) endpoint or a simple REST API exposed by your marketplace gateway (e.g., POST api.marketplace.com/v1/agents/{id}/invoke).
4. How the "Ping Test" Works
When a seller submits or updates their server URL, the marketplace runs a 3-step verification test:

Health Check (GET /health):
Marketplace sends a quick request expecting 200 OK and { status: "ready", uptime: ... } within a timeout (e.g., 3s).
Signature / Auth Handshake:
Marketplace sends an X-Marketplace-Signature or challenge token to verify that the server is legitimately configured with the seller's secret.
Dry-Run Test (POST /execute with { dryRun: true }):
Validates that the agent's runner environment initializes without consuming paid credits or external API tokens.
Status Dashboard:
If ping passes: Mark agent status as Active 🟢.
If ping fails: Mark as Unreachable 🔴 with detailed failure reason (Timeout, Invalid Signature, or Internal Error).



How Do Developers Earn? (Pricing Models)
If you can trace the exact running cost, developers have 3 monetization strategies they can choose when publishing on your marketplace:

Fixed Per-Execution Fee (Most Popular):
Developer sets: $0.15 per successful run.
Telemetry shows actual LLM cost was $0.03.
Developer's net profit = $0.12 (minus marketplace cut).
Cost-Plus Margin (Dynamic):
Developer sets: Actual Token Cost + 30% Profit Margin.
Simple questions cost less, complex deep-research tasks cost more proportionally.
Outcome / Success-Based:
Developer sets: $0.50 if the LeadFinder produces $\ge 10$ verified leads; $0.00 if no leads found.


 How PayPal Plays the HERO Role in This Hackathon
For a PayPal Hackathon, judges look for deep, native integration of PayPal products solving a real agentic problem (trust, multi-party payments, and autonomous billing).

Here is the exact architecture that makes PayPal essential to your platform:

[Buyer: Human or AI Agent]
         │ 
         │ 1. Deposits funds or Authorizes Budget via PayPal
         ▼
[Marketplace Core Gateway]
   ├── Escrow / Authorize: Holds budget via PayPal Auth & Capture
   ├── Invokes Agent Server via BYOS
   ├── Traces Telemetry (Cost, Tokens, Success)
         │
         ├── 2. Success: Captures EXACT fee from Buyer via PayPal Orders
         │
         ▼ 
[PayPal Payouts API] ──── 3. Instant Payout ───▶ [Developer's PayPal Wallet]
The 4 PayPal Features to Showcase:
A. PayPal Authorize & Capture (Escrow for Agents)
The Problem: AI agents can hallucinate, get stuck in infinite loops, or crash mid-execution. Buyers shouldn't pay upfront for a failed agent.
PayPal Solution: When a run starts, call PayPal Orders API (intent: "AUTHORIZE") to lock the max budget (e.g., $1.00).
If agent run succeeds: Capture the exact telemetry cost (e.g., $0.18) and release the rest.
If agent run fails: Void the authorization. The buyer is charged $0.00.
B. Buyer Wallet Top-Up (PayPal Standard Checkout / Vault)
Users click "Add Funds with PayPal" using PayPal Smart Buttons to maintain an in-platform credit balance.
For autonomous buyers (like Cursor, Claude, or background cron agents), use PayPal Vault / Pre-approved Billing Agreements so the agent can execute marketplace tools programmatically without requiring human 2FA clicks every run.
C. Two-Sided Marketplace: Automated Creator Payouts (PayPal Payouts API)
This is a huge hackathon differentiator!
Creators enter their PayPal Email when listing their agent.
As soon as an agent completes jobs and earns money, they can click "Withdraw to PayPal" (or receive real-time payouts) triggered directly via the PayPal Payouts API (POST /v1/payments/payouts).
Shows the end-to-end money cycle: Buyer pays with PayPal $\rightarrow$ Marketplace deducts commission $\rightarrow$ Creator receives earnings via PayPal.
D. PayPal Webhooks
Listen to PAYMENT.CAPTURE.COMPLETED, CHECKOUT.ORDER.APPROVED, and PAYMENT.PAYOUTS-ITEM.SUCCEEDED to handle async credit balance updates and fraud protection in real time.
Suggested Short Pitch for Judges:
"The Agentic Marketplace enables autonomous AI agents and humans to rent specialized agents with guaranteed safety. Powered by PayPal's Authorize & Capture, buyers only pay for verified, successful agent executions based on real-time token telemetry. Earnings are automatically settled to creator PayPal accounts via the PayPal Payouts API."




=============

Marketplace SDK must provide these 5 core modules:

1. Schema Declaration (input_schema & output_schema)
Why it’s needed:
When Creator A publishes an agent, the marketplace needs to know what inputs to show on the UI form for buyers (e.g., industry, target_role).
When chaining agents (LeadFinder $\to$ Outreach), the marketplace uses the JSON Schema generated from Pydantic/Zod to verify that LeadFinder’s output keys match Outreach’s input keys.
What the SDK does:
Automatically exports a GET /schema endpoint that converts the creator's Pydantic/Zod models into standard JSON Schema for the marketplace frontend and validation engine.
2. Authentication & Handshake (auth)
Why it’s needed:
Prevents random bots on the internet from calling the creator's agent server and running up their API bills. Only your marketplace gateway should have permission to trigger runs.
What the SDK does:
Validates incoming requests using HMAC signatures or an X-Marketplace-Secret header.
Handles the onboarding handshake challenge when the creator registers their server URL on the marketplace.
3. Ping & Health Checks (health & dry_run)
Why it’s needed:
To verify the agent is live and functional before listing it as "Active" in the marketplace.
What the SDK does:
Exposes GET /health: Returns server status, agent version, and uptime within 1–2 seconds.
Handles { dryRun: true } in POST /execute: Runs a lightweight validation test (checks if necessary API keys like Firecrawl or OpenAI exist in the agent's environment) without burning actual LLM or scraping credits.
4. Telemetry & Cost Accounting (telemetry)
Why it’s needed:
This is the backbone of your PayPal Authorize & Capture and creator monetization. The marketplace needs to know the exact token and dollar cost of every execution to bill the buyer and pay the creator.
What the SDK does:
Wraps the agent run and intercepts:
Input tokens & output tokens.
Model used (e.g., gpt-4o-mini, claude-3-5-sonnet).
Total execution latency in milliseconds.
Calculated LLM cost.
Automatically bundles this telemetry into the final execution response envelope.
5. Execution Wrapper & Error Handling (execute & streaming)
Why it’s needed:
AI agents can crash, time out, or hit rate limits. If an agent crashes ungracefully, the marketplace won't know whether to refund the buyer's PayPal hold or retry.
What the SDK does:
Standardizes the response envelope:
json
{
  "success": true,
  "output": { ... },
  "telemetry": {
    "tokens": 1420,
    "cost_usd": 0.003,
    "duration_ms": 4200
  }
}
Standardizes failure codes (INVALID_INPUT, MODEL_RATE_LIMIT, BUDGET_EXCEEDED, INTERNAL_CRASH), allowing the marketplace to automatically void the PayPal authorization when an agent fails.
Supports Server-Sent Events (SSE) streaming so buyers can see live thinking steps on the marketplace UI.


================

To make the SDK universally work with any framework (LangGraph, CrewAI, OpenAI SDK, Pydantic AI), the SDK must use the Adapter Pattern.

The SDK does not care what framework is inside. It acts as a lightweight wrapper that turns any agent function into a compliant Marketplace microservice.

How Your researchAgent Would Use the SDK
Look at what you built in 

researchAgent/src/server.ts
: You wrote 153 lines of raw HTTP server code to handle SSE headers, parse request JSON, write chunk streams, catch errors, and format data.

With the Marketplace SDK, researchAgent replaces server.ts with just this clean file:

typescript
import { createMarketplaceAgent } from "@marketplace/sdk";
import { runResearchAgent } from "./index.js";
import { z } from "zod";
// 1. Declare Input & Output Schemas (Zod for TS, Pydantic for Python)
const InputSchema = z.object({
  prompt: z.string().describe("Research topic or question"),
});
const OutputSchema = z.object({
  status: z.enum(["COMPLETED", "GUARDRAIL_BLOCKED", "DIRECT_ANSWER"]),
  answer: z.string(),
  sourcesCount: z.number(),
  durationSeconds: z.number(),
});
// 2. Wrap your LangGraph agent
export default createMarketplaceAgent({
  name: "Deep Research Agent",
  secret: process.env.MARKETPLACE_SECRET,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  // 3. Optional Dry-Run Checker (for the marketplace ping verification)
  async onDryRun() {
    if (!process.env.OPENAI_API_KEY || !process.env.FIRECRAWL_API_KEY) {
      throw new Error("Missing required API keys in environment");
    }
    return { status: "ready" };
  },
  // 4. Main Execution
  async execute({ input, stream }) {
    // Call your existing LangGraph runner!
    const result = await runResearchAgent(input.prompt, {
      onProgress: (step) => stream.emit("progress", { message: step }),
    });
    return {
      output: result,
      telemetry: {
        model: "gpt-4.1-mini",
        // Extract token usage or cost if available
        tokens: result.metadata?.tokens || 1500,
        costUsd: 0.003,
      },
    };
  },
});
How the 5 Core Things Are Implemented Inside the SDK
Here is what the SDK builds under the hood so any developer can use it in 5 minutes:

1. Schema Declaration (inputSchema & outputSchema)
How it works:
In TypeScript, it accepts zod schemas. In Python, it accepts pydantic.BaseModel.
The SDK automatically generates and hosts:
http
GET /schema
When the marketplace hits GET /schema, the SDK returns the standard JSON Schema. The marketplace UI uses this to automatically render the form fields for buyers (input textboxes, dropdowns, sliders).
2. Authentication & Handshake (auth)
How it works:
The SDK injects an authentication middleware in front of all routes.
When the marketplace calls POST /execute, it includes an X-Marketplace-Signature header (HMAC SHA-256 generated from the payload and shared secret).
The SDK validates the signature. If a random user tries to hit the URL directly, it responds 401 Unauthorized without burning the creator's tokens.
3. Ping & Health Checks (health & dry_run)
How it works:
The SDK automatically mounts:
http
GET /health
Returning { status: "ready", uptime: process.uptime(), version: "1.0.0" }.
When the marketplace runs the 3-step verification ping, it sends POST /execute with { dryRun: true }.
The SDK intercepts this flag, calls the creator's onDryRun() hook (checking API keys and network access), and returns 200 OK without running LLM tokens.
4. Telemetry & Cost Accounting (telemetry)
How it works across all frameworks:
Pydantic AI: The SDK reads result.usage() (input tokens, output tokens).
OpenAI SDK: The SDK reads response.usage.total_tokens.
CrewAI / LangGraph: The SDK reads crew.usage_metrics or Langfuse callback data.
The SDK computes: $$\text{duration_ms} = \text{Date.now}() - \text{startTime}$$
The final response automatically includes:
json
"telemetry": {
  "tokens": 1280,
  "cost_usd": 0.0028,
  "duration_ms": 3410
}
The marketplace uses this exact data to capture PayPal escrow.
5. Execution Wrapper & Error Handling (execute & streaming)
How it works:
Streaming: The SDK inspects the incoming request header Accept: text/event-stream. If the client requested SSE, the SDK automatically keeps the connection alive, manages the SSE formatting (event: progress\ndata: ...\n\n), and handles clean disconnects.
Error Normalization: If the agent throws an error, hits a rate limit, or runs out of budget, the SDK catches it and maps it to standard marketplace error codes:
INVALID_INPUT $\to$ Bad buyer arguments.
PROVIDER_RATE_LIMIT $\to$ OpenAI/Groq rate limited.
EXECUTION_TIMEOUT $\to$ Took longer than max allowed time.
INTERNAL_ERROR $\to$ Code crash.
This allows the marketplace to cleanly notify the user and void their PayPal authorization if the agent failed.



=========================

#MUST KNOW 
D. One adapter cannot automatically understand every framework
The document implies the SDK can inspect usage across Pydantic AI, OpenAI SDK, CrewAI and LangGraph using known fields and callbacks.
This is a good abstraction goal, but usage APIs are not interchangeable. For example, CrewAI's documentation distinguishes total Flow usage from the token usage of the last returned Crew. 
GitHub
Required correction: build separate adapters with explicit capabilities, normalize their outputs into one telemetry schema, and record which measurements are exact, estimated or unavailable. Do not claim full framework support until each adapter passes integration tests.


. The example telemetry contains fabricated fallback values
Your document includes this example:
tokens: result.metadata?.tokens || 1500,
costUsd: 0.003,
This is not production-safe accounting.
If the metadata is missing, the code reports 1,500 tokens whether the agent actually used 100, 5,000 or zero tokens. The fixed cost is also not derived from provider usage or current pricing.
Your marketplace could charge the wrong amount, report incorrect creator earnings, and display misleading usage statistics. A plausible-looking telemetry object is not proof of actual cost.
Required correction: use actual provider-reported usage and a versioned pricing table where available. Mark missing or estimated costs as unknown or estimated, and never silently substitute invented values for billing data.



There are three limitations you must account for:
- Some providers or frameworks do not expose all token-usage details.
- LLM cost is not the same as total agent cost: Firecrawl, SerpAPI, other tools and infrastructure may incur separate charges.
- If an agent calls a model directly without passing through your instrumentation, the SDK cannot guarantee complete telemetry.