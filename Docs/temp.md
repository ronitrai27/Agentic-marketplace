 The Two-Key Model (Pure Production)
Publishable Key (cat_pub_live_...):
Publicly safe, lives on frontend / client SDK, identifies the creator workspace.
Always visible and easily copyable.
Secret Key (cat_sec_live_...):
High-privilege (agent publishing, tool endpoints, webhooks, payouts).
Revealed strictly ONCE upon creation or rotation.
Stored in DB via salted SHA-256 hash (key_hash). Only preview chars (cat_sec_live_...xxxx) stored for UI display.
2. Security & Control Surface per Key
Expiry: 10, 30, 60, 90 days, Custom date, or Never (with security confirmation).
Zero-Downtime Rotation:
Option to roll the key with a configurable grace period (e.g. 24h or 48h where both keys remain valid so production servers don't drop traffic during deployment).
Killswitch / Revoke: Instant revocation that invalidates the hash immediately in DB and cache.
Geo-Fencing (Allowed Regions): Default: All Regions, or restricted to specific regions (e.g., us-east-1, eu-central-1, ap-south-1, etc.).
IP Allowlisting (CIDR): Optional comma/newline-separated list of allowed IPs/subnets (e.g., 192.168.1.5, 10.0.0.0/16).
Rate Limiting: Configurable ceiling (e.g., max requests/sec or daily limit) to prevent runaway loops or credit drain.
Access Telemetry & Live Fingerprint:
Shows Last used: 2m ago from 54.210.x.x (US-East)
Ready hook for the future access map/chart (region, IP, calls breakdown).
Webhook Signatures:
SDK tamper verification using X-Catelog-Signature: sha256=... HMAC.
3. How the UI / Flow Will Be Built
Credentials Dashboard Page (in Creator Space navigation):
Top Section: Public Key Card with 1-click copy, quick test snippet, and security status.
Main Section: Secret Key Table / Cards:
Masked key preview (cat_sec_live_9f8a••••••••4b12)
Expiry indicator (with color-coded badge: Active, Expiring Soon, Expired)
Region & IP badges
Rate limit badge
Last used telemetry
Action menu: Rotate (with grace period) | Configure Rules (Region/IP/Rate) | Revoke
Empty / Add Key Action: Primary action to generate a secret key.
"Generate Secret Key" Modal:
Form to set Expiry, Allowed Regions, IP Allowlist, and Rate Limit.
One-Time Secret Reveal Modal:
High-contrast secure card with copy button.
Clear warning: "Save this key in your environment variables (.env). It will never be displayed again."
"Rotate Key" Modal:
Grace period selector (Instant / 24 hours / 48 hours).


==========================

Correction: the gateway is not as secure as I said
I said the gateway was secure and the keys were ready. That was too strong. Problems in the code I wrote:

Weak key generation: keys come from Math.random(), which isn't cryptographically secure. They should be generated with crypto.getRandomValues, server-side.

Not salted: the hash is plain SHA-256. Both the UI text and I called it "salted". For random keys that's acceptable, but adding a server-side secret (HMAC-SHA256) is better.

Hash is computed in the browser: Convex stores whatever hash the client sends. Generation and hashing should both happen in a Convex action.

Anyone can call verifyApiKey: it's a public mutation. It should be an internalMutation called only from an HTTP action.

Rate limit is stored but never enforced. The IP check is exact-match only, so CIDR ranges don't work.
No schema.ts or indexes: every lookup scans the whole table.

sdk/verifyApiKey.ts is in the wrong layer. Agent servers already check Catelog's HMAC signature. API keys are for creator → Catelog calls, so the gateway should check them, not the agent.
None of this blocks the UI, but it needs fixing before production.