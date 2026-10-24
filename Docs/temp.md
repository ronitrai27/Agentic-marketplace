## convex schema 

convex/
├── betterAuth/
│   └── schema.ts        ← COMPONENT schema (BetterAuth owns this)
│       Tables: user, session, account, verification, jwks
│       Who manages it: the betterAuth Convex component internally
│       Can you query these? Yes, via components.betterAuth.adapter.*
│
└── schema.ts             ← YOUR APP schema (you own this)
    Tables: creator_api_keys, creator_public_keys, api_key_rate_windows
    Who manages it: your apiKeys.ts mutations/actions
    Can you query these? Yes, via ctx.db.query(...) directly



## security
#	Problem	Solution
1	Discovery — How do you know the agent is legit?	Dev registers URL → marketplace calls /health + /schema to verify protocol compliance
2	Trust — How do you know the agent won't steal buyer data?	Marketplace signs all requests with HMAC (your SDK already does this) + TOS agreement
3	Reachability — Dev's server is behind a firewall?	Require public URL. Optionally offer a tunnel service (like ngrok but yours)
4	Key provisioning — How does the agent authenticate marketplace calls?	On registration, marketplace generates cat_sec_* + cat_pub_* → displays them ONCE → dev puts in their .env
5	Health monitoring — Agent goes down mid-rental	Marketplace pings /health every 60s. If fails → suspend rentals → notify dev


=============================================

## live agent  - resarch2
https://researchagent2-ufhs.onrender.com/health
{"status":"ready","protocol_version":"1.0.0","uptime_seconds":90,"environment_ready":true,"capabilities":{"streaming":true,"delta_stream":true,"max_timeout_seconds":300,"execution_modes":["sync"]}}


=========================================

## reponses 

🎉 It worked seamlessly! Look at that full SSE event stream and telemetry!

Here is the exact response received from https://researchagent2-ufhs.onrender.com/execute:

sse
event: task.status
data: {"event":"task.status","run_id":"run-166082d6","status":"working","timestamp":1792770364472}
event: task.progress
data: {"event":"task.progress","run_id":"run-166082d6","percent":0,"message":"Running web search with gpt-6-luna...","step":1,"timestamp":1792770364473}
event: task.delta
data: {"event":"task.delta","run_id":"run-166082d6","index":0,"delta_type":"text","content":"4"}
event: task.completed
data: {
  "event": "task.completed",
  "run_id": "run-166082d6",
  "duration_ms": 3219,
  "output": {
    "answer": "4",
    "model": "gpt-6-luna",
    "mode": "fast",
    "duration_seconds": 3.2
  },
  "telemetry": {
    "input_bytes": 49,
    "chunks_streamed": 1,
    "framework": {
      "adapter": "openai-responses",
      "custom_metrics": {}
    },
    "llm_tokens": {
      "prompt": 4449,
      "completion": 5,
      "total": 4454
    },
    "cost_usd": 0.02232,
    "model_used": "gpt-6-luna",
    "duration_ms": 3219,
    "output_bytes": 72
  }
}
Key Highlights Verified:
Liveness & Schema: /health and /schema contracts pass 100%.
Dual-Mode Security: Bearer key authentication verified and authorized.
SSE Streaming: Progress and text deltas stream in real-time.
Task Lifecycle: task.status (working) → task.progress → task.delta → task.completed.
Full Telemetry: Token count (4454 tokens), cost calculation ($0.02232), duration (3219ms), output byte size, and adapter metadata are all tracked and emitted properly.



. The Big Picture: Why Developer Keys Even Exist
Imagine a developer named Alex builds a Research Agent and hosts it on Render: https://alex-agent.onrender.com

The Problem:
If Alex deploys his agent to the public internet with no security, any random hacker on the internet could send 10,000 requests to https://alex-agent.onrender.com/execute, burn all of Alex's OpenAI credits, and crash his server for free!

Alex needs a bouncer at the door of his server. That is what the Catelog SDK does.

2. What the 2 Keys Are For
Think of it like Stripe (which has a pk_live_... and a sk_live_...):

A. The Secret Key (cat_sec_live_...) — The Master Key
Who has it: Only the Developer and the Marketplace Backend.
Where it lives: Put in the developer's agent server .env file on Render:
env
CATELOG_SECRET_KEY=cat_sec_live_fe47...
What it does: When a buyer clicks "Run" on Catelog, Catelog's server calls Alex's agent on Render and says:
"Hey Alex, here is your Secret Key. I am Catelog, I already took money from the buyer, please run this research for us."
Alex's agent checks the key, says "Key matches! This is officially from Catelog", and runs.
Can a buyer see it? NEVER. It is never sent to the browser.
B. The Public Key (cat_pub_live_...) — The Safe Badge
What it does: Safe to expose publicly. It only allows read-only public calls like:
GET /health (Is the agent alive?)
GET /schema (What inputs does this agent need?)
It cannot run the agent or spend any money/compute.
3. Why You (The Buyer) Don’t Need Any Key
You are 100% right! A buyer is like an Uber rider or an Amazon shopper:

When you take an Uber, you don’t need an API key. You just log into the Uber app, add money to your wallet, and click "Order Ride".
When a buyer uses Catelog:
Buyer logs in with Google/Email.
Buyer has $10 in their wallet.
Buyer clicks "Run Research Agent" with prompt: "Summarize AI trends".
Catelog does all the key work in the background!
 [Buyer in Browser]
       │
       │ 1. Logs in + pays $0.50 from Wallet (NO KEY NEEDED)
       ▼
 [Catelog Marketplace]
       │
       │ 2. Logs Audit Trail (Buyer email, IP, Region, Query)
       │ 3. Attaches Developer's Secret Key
       ▼
 [Developer's Agent on Render]
       │
       │ 4. Verifies Secret Key -> Executes LLM / Code
       ▼
 [Catelog Marketplace]
       │
       │ 5. Records time taken (e.g. 2.4s) & credits creator revenue
       ▼
 [Buyer gets answer!]


==================================

Create the Execution & Audit Log table in Convex
Add a table in Convex (execution_logs) to track every call:

Agent Name (e.g., ResearchAgent, CompetitorAgent)
Buyer Info (Email / User ID)
Caller IP & Region (e.g., 198.51.100.42, US-East)
Input Query (What the user asked)
Execution Time (e.g., 2.4s)
Status (Success or Failed)
Buyer Rating (★ 1 to 5 stars)
Step 2: Build the Creator Analytics & Audit Dashboard
Build the page matching your design screenshot:

Top Metric Cards: Total Traffic/Calls, Revenue Earned, Success Rate, Avg Latency.
Trends Chart: Visual graph showing calls and performance over time.
Audit Table with Expandable Rows: Click any row to expand and see:
Full prompt & response preview
Caller's IP address and country/region
Token usage and duration
Buyer rating and feedback