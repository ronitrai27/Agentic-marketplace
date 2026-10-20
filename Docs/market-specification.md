# Marketplace Agent Protocol Specification (MAPS)
**Protocol Version:** `1.0.0`  
**Status:** Canonical Specification (Revised)  
**Target Environments:** TypeScript (`@marketplace/sdk`), Python (`marketplace-sdk`), and Marketplace Gateway Core

---

## 1. Architectural Boundaries & Core Invariants

The protocol enforces the following non-negotiable architectural boundaries:

1. **Explicit Schemas Only:** Input and output schemas MUST be declared explicitly as standard JSON Schemas (Draft-07 or 2020-12). The SDK will not inspect or guess capabilities from framework internals (e.g., LangGraph nodes or CrewAI tasks).
2. **Gateway is the Sole Billing Authority:** The marketplace gateway manages all PayPal authorizations, wallet holds, captures, refunds, and creator payouts. Agent-reported telemetry and error codes are treated as corroborating evidence, not unilateral financial authorities.
3. **Decoupled Pricing:** Retail price per run is configured and persisted exclusively in the Marketplace listing records. Any price, token rate, or cost value reported by an agent is treated as non-authoritative telemetry.
4. **Pre-Execution Input Validation:** The gateway validates all buyer arguments against the agent's registered `input_schema` **before** dispatching a run or locking escrow. Invalid input is rejected at the gateway with zero buyer charges and zero agent invocations.
5. **Privacy & Secret Hygiene:** Agents MUST NEVER stream or return internal prompt scratchpads, hidden graph state, environment variables, or private API credentials. Telemetry is restricted to public step labels, token aggregates, and latency.
6. **Health Checks Are Liveness Only:** A `200 OK` on `GET /health` confirms network reachability and process uptime. It does not certify that downstream third-party credentials (e.g., OpenAI, SerpAPI, Firecrawl) have positive balances or that complex executions will succeed.
7. **Zero-Trust BYOS (Bring Your Own Server):** The gateway treats all creator URLs as untrusted and implements strict SSRF defenses, DNS rebinding guards, and network egress controls.

---

## 2. Endpoints & Transport

Every compliant agent server MUST expose three HTTP endpoints under its public base URL (e.g., `https://agent.example.com`):

| Endpoint | Method | Transport | Purpose |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | `application/json` | Liveness and protocol version probe |
| `/schema` | `GET` | `application/json` | Returns the **AgentManifest instance document** |
| `/execute` | `POST` | `text/event-stream` or `application/json` | Executes the agent task with streaming or batch output |

---

## 3. Authentication & Anti-Replay Security

All requests to `/execute` MUST be authenticated using canonical HMAC-SHA256 signatures with nonce tracking and timestamp verification to prevent replay attacks, unauthorized execution, and tampering.

### 3.1. Request Headers
```http
POST /execute HTTP/1.1
Host: agent.example.com
Content-Type: application/json
Accept: text/event-stream
X-Marketplace-Protocol: 1.0.0
X-Marketplace-Timestamp: 1729408400000
X-Marketplace-Nonce: 4b68e9e1-88f5-4f0e-b762-cb0d31e9c20a
X-Marketplace-Run-Id: run_01JAZ8Y78N4Q8E8W2M9T5K1V2R
X-Marketplace-Signature: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

### 3.2. Canonical Signature Format

The signature signs the HTTP method, normalized path, timestamp, nonce, run ID, and SHA-256 hash of the raw request body:

$$\text{BodyHash} = \text{HEX}(\text{SHA256}(\text{RawRequestBodyBytes}))$$

$$\text{CanonicalString} = \text{METHOD} + "\backslash\text{n}" + \text{PATH} + "\backslash\text{n}" + \text{TIMESTAMP} + "\backslash\text{n}" + \text{NONCE} + "\backslash\text{n}" + \text{RUN\_ID} + "\backslash\text{n}" + \text{BodyHash}$$

$$\text{Signature} = \text{HEX}(\text{HMAC-SHA256}(\text{Secret}, \text{CanonicalString}))$$

#### Example Canonical String
```
POST
/execute
1729408400000
4b68e9e1-88f5-4f0e-b762-cb0d31e9c20a
run_01JAZ8Y78N4Q8E8W2M9T5K1V2R
a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0
```

### 3.3. Anti-Replay & Idempotency Rules
The agent SDK MUST enforce the following checks before invoking user code:
1. **Timestamp Bounds:** Reject requests if $|\text{CurrentTime} - \text{Timestamp}| > 300{,}000\text{ ms (5 minutes)}$.
2. **Nonce Uniqueness:** Maintain an in-memory sliding cache (with TTL = 5 minutes) of processed `X-Marketplace-Nonce` values. Reject duplicate nonces immediately with `401 Unauthorized` (`AUTH_REPLAY_DETECTED`).
3. **Run ID Idempotency:** Reject duplicate `X-Marketplace-Run-Id` requests that are currently executing or already processed.

---

## 4. BYOS Gateway Security & SSRF Defenses

Because creators provide their own server URLs, the Marketplace Gateway MUST treat all registered URLs as untrusted and enforce rigorous egress protections:

1. **Protocol Restriction:** Enforce `https://` only in production. Disallow `http://`, `file://`, `ftp://`, or any other scheme.
2. **IP Whitelisting & SSRF Blocking:**
   * Resolve DNS prior to dispatching outbound connections.
   * Prohibit connections to IPv4 and IPv6 private, reserved, or internal ranges:
     * Loopback: `127.0.0.0/8`, `::1`
     * RFC 1918 Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
     * Link-Local / Cloud Instance Metadata: `169.254.0.0/16`, `fe80::/10` (blocks AWS/GCP/Azure `http://169.254.169.254/latest/meta-data`)
     * Carrier-Grade NAT: `100.64.0.0/10`
3. **DNS-Rebinding Protection:** Pin the validated IP address obtained during DNS resolution and connect directly to that IP with the SNI header set to the hostname.
4. **Redirect Policy:** Gateway HTTP clients MUST disable automatic redirect following (`max_redirects: 0`). Redirect responses (`301`, `302`, `307`, `308`) must be aborted and flagged as invalid.
5. **Connection & Resource Limits:**
   * Connection establishment timeout: **3 seconds**.
   * Max request body size: **2 MB**.
   * Max response header size: **16 KB**.

---

## 5. Endpoints & Data Schemas

### 5.1. `GET /health` (HealthCheckResponse)

Proves process liveness and protocol compliance.

```json
{
  "status": "ready",
  "protocol_version": "1.0.0",
  "uptime_seconds": 1845.2,
  "environment_ready": true
}
```

---

### 5.2. `GET /schema` (AgentManifest Instance)

Returns the **instance document** of the agent manifest. This contains metadata and the explicit JSON Schemas defining the input and output contracts.

#### Manifest Document Example
```json
{
  "id": "universal-lead-finder",
  "name": "Universal B2B Lead Finder",
  "version": "1.2.0",
  "description": "Discovers and enriches verified B2B leads from search engines and company registries",
  "protocol_version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "delta_stream": false,
    "max_timeout_seconds": 300
  },
  "input_schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["query"],
    "additionalProperties": false,
    "properties": {
      "query": {
        "type": "string",
        "title": "Search Query",
        "description": "Target company niche or industry (e.g. Fintech in Austin)",
        "minLength": 3,
        "maxLength": 500
      },
      "target_count": {
        "type": "integer",
        "title": "Target Leads Count",
        "default": 10,
        "minimum": 1,
        "maximum": 50
      }
    }
  },
  "output_schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["leads_count", "leads"],
    "properties": {
      "leads_count": { "type": "integer" },
      "leads": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["company_name", "domain"],
          "properties": {
            "company_name": { "type": "string" },
            "domain": { "type": "string" },
            "contact_email": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

### 5.3. `POST /execute` (ExecuteRequest)

Dispatched by the Gateway to execute a run.

#### JSON Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExecuteRequest",
  "type": "object",
  "required": ["run_id", "input"],
  "properties": {
    "run_id": {
      "type": "string",
      "description": "Unique run ID generated by marketplace gateway (UUIDv4)"
    },
    "input": {
      "type": "object",
      "description": "Buyer-supplied arguments already pre-validated against input_schema"
    },
    "deadline_ms": {
      "type": "integer",
      "description": "Epoch timestamp in milliseconds after which the agent must abort"
    },
    "metadata": {
      "type": "object",
      "properties": {
        "buyer_id": { "type": "string" },
        "session_id": { "type": "string" }
      }
    }
  }
}
```

---

### 5.4. Batch Response: `ExecuteResponse` (Strict Conditional Schema)

The batch execution response uses strict conditional validation: `succeeded` requires `output` and forbids `error`; `failed` or `cancelled` requires `error` and forbids `output`.

#### JSON Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExecuteResponse",
  "type": "object",
  "required": ["run_id", "status", "duration_ms"],
  "properties": {
    "run_id": { "type": "string" },
    "duration_ms": { "type": "integer", "minimum": 0 },
    "telemetry": {
      "type": "object",
      "properties": {
        "llm_tokens": {
          "type": "object",
          "properties": {
            "prompt": { "type": "integer" },
            "completion": { "type": "integer" },
            "total": { "type": "integer" }
          }
        },
        "model_used": { "type": "string" }
      }
    }
  },
  "oneOf": [
    {
      "properties": {
        "status": { "const": "succeeded" },
        "output": { "type": "object" },
        "error": false
      },
      "required": ["status", "output"]
    },
    {
      "properties": {
        "status": { "enum": ["failed", "cancelled"] },
        "error": { "$ref": "#/definitions/StructuredError" },
        "output": false
      },
      "required": ["status", "error"]
    }
  ],
  "definitions": {
    "StructuredError": {
      "type": "object",
      "required": ["code", "message", "retryable"],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "INVALID_INPUT",
            "MODEL_RATE_LIMIT",
            "UPSTREAM_TIMEOUT",
            "EXECUTION_TIMEOUT",
            "INTERNAL_CRASH",
            "TOOL_FAILURE"
          ]
        },
        "message": { "type": "string" },
        "retryable": { "type": "boolean" },
        "details": { "type": "object" }
      }
    }
  }
}
```

---

## 6. Streaming Event Protocol (`text/event-stream`)

When `Accept: text/event-stream` is requested, the SDK server streams SSE events with standard framing:

```
event: <EVENT_TYPE>\n
data: <JSON_STRING>\n\n
```

### 6.1. Event Ordering & Lifecycle
Every execution stream MUST observe one of two terminal paths:

```
Normal Path:
run.started ──▶ (step.started | output.delta | heartbeat)* ──▶ run.succeeded

Failure Path:
run.started ──▶ (step.started | heartbeat)* ──▶ run.failed
```

### 6.2. Event Definitions

#### 1. `run.started`
Emitted immediately upon acknowledging the request.
```json
{
  "event": "run.started",
  "run_id": "run_01JAZ8Y78N4Q8E8W2M9T5K1V2R",
  "timestamp": 1729408401000
}
```

#### 2. `step.started`
Emitted when an agent transitions state, runs a tool, or performs reasoning.
```json
{
  "event": "step.started",
  "run_id": "run_01JAZ8Y78N4Q8E8W2M9T5K1V2R",
  "step_index": 1,
  "label": "Searching Google for B2B SaaS in Austin",
  "timestamp": 1729408402500
}
```

#### 3. `output.delta` (Optional Incremental Streaming)
For agents that stream incremental text, Markdown, or JSON deltas to the UI.
* `delta_type`: `"text"` (appended) or `"json_patch"` (RFC 6902).
* `content`: The string delta chunk.
* `index`: Monotonically increasing sequence number (0, 1, 2...).

```json
{
  "event": "output.delta",
  "run_id": "run_01JAZ8Y78N4Q8E8W2M9T5K1V2R",
  "index": 0,
  "delta_type": "text",
  "content": "### Austin B2B Companies\n1. Company A"
}
```

#### 4. `heartbeat`
Emitted automatically by the SDK every **15 seconds** during execution. Prevents AWS ALB, Cloudflare (Error 524), and reverse proxy timeouts.
```json
{
  "event": "heartbeat",
  "timestamp": 1729408417500
}
```

#### 5. `run.succeeded` (Terminal Event)
Emitted when the run successfully completes. Contains the **canonical complete output object** matching `output_schema` (even if `output.delta` was used). The stream MUST close immediately after this event.
```json
{
  "event": "run.succeeded",
  "run_id": "run_01JAZ8Y78N4Q8E8W2M9T5K1V2R",
  "duration_ms": 5420,
  "output": {
    "leads_count": 2,
    "leads": [
      { "company_name": "Acme Inc", "domain": "acme.com" },
      { "company_name": "Beta Labs", "domain": "betalabs.io" }
    ]
  },
  "telemetry": {
    "llm_tokens": { "total": 1420 },
    "model_used": "gpt-4o-mini"
  }
}
```

#### 6. `run.failed` (Terminal Event)
Emitted when execution fails, aborts, or times out. Contains the `StructuredError`. The stream MUST close immediately after this event.
```json
{
  "event": "run.failed",
  "run_id": "run_01JAZ8Y78N4Q8E8W2M9T5K1V2R",
  "duration_ms": 2100,
  "error": {
    "code": "MODEL_RATE_LIMIT",
    "message": "OpenAI TPM quota reached on gpt-4o-mini",
    "retryable": true
  }
}
```

---

## 7. Gateway Billing & Escrow Decision Engine

To prevent fraudulent error reporting or malicious chargeback exploitation, **the Gateway is the sole billing arbiter**. The Gateway records independent telemetry and applies deterministic billing rules:

| Scenario / Observation | Gateway Evidence | Escrow & Billing Action |
| :--- | :--- | :--- |
| **Buyer Input Invalid** | Gateway JSON Schema validator rejects request | **Zero Charge.** Request aborted before hitting agent or PayPal. |
| **Clean Success** | `run.succeeded` received + output passes `output_schema` | **Capture Retail Fee** from PayPal hold; disburse creator earnings. |
| **Agent Crash (5xx / Unhandled)** | HTTP `500` or `run.failed` with `INTERNAL_CRASH` | **100% Refund / Void Hold.** Buyer charged $0.00. |
| **Upstream Provider Rate Limit** | `run.failed` with `MODEL_RATE_LIMIT` | **100% Refund / Void Hold.** Buyer charged $0.00. |
| **Gateway Timeout / Socket Drop** | Agent silent > 60s or connection dropped without terminal event | **100% Refund / Void Hold.** Buyer charged $0.00. |
| **Malformed Output** | `run.succeeded` output fails registered `output_schema` | **100% Refund / Void Hold.** Treated as creator contract violation. |
| **Buyer Abort** | Buyer actively terminates running job within first 15 seconds | **100% Refund / Void Hold.** Buyer charged $0.00. |

---

## 8. Error Codes Reference

| Error Code | HTTP Status | Definition |
| :--- | :--- | :--- |
| `AUTH_INVALID_SIGNATURE` | `401` | HMAC signature mismatch |
| `AUTH_TIMESTAMP_OUT_OF_BOUNDS` | `401` | Timestamp differs from server clock by > 5 minutes |
| `AUTH_REPLAY_DETECTED` | `401` | Nonce or Run ID has already been executed |
| `INVALID_INPUT` | `400` | Input payload violated `input_schema` |
| `MODEL_RATE_LIMIT` | `429` | Upstream LLM provider returned rate limit or quota exceeded |
| `UPSTREAM_TIMEOUT` | `504` | External API (SerpAPI, Firecrawl) timed out |
| `EXECUTION_TIMEOUT` | `504` | Agent run exceeded `deadline_ms` |
| `INTERNAL_CRASH` | `500` | Uncaught runtime exception in creator logic |
| `TOOL_FAILURE` | `502` | Downstream tool returned unexpected error |

---

## 9. Protocol Checklist for SDK Implementations

Both `@marketplace/sdk` (TypeScript) and `marketplace-sdk` (Python) MUST implement:
* [ ] Canonical signature calculation: `METHOD\nPATH\nTIMESTAMP\nNONCE\nRUN_ID\nBODY_HASH`.
* [ ] Sliding in-memory LRU cache for nonces (5-minute TTL).
* [ ] Strict conditional JSON Schema validation for `ExecuteResponse`.
* [ ] SSE engine supporting `run.started`, `step.started`, `output.delta`, `heartbeat` (15s interval), `run.succeeded`, and `run.failed`.
* [ ] Clean disconnect handling: if client drops, abort the underlying execution context (`AbortSignal` / `asyncio.CancelledError`).
