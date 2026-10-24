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