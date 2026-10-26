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


Suggested task
Require auth and longer IDs for GET /tasks/:id
Security issue found in the Catelog TypeScript SDK at sdk/ts-sdk/ (repo: ronitrai27/Agentic-marketplace).

Problem (verified by running an agent with NODE_ENV=production and CATELOG_SECRET_KEY set):

GET /tasks/:id (handled in src/agent.ts, router around line 304, handleTaskPoll around line 774) does NOT call security.authenticateRequest. With a secret key configured, curl localhost:PORT/tasks/<run_id> with no Authorization header returns HTTP 200 with the full output and telemetry. /execute correctly returns AUTH_MISSING_KEY / AUTH_INVALID_KEY.
Run IDs created for Bearer/public/dev callers are run- + randomUUID().slice(0, 8) (see src/security.ts lines ~123, 174, 192, 199, 225), only 32 bits of entropy. limits.rateLimit applies to /execute only, so /tasks can be brute-forced without limit.
Impact: outputs derived from user uploads (e.g. a job-matching agent fed a resume) can be read by anyone who obtains or guesses the run id.


Wanted:

Require the same authentication on GET /tasks/:id as on /execute (Bearer secret key, and HMAC gateway headers). IMPORTANT: check how the marketplace gateway polls (HMAC headers, nonce replay cache, activeRunIds / completedRunIds in SecurityManager) so legitimate polling is not rejected as a replay or run-id mismatch. Dev mode (no secret, NODE_ENV != production) must keep working with no auth.
Use the full randomUUID() (or at least 128 bits) for generated run ids.
Apply the rate limit (limits.rateLimit) to the poll route too, or document why not.
Add tests in test/features.test.ts (or a new test file wired into npm test): poll without key -> 401 AUTH_MISSING_KEY in production mode; poll with the correct bearer key -> 200; dev mode poll -> 200.
Update USAGE.md / Catelog-TS.md auth section ("Authentication" table) to state that /tasks requires auth.
Run npm test and npm run build. Do not publish to npm; the maintainer publishes.