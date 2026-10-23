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