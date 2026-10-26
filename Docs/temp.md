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



## SDK imporvemntes TODO
Restart behavior: with the default memory store, a redeploy still turns a poll into a 404. The Redis and SQLite stores fix finished jobs, not running ones.
No cancel route: async tasks have no POST /tasks/:id/cancel, which I flagged earlier and we haven’t built.