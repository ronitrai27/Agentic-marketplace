# Contradictor and Alternative Finder

Two independent Catelog 1.3.0 services share a Gemini Google Search adapter. The adapter returns provider grounding links alongside the passages they support. A result without grounding fails the run.

## Run locally

Use Node 22.14 or later. Run npm ci, set AGENT_KIND to contradictor or alternative-finder, then run npm start. Set GOOGLE_API_KEY, GEMINI_MODEL (a Gemini model enabled for Google Search grounding), and CATELOG_SECRET_KEY through your environment. Use a distinct JOB_DB file per process.

- GET /health reports whether required settings are present.
- GET /schema returns the Catelog manifest and the fixed scope per run.
- POST /execute accepts {"input":{"claim":"..."}}, or {"input":{"request":"..."}} for Alternative Finder, and returns a poll URL.
- GET the poll URL with the Catelog secret as a Bearer token. Use the SDK event cursor to fetch progress. The marketplace gateway must authenticate buyers, enforce run ownership, and relay progress to its browser SSE connection. The agents do not expose a buyer-facing polling API.

## Deploy on Render

Create two Node web services from this repository with root directory Agents/WebSearchAgents, build command npm ci, start command npm start, and health check path /health. Give each service its own AGENT_KIND and secrets. Keep secrets in Render environment settings. The provided test credential is not required for building the service.

For persistence across deployments attach a persistent volume per service and set JOB_DB to /data/jobs.sqlite. Free Render services have ephemeral storage. The SDK persists results and reports interrupted tasks as retryable failures. A marketplace durable scheduler must own retry policy and idempotent billing; the agent can finish a request after its client disconnects but does not restart interrupted work itself.

Use one bounded search request per billable run and limit Alternative Finder to three suggestions. Configure the price in Catelog. The agent manifest describes the scope and does not charge customers.

Before publishing, run a live search on each service, verify gateway polling with authentication and three distinct buyers, and confirm a run stays visible after a browser disconnect. The local npm test command uses a fixture and does not spend provider credits.
