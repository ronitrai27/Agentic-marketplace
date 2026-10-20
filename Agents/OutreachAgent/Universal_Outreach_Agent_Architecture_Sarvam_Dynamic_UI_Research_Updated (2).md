# Universal Outreach Agent — Architecture & Technical Specification

## 1. System Pattern: One Universal Outreach Agent with Multiple Channel Modes

The marketplace will initially expose **one public `universal-outreach-agent`**. Users select the channel they want to use—such as email or voice—through the agent's typed configuration. Voice execution is implemented through a Sarvam adapter connected to a voice agent configured in Sarvam.

Do **not** create two independent outreach systems at the beginning. The normal and voice paths share the same marketplace contract, recipient identity, authorization rules, approval model, durable execution, audit trail, and normalized output. Their provider-specific execution paths remain separate behind channel adapters.

### Supported execution modes

**Normal outreach**
- Email outreach and follow-ups through an approved messaging provider.
- Personalized message generation.
- Drafting, approval, scheduling, submission, and status tracking.

**Voice outreach**
- Outbound AI phone calls through Sarvam Voice Agents, subject to account, API, and telephony availability.
- Configured conversations for lead qualification, appointment requests, surveys, or follow-up.
- Call status, structured outcomes, and follow-up recommendations returned through the marketplace contract.

### Core architectural decisions

1. One public Universal Outreach Agent with `email` and `voice` channel modes.
2. Configure the actual voice agent in Sarvam's platform; the marketplace stores its identifier and a versioned configuration reference.
3. Integrate Sarvam through a provider adapter. Do not make Sarvam-specific payloads part of the universal public contract.
4. Pydantic v2 models define canonical input/output contracts; publish versioned JSON Schema for the marketplace.
5. Pydantic AI handles language generation, personalization, and structured extraction where needed. Sarvam's managed voice platform handles the real-time voice interaction in the recommended first version.
6. Trigger.dev handles durable background tasks, retries, concurrency, scheduling, and event-driven continuation.
7. The marketplace—not Trigger.dev or Sarvam—owns the agent registry, workflow graph, typed edges, field mapping, authorization, approval decisions, and workflow state.
8. Every execution returns a normalized result, including partial success and provider uncertainty.
9. External actions require explicit authorization, applicable consent, suppression checks, and audit records.
10. A separate marketplace listing such as `voice-outreach-agent` may be added later if discovery or independent configuration warrants it. Initially, it should reuse the same internal voice adapter and contracts rather than duplicate implementation.

### Responsibility boundary

- **Marketplace:** user experience, agent registry, contracts, graph orchestration, mapping, permissions, approval state, persistence, downstream routing.
- **Universal Outreach Agent:** channel-specific planning, personalization, validation, and dispatch coordination.
- **Trigger.dev:** durable execution of tasks and continuation after delays/events.
- **Sarvam Voice Agents:** configured voice conversation and the supported voice/telephony operations.
- **Messaging providers:** actual email or other approved text-channel delivery.

---

## 2. Architecture Diagram

```mermaid
flowchart TD
    User([User / Upstream Agent])
    Registry[Agent Registry and Versioned Schemas]
    Input[Input Contract Validator]
    Policy[Authorization and Policy Gate]
    Runtime[Durable Outreach Runtime]

    User --> Registry --> Input
    Input -->|Invalid| Error[Structured Validation Error]
    Input -->|Valid| Policy
    Policy -->|Rejected| Rejected[Policy Rejection]
    Policy -->|Allowed| Runtime

    Runtime --> Planner[Campaign Planner and Router]
    Planner --> Batch[Bounded Recipient Dispatcher]

    subgraph RecipientProcessing["Recipient Processing"]
        Context[Context and Evidence Resolver]
        Generate[Personalization Agent]
        Validate[Content and Schema Validator]
        Eligibility[Suppression and Eligibility Checks]

        Context --> Generate --> Validate --> Eligibility
    end

    Batch --> Context

    Eligibility --> Channel{Selected Channel}

    subgraph Normal["Normal Outreach"]
        Draft[Message Draft]
        Approval[Approval Controller]
        MessageAdapter[Message Provider Adapter]
        MessageState[Submission and Delivery Tracking]

        Draft --> Approval
        Approval --> MessageAdapter
        MessageAdapter --> MessageState
    end

    subgraph Voice["Voice Outreach"]
        CallPlan[Voice Conversation Configuration]
        VoiceApproval[Call Authorization and Approval]
        VoiceAdapter[Voice Provider Adapter]
        Sarvam[Sarvam AI]
        CallEvents[Call Events and Transcript]
        CallAnalysis[Call Outcome and Structured Extraction]

        CallPlan --> VoiceApproval
        VoiceApproval --> VoiceAdapter
        VoiceAdapter --> Sarvam
        Sarvam --> CallEvents
        CallEvents --> CallAnalysis
    end

    Channel -->|Email or supported messaging| Draft
    Channel -->|Voice| CallPlan

    MessageState --> Reducer[Result Reducer]
    CallAnalysis --> Reducer
    Reducer --> OutputValidator[Output Contract Validator]
    OutputValidator --> Persistence[Persist Results and Audit Events]
    Persistence --> Output[Normalized OutreachResult]
    Output --> Next([Downstream Workflow Agent])

    Runtime -.-> Observability[Tracing, Cost, Latency and Metrics]
    Persistence -.-> Observability
```

---

## 3. Components and Responsibilities

| Component | Implementation | Responsibility |
|---|---|---|
| Agent registry | Marketplace backend | Publishes manifests, capabilities, and schema versions. |
| Contract validator | Pydantic v2 / JSON Schema | Validates input and output contracts. |
| Campaign planner | Python orchestration | Selects channel, execution mode, recipient batches, and processing limits. |
| Context resolver | Approved search and CRM tools | Resolves available recipient context and evidence. |
| Personalization agent | Pydantic AI | Generates recipient-specific content or a structured voice conversation plan. |
| Content validator | Deterministic Python services | Checks structure, required fields, length, and content constraints. |
| Policy engine | Deterministic Python services | Enforces authorization, suppression, consent, and campaign policies. |
| Approval controller | Database-backed state machine | Manages message and call approval where required. |
| Message adapter | Provider-specific integration | Sends supported text-based communications. |
| Voice adapter | Provider-independent interface | Initiates calls and normalizes provider events. |
| Sarvam integration | Sarvam-supported API/integration | Executes configured voice conversations where the account and API support the use case. |
| Event processor | Webhooks and durable jobs | Processes call events, message events, and status changes. |
| Result reducer | Deterministic Python | Aggregates recipient results into a single validated output. |
| Observability | OpenTelemetry and optional Langfuse | Records latency, failures, cost, and execution traces. |

Do not implement every component as an independent LLM agent. Use AI for language reasoning and generation, and ordinary application code for validation, permissions, scheduling, idempotency, and state transitions.

---

## 4. Universal Input Contract

All compatible upstream agents must provide a payload that conforms to `OutreachInput`, or use a declared transformation to map their data into it.

```json
{
  "schema_version": "1.0.0",
  "request_id": "req_123",
  "objective": {
    "goal": "Start a relevant business conversation",
    "call_to_action": "Arrange an introductory meeting",
    "context": "Description of the offer or reason for outreach"
  },
  "recipients": [
    {
      "recipient_id": "recipient_001",
      "identity": {
        "name": "Jane Doe",
        "organization": "Example Inc",
        "role": "Operations Director"
      },
      "contact_points": [
        {
          "channel": "email",
          "address": "jane@example.com",
          "verification_status": "unknown"
        },
        {
          "channel": "voice",
          "address": "+911234567890",
          "verification_status": "unknown"
        }
      ],
      "context": {
        "facts": [],
        "custom_fields": {}
      }
    }
  ],
  "configuration": {
    "channel": "email",
    "tone": "professional",
    "language": "en",
    "personalization": "high",
    "instructions": [],
    "constraints": {
      "require_approval": true,
      "respect_suppression_lists": true,
      "max_actions_per_recipient": 1
    }
  },
  "execution": {
    "mode": "draft",
    "batch_id": "batch_001"
  }
}
```

### Contract rules

- `recipient_id` must remain stable across the workflow.
- `contact_points` may contain multiple channels, but only an explicitly selected and authorized channel may execute.
- Contact verification status must be explicit.
- `context.facts` should support evidence references and provenance.
- `custom_fields` allows domain-specific context without forcing a new schema for each industry.
- `configuration` controls message generation and campaign behavior.
- `execution.mode` defines whether the request is for drafting, scheduling, or execution.
- Missing information must remain missing rather than being fabricated by the model.

### Recommended enums

`channel`:

- `email`
- `voice`
- `linkedin`
- `whatsapp`
- Other channels only when an approved adapter is available.

`mode`:

- `draft`
- `schedule`
- `execute`

The application must reject unsupported combinations. For example, an email provider adapter must not receive a voice execution request.

---

## 5. Channel Abstraction

The public contract remains channel-neutral where possible. Channel-specific configuration belongs in typed configuration models.

### 5.1 Normal outreach configuration

```json
{
  "channel": "email",
  "provider": "configured_email_provider",
  "message_config": {
    "tone": "professional",
    "language": "en",
    "subject_required": true,
    "max_body_length": 5000
  },
  "delivery_config": {
    "require_approval": true,
    "scheduled_at": null
  }
}
```

Normal outreach processing:

1. Generate the message.
2. Validate content and channel-specific fields.
3. Apply recipient eligibility and suppression checks.
4. Persist the draft.
5. Obtain approval when required.
6. Submit through the configured provider.
7. Reconcile submission and delivery events.
8. Return a normalized result.

### 5.2 Voice outreach configuration

```json
{
  "channel": "voice",
  "provider": "sarvam",
  "voice_config": {
    "language": "en-IN",
    "conversation_goal": "Qualify the lead and request a meeting",
    "opening_message": "Hello, may I speak with Jane?",
    "max_duration_seconds": 300,
    "human_handoff_enabled": true,
    "recording_policy": "provider_and_workspace_policy"
  },
  "call_config": {
    "require_approval": true,
    "scheduled_at": null,
    "retry_policy_id": "voice_retry_default"
  }
}
```

This is an illustrative internal configuration, not a claim that these exact fields are accepted by Sarvam's API. The voice adapter must map the platform's configuration into the provider's documented request format.

Voice processing:

1. Validate the recipient and voice configuration.
2. Check calling authorization, applicable consent, calling hours, and suppression rules.
3. Generate or select the approved conversation instructions.
4. Obtain approval where required.
5. Submit the call through the voice adapter.
6. Record the provider's call identifier.
7. Process call events through authenticated webhooks or supported polling.
8. Normalize the outcome, transcript availability, and structured conversation results.
9. Return a validated result to the workflow runtime.

---

## 6. Sarvam AI Voice Integration

Sarvam provides both a managed Voice Agents platform and individual speech/model APIs. The architecture should support both, but select one execution path per deployment to avoid duplicating real-time voice orchestration.

Official documentation:
- Voice Agents introduction: https://docs.sarvam.ai/voice-agents/introduction
- Voice Agents overview: https://docs.sarvam.ai/voice-agents/overview
- Telephony and phone numbers: https://docs.sarvam.ai/voice-agents/deploy/telephony
- Model selection: https://docs.sarvam.ai/api/getting-started/models
- Speech-to-text: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
- Text-to-speech: https://docs.sarvam.ai/api-reference/text-to-speech/convert

### 6.1 Recommended path: Sarvam Voice Agents managed platform

For the first production version, prefer Sarvam Voice Agents if the account supports the required outbound campaign and integration features. Sarvam documents a managed platform for building, testing, deploying, and monitoring voice agents, with telephony options and outbound campaigns.

In this mode, Sarvam orchestrates the real-time speech recognition, conversational reasoning, and speech synthesis loop. The marketplace still owns workflow execution, agent contracts, consent and authorization checks, approval state, campaign limits, persistence, and downstream routing.

The marketplace flow becomes:

```text
Universal Outreach Agent
        |
        v
Marketplace policy + approval gate
        |
        v
Trigger.dev durable task
        |
        v
Sarvam Voice Agents adapter
        |
        v
Sarvam voice agent + configured telephony
        |
        v
Sarvam call events / status / results
        |
        v
Marketplace event processor
        |
        v
Normalized OutreachResult
        |
        v
CRM / Follow-up / Meeting Booking agents
```

The exact API operations, webhook/callback formats, outbound campaign endpoints, account permissions, telephony setup, pricing, and event payloads must be confirmed against the user's Sarvam workspace and the current documentation before implementation. Do not assume a managed-platform dashboard operation automatically corresponds to a public API endpoint.

### 6.2 Model-level path: assemble the voice pipeline yourself

If you need full control over the runtime, use Sarvam's model APIs with your own real-time audio transport, turn-taking logic, and telephony integration.

| Layer | Sarvam option | Responsibility |
|---|---|---|
| Speech-to-text (ASR) | `saaras:v4` | Transcribe caller audio; supports multiple output modes and Indic languages |
| Dialogue model | `sarvam-105b-conversations`, where available for the selected API/runtime | Generate conversational responses and select permitted tool calls |
| Text-to-speech (TTS) | `bulbul:v4-flash` or another supported Bulbul model | Convert response text into audio |
| Real-time voice runtime | Marketplace-owned runtime or a compatible voice-agent framework | Streaming, turn-taking, interruption/barge-in, timeouts, tool execution, and session state |
| Telephony | Sarvam-supported telephony connection or a separately integrated provider | Place/receive phone calls and transport audio |
| Durable campaign orchestration | Trigger.dev + marketplace runtime | Schedule call jobs, limit concurrency, recover failures, and process callbacks |

**Important:** these model APIs are not by themselves a complete outbound phone-calling system. The model-level path also needs a telephony connection and a low-latency runtime that manages streaming audio and conversation turns. Confirm the availability and exact model IDs for the selected Sarvam Voice Agents or model API product before pinning them in configuration.

### 6.3 Provider adapter interface

Keep the platform's interface independent of Sarvam's provider-specific request and response shapes.

```python
from typing import Protocol, Any

class VoiceProvider(Protocol):
    async def initiate_call(self, request: Any) -> Any:
        """Submit an authorized outbound call or campaign item."""

    async def get_call_status(self, provider_call_id: str) -> Any:
        """Retrieve or reconcile the provider's call state."""

    async def normalize_event(self, provider_event: dict) -> dict:
        """Convert a provider event into the marketplace event model."""
```

This is a conceptual interface, not a claim about Sarvam's exact API. Production implementations should define typed request, response, and event models based on the confirmed Sarvam integration method.

### 6.4 Sarvam adapter responsibilities

- Map the marketplace's canonical voice configuration to the selected Sarvam product/API.
- Keep Sarvam API keys and telephony credentials in a secrets manager.
- Store provider call and campaign references when returned.
- Authenticate callbacks or webhooks using the mechanisms supported by the chosen integration.
- Deduplicate repeated events and handle out-of-order status changes.
- Normalize provider-specific call statuses and conversation outcomes.
- Store transcript references only when transcripts are available and workspace policy permits their retention.
- Reconcile uncertain submission results before retrying.
- Respect language, voice, calling window, consent, suppression, and campaign-budget rules.
- Ensure provider-specific fields do not leak into the public `OutreachInput` or `OutreachResult` contracts.

### 6.5 Voice configuration

The following is an illustrative marketplace-level configuration. It is **not** a direct Sarvam API payload.

```json
{
  "channel": "voice",
  "provider": "sarvam",
  "integration_mode": "managed_voice_agent",
  "voice_config": {
    "language": "hi-IN",
    "conversation_goal": "Qualify the lead and request a meeting",
    "opening_message": "Hello, may I speak with the person responsible for operations?",
    "max_duration_seconds": 300,
    "human_handoff_enabled": true,
    "recording_policy": "workspace_and_provider_policy"
  },
  "call_config": {
    "require_approval": true,
    "scheduled_at": null,
    "retry_policy_id": "voice_retry_default"
  }
}
```

For the model-level path, use a separate, versioned internal configuration that names the selected ASR, dialogue, and TTS models. Do not expose model-specific parameters as mandatory fields in the universal contract.

### 6.6 Configure the voice agent in Sarvam, then connect it to the marketplace

The agreed setup is a two-part integration:

1. **In Sarvam:** create and test a voice agent using Sarvam's supported dashboard/API flow. Configure its conversation instructions, supported language, call objective, fallback behavior, and any supported handoff or result extraction settings.
2. **In the marketplace:** configure the Universal Outreach Agent's `voice` channel to use the `sarvam` adapter. Store the Sarvam voice-agent identifier and a versioned configuration reference in a protected integration record.
3. **At runtime:** the workflow runtime validates authorization and approval, Trigger.dev dispatches a durable task, and the Sarvam adapter calls the documented Sarvam operation using that configured agent.
4. **After the call:** receive or retrieve the provider status/results through supported APIs or callbacks, normalize the event, persist it, and return the universal `OutreachResult`.
5. **Before production:** verify that the Sarvam account has programmatic outbound calling enabled, confirm the exact supported API operations and callbacks, and obtain confirmation of startup-credit and marketplace-use permissions.

The marketplace should store a provider configuration reference, not hard-code a voice-agent ID into the public input schema. A workspace may later configure multiple Sarvam voice agents for different campaigns or languages without changing the public contract.

Example internal provider configuration (illustrative only, not a Sarvam API request):

```json
{
  "provider": "sarvam",
  "integration_mode": "managed_voice_agent",
  "provider_agent_id": "configured-in-sarvam",
  "provider_config_version": "1.0.0"
}
```

Keep API keys and phone-number credentials in a secrets manager. The identifier above is a placeholder, not a real agent ID.

### 6.7 Provider independence

The marketplace contract should continue to say:

```text
channel = voice
provider = sarvam
```

The `provider` value selects an adapter. The workflow contract, recipient model, approval gates, normalized outcomes, and downstream agents must not depend on Sarvam-specific fields. A future voice provider can implement the same interface without forcing every upstream and downstream agent to change.

## 7. Universal Output Contract

The output schema must work for both normal and voice outreach.

```json
{
  "schema_version": "1.0.0",
  "request_id": "req_123",
  "status": "completed",
  "summary": {
    "total_recipients": 1,
    "processed": 1,
    "drafted": 0,
    "awaiting_approval": 0,
    "submitted": 1,
    "completed": 1,
    "skipped": 0,
    "failed": 0
  },
  "results": [
    {
      "recipient_id": "recipient_001",
      "status": "completed",
      "channel": "voice",
      "provider": "sarvam",
      "message": null,
      "call": {
        "call_id": "call_001",
        "status": "completed",
        "started_at": "2026-10-17T10:00:00Z",
        "ended_at": "2026-10-17T10:02:00Z",
        "duration_seconds": 120,
        "transcript_available": true,
        "transcript_ref": "transcript_001"
      },
      "outcome": {
        "category": "interested",
        "summary": "The recipient expressed interest in a meeting.",
        "next_action": "schedule_meeting",
        "confidence": 0.91
      },
      "approval": {
        "required": true,
        "status": "approved"
      },
      "delivery": {
        "status": "completed",
        "provider_reference": "provider_ref_001"
      },
      "errors": []
    }
  ],
  "errors": []
}
```

The values above are illustrative, not actual call results.

### Important output rules

- `message` represents a text-based communication and can be `null` for voice-only operations.
- `call` represents call-specific execution data and can be `null` for non-voice channels.
- `outcome` contains normalized results and can be `null` until sufficient evidence is available.
- `provider` identifies the adapter used.
- `recipient_id` must match the incoming recipient.
- `transcript_ref` should be a controlled storage reference, not a publicly accessible transcript URL.
- `summary` must be calculated by application code from the individual results.
- Never report a call as completed merely because a call request was accepted.
- Never claim a message was delivered without appropriate provider evidence.

For a text-based result, `message` is populated and `call` is `null`. For a voice result, `call` is populated and `message` is `null`, unless the workflow explicitly includes a follow-up message.

### Normalized result enums

Recipient execution status:

- `pending`
- `processing`
- `drafted`
- `awaiting_approval`
- `scheduled`
- `submitted`
- `completed`
- `skipped`
- `failed`
- `cancelled`

Voice call status:

- `queued`
- `initiated`
- `ringing`
- `answered`
- `in_progress`
- `completed`
- `no_answer`
- `busy`
- `failed`
- `cancelled`
- `unknown`

Conversation outcome:

- `interested`
- `not_interested`
- `meeting_requested`
- `callback_requested`
- `qualified`
- `unqualified`
- `voicemail`
- `no_response`
- `human_handoff`
- `unknown`

The provider adapter must map its native states into these normalized values. Do not assume every provider supports every state.

---

## 8. Structured Conversation Results

Voice outreach needs more than a call status. The system should capture the result of the conversation in a reusable structured object.

```json
{
  "outcome": "meeting_requested",
  "qualification": {
    "status": "qualified",
    "criteria_met": [
      "Relevant role",
      "Expressed interest"
    ],
    "missing_information": [
      "Budget"
    ]
  },
  "follow_up": {
    "required": true,
    "type": "schedule_meeting",
    "due_at": null
  },
  "human_handoff": {
    "requested": false,
    "reason": null
  },
  "evidence": [
    {
      "source": "conversation",
      "reference": "transcript_segment_003"
    }
  ]
}
```

These fields should be optional when unavailable. A conversation summary must distinguish what the recipient explicitly said from model inference.

The downstream workflow may use this output to trigger a Meeting Booking Agent, CRM Agent, Follow-up Agent, or Lead Scoring Agent.

---

## 9. Workflow Compatibility

The Outreach Agent must be discoverable through a versioned manifest.

```json
{
  "agent_id": "universal-outreach-agent",
  "version": "1.0.0",
  "name": "Universal Outreach Agent",
  "category": "communication",
  "input_schema": {
    "id": "outreach.input",
    "version": "1.0.0"
  },
  "output_schema": {
    "id": "outreach.output",
    "version": "1.0.0"
  },
  "capabilities": [
    "personalization",
    "message_generation",
    "message_submission",
    "voice_outreach",
    "call_outcome_extraction",
    "delivery_tracking"
  ],
  "supported_channels": [
    "email",
    "voice"
  ],
  "channel_providers": {
    "email": ["configured_messaging_provider"],
    "voice": ["sarvam"]
  },
  "execution": {
    "supports_batch": true,
    "supports_async": true,
    "supports_partial_success": true
  }
}
```

### Example workflow

```text
Lead Discovery Agent
        |
        v
Universal Outreach Agent
        |
        +---- channel=email ----> Email Provider
        |
        +---- channel=voice ----> Sarvam Voice Adapter
        |
        v
Normalized OutreachResult
        |
        +----> CRM Agent
        +----> Follow-up Agent
        +----> Meeting Booking Agent
        +----> Analytics Agent
```

The workflow builder should validate connections before execution, support explicit field mapping, and pin agent and schema versions. The Outreach Agent must not require knowledge of which specific upstream agent generated the recipients.

---

## 10. Durable Execution, Retries & Idempotency

### Normal outreach

- Persist drafts before sending.
- Assign an idempotency key to each logical submission.
- Reconcile ambiguous provider responses before retrying.
- Deduplicate provider delivery events.
- Track queued, accepted, delivered, bounced, and unknown states separately.

### Voice outreach

- Persist a call task before initiating the call.
- Associate the task with a stable idempotency key and provider call ID.
- Avoid resubmitting a call when the provider outcome is ambiguous.
- Deduplicate call status webhooks and transcript events.
- Reconcile call outcomes after worker restarts.
- Store a durable record of approval and dispatch decisions.

Exactly-once execution cannot generally be guaranteed across arbitrary external providers. The system should implement idempotent submission where supported, durable state, and reconciliation for uncertain outcomes.

### Retry policy

Retry transient failures using bounded exponential backoff and jitter. Do not automatically retry permanent authorization errors, suppression decisions, invalid input, or declined contact requests.

For voice calls, use a campaign-level retry policy with explicit maximum attempts, allowed calling windows, and minimum intervals. A retry must not bypass opt-outs or suppression decisions.

---

## 11. Security & Compliance

- Require explicit workspace authorization for outbound messages and calls.
- Enforce applicable consent, opt-out, suppression, and calling-time requirements.
- Validate phone numbers and email addresses before execution.
- Keep provider credentials in a secrets manager.
- Authenticate and verify provider webhook signatures where supported.
- Treat contact records, external websites, and transcripts as untrusted data.
- Prevent prompt injection from changing system instructions or authorization decisions.
- Restrict access to recordings and transcripts using workspace-level permissions.
- Apply data-retention and deletion policies.
- Audit approvals, policy decisions, call submissions, message submissions, and subsequent events.
- Respect provider terms and applicable communication regulations.

The AI-generated conversation plan must never itself authorize an outbound call.

---

## 12. Observability & Evaluation

Capture a trace for each request, with recipient-level spans:

```text
outreach.execute
  ├── input.validate
  ├── policy.evaluate
  ├── recipient.process
  │    ├── context.resolve
  │    ├── personalization.generate
  │    ├── content.validate
  │    ├── approval.evaluate
  │    └── channel.execute
  │         ├── message.submit
  │         └── OR voice.call
  │              ├── call.initiate
  │              ├── call.events
  │              └── outcome.extract
  ├── result.aggregate
  └── output.validate
```

Measure:

- Input and output contract failures.
- Message-generation latency and quality.
- Call initiation success and call completion rate.
- Provider failures and ambiguous outcomes.
- Cost per recipient and per completed conversation.
- Approval wait time.
- Duplicate submission rate.
- Voice outcome classification accuracy.
- Delivery, bounce, and call failure rates.
- Partial-success rate and recovery time.

Do not treat call duration, call completion, or model confidence alone as proof of business success.

---

## 13. Implementation Roadmap

### Phase 1 — Public contract

- Define `OutreachInput`, `OutreachResult`, shared envelopes, and error models.
- Publish JSON Schemas.
- Implement manifest registration and schema versioning.
- Add contract tests and workflow compatibility validation.

**Exit criterion:** Any compatible upstream agent can invoke the Outreach Agent using the published contract.

### Phase 2 — Normal outreach

- Implement context resolution and personalization.
- Add message validation.
- Integrate one email provider.
- Implement draft, approval, submission, and delivery tracking.
- Add idempotency and partial-success handling.

**Exit criterion:** A complete text-based campaign works end-to-end with validated output.

### Phase 3 — Voice outreach

- Confirm Sarvam Voice Agents account access, outbound calling/campaign support, telephony configuration, event callbacks, and pricing.
- Implement the provider-independent voice adapter interface.
- Map the canonical voice configuration to the confirmed Sarvam Voice Agents or model-level API contract.
- Add call initiation, status reconciliation, transcript handling where available, and structured outcome extraction.
- Add voice-specific authorization and retry policies.

**Exit criterion:** A controlled voice campaign returns normalized call results and safely recovers from provider failures.

### Phase 4 — Marketplace workflows

- Register one `universal-outreach-agent` with email and voice channel modes.
- Render typed input/output ports and channel configuration in the workflow builder.
- Allow the user to select the configured Sarvam voice agent through a protected integration setting, not a provider-specific public contract.
- Support conditional routing by channel and by normalized outcome.
- Connect results to downstream CRM, booking, follow-up, and analytics agents.
- Persist execution state and expose progress to the UI.
- Consider a separate marketplace listing for Voice Outreach only after validating demand; reuse the same internal adapter and contract.

**Exit criterion:** Users can connect agents visually without provider-specific workflow code.

### Phase 5 — Production hardening

- Add concurrency limits, workspace quotas, and cost budgets.
- Test duplicate requests, provider timeouts, webhook duplication, and worker restarts.
- Validate schema compatibility across agent versions.
- Run controlled quality evaluations for both text and voice.
- Audit permissions, data retention, and compliance behavior.

**Exit criterion:** Both channels meet agreed reliability, quality, security, and operational targets.

---

## 14. Final Technology Decisions

| Concern | Decision |
|---|---|
| Agent reasoning | Pydantic AI |
| Input/output models | Pydantic v2 |
| Marketplace contracts | Versioned JSON Schema |
| Agent orchestration | Platform-owned Python runtime |
| Durable execution | Existing marketplace task/workflow infrastructure |
| Text outreach | Provider-independent messaging adapters |
| Voice outreach | Provider-independent voice adapter with managed-platform and model-level modes |
| Initial voice provider | Sarvam Voice Agents managed platform, subject to account/API verification |
| Persistence | PostgreSQL |
| Event handling | Authenticated webhooks plus reconciliation jobs |
| Observability | OpenTelemetry with optional Langfuse |
| Workflow composition | Typed nodes and edges with explicit mapping |

**Final architectural principle:** The marketplace owns the universal contract and workflow runtime. The Outreach Agent owns personalization and channel selection. Channel adapters own provider-specific execution. Providers own their external communication infrastructure.

This separation supports normal and voice outreach now while allowing new channels, providers, and downstream agents to be added without redesigning the entire platform.


---

## 15. Trigger.dev Integration — Durable Execution Layer

### 15.1 Purpose and responsibility boundary

Trigger.dev is the durable task-execution layer for long-running and asynchronous work. It can execute jobs, retry transient failures, apply concurrency limits, schedule tasks, expose execution logs, and wait for external events or human decisions.

It does **not** replace the marketplace workflow engine.

| Responsibility | Owner |
|---|---|
| Agent discovery, manifests, versions, input/output schemas | Marketplace backend |
| Visual workflow graph, edges, field mapping, conditional routing | Marketplace workflow runtime |
| Authorization, workspace permissions, consent, approval policy | Marketplace policy layer |
| Durable task execution, retry scheduling, task-level concurrency | Trigger.dev |
| AI reasoning, personalization, structured extraction | Python agent service using Pydantic AI |
| Provider-specific email/call submission | Channel adapters |
| Provider event normalization and reconciliation | Marketplace event processor |
| Final workflow state and downstream handoff | Marketplace workflow runtime |

**Recommended execution path:**

```text
User / API
    |
    v
Marketplace API
    |
    v
Workflow Runtime
  - validate graph and contracts
  - resolve field mappings
  - enforce permissions
  - create workflow run and node runs
    |
    v
Trigger.dev task
  - durable execution
  - retries and concurrency
  - scheduled work / waits
    |
    +----> Python Agent API (Pydantic AI)
    |          |
    |          +----> Email adapter
    |          +----> Sarvam voice adapter
    |
    +----> Provider webhooks / event processor
    |
    v
Persist normalized node result
    |
    v
Workflow Runtime evaluates downstream edges
```

The marketplace database remains the source of truth for workflow state. Trigger.dev's run state is operational execution state and should be correlated with the marketplace's own records.

### 15.2 TypeScript and Python boundary

Trigger.dev's primary SDK is TypeScript-first, while the Outreach Agent is implemented in Python with Pydantic v2 and Pydantic AI. Keep that separation explicit instead of forcing all agent logic into TypeScript.

Recommended arrangement:

- **TypeScript Trigger.dev worker:** owns task registration, durable waits, scheduling, retry configuration, and calls to internal services.
- **Python Agent API:** validates `OutreachInput`, performs personalization and structured extraction, enforces domain-level invariants, and returns `OutreachResult`.
- **Marketplace API/database:** owns workflow graph state, permissions, approvals, event history, and result persistence.
- **Provider adapters:** isolate email and voice provider-specific APIs.

The Trigger.dev task should call an authenticated internal Python API. The Python service should not need to know about the marketplace's visual graph representation or Trigger.dev's internal task payload.

### 15.3 Suggested task catalogue

Use a small set of durable task types rather than creating one task type for every possible agent.

| Task ID (illustrative) | Purpose |
|---|---|
| `workflow.execute-node` | Execute one ready workflow node using its published contract |
| `outreach.prepare-batch` | Validate and prepare a batch of recipients |
| `outreach.process-recipient` | Process one recipient or a small bounded batch |
| `outreach.submit-message` | Submit an approved message through a channel adapter |
| `outreach.initiate-call` | Submit an approved call request through the voice adapter |
| `outreach.reconcile-provider-state` | Reconcile ambiguous message/call status |
| `outreach.process-provider-event` | Deduplicate and normalize a provider webhook event |
| `outreach.extract-call-outcome` | Produce a structured outcome from permitted call evidence |
| `workflow.resume-after-approval` | Resume a paused workflow after a valid approval decision |
| `workflow.resume-after-event` | Resume a workflow after a correlated provider or business event |

These are logical task names, not a requirement to use these exact Trigger.dev identifiers.

### 15.4 Task payload contract

Pass identifiers and bounded, validated payloads rather than unrestricted database records or secrets.

```json
{
  "contract_version": "1.0.0",
  "workflow_run_id": "wf_run_123",
  "node_run_id": "node_run_456",
  "workspace_id": "workspace_789",
  "agent_id": "universal-outreach-agent",
  "agent_version": "1.0.0",
  "input_schema_version": "1.0.0",
  "input_ref": "outreach-input-123",
  "idempotency_key": "wf_run_123:node_run_456",
  "trace_id": "trace_abc"
}
```

The example is illustrative. `input_ref` should resolve through an authenticated service and workspace authorization; it must not be a public URL. If a payload is passed directly, validate it against the published schema and enforce size limits.

Never put provider credentials, access tokens, private transcripts, or unrestricted personal data in task metadata or logs.

### 15.5 Durable task lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> Queued
    Queued --> Running
    Running --> WaitingForApproval
    WaitingForApproval --> Queued: Approved
    WaitingForApproval --> Cancelled: Rejected or expired
    Running --> WaitingForProviderEvent
    WaitingForProviderEvent --> Queued: Relevant event received
    Running --> Succeeded
    Running --> RetryScheduled: Retryable failure
    RetryScheduled --> Queued
    Running --> Failed: Permanent or exhausted failure
    Running --> Cancelled: Authorized cancellation
    Succeeded --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

The marketplace should persist its own node-run state transitions. Trigger.dev runs should be correlated using a stored task/run identifier, and transitions should be applied idempotently.

### 15.6 Retry policy and side-effect safety

Trigger-level retries are useful, but a retry must not blindly repeat an external side effect.

Use this sequence for a message or call:

1. Persist a dispatch-intent record with a stable idempotency key.
2. Check current authorization, approval, suppression, and cancellation state.
3. Submit to the provider using provider-supported idempotency where available.
4. Persist the provider request/call/message identifier as soon as known.
5. If the response is ambiguous, mark the dispatch `unknown` and reconcile provider state.
6. Retry submission only when evidence shows the action was not accepted, or when the provider offers a safe idempotent retry mechanism.
7. Deduplicate subsequent provider events by provider event ID or a stable event fingerprint.

Do not automatically retry invalid input, authorization failures, consent/suppression rejections, or explicit recipient opt-outs. Apply bounded exponential backoff with jitter to transient failures.

**Important:** durable task execution does not provide universal exactly-once delivery across external providers. Use idempotency, durable records, and reconciliation to reduce duplicates and recover from uncertain outcomes.

### 15.7 Approval waits and provider callbacks

For a message or call requiring approval:

- Save the draft/call plan and set the marketplace node to `awaiting_approval`.
- Pause the durable task using a supported Trigger.dev wait/callback mechanism, or complete the preparation task and resume with a separate task after approval.
- Store the approval request, approver identity, decision, expiry, and audit event in the marketplace database.
- On approval, re-check current permissions, consent, suppression lists, and cancellation status before dispatch.
- On rejection or expiry, terminate or mark the node according to the marketplace's state machine.

For provider callbacks:

- Receive the webhook at the marketplace's authenticated webhook endpoint.
- Verify the provider signature or other supported authentication mechanism.
- Persist the raw event reference and deduplication key.
- Normalize the event and update the relevant message/call record.
- Trigger a durable follow-up task or resume signal using the stored correlation IDs.
- Return the provider's expected acknowledgement promptly; do longer processing asynchronously where appropriate.

Do not keep a worker running while waiting for a call that may take minutes. Use durable waits, callback/resume mechanisms, or separate event-driven tasks supported by the chosen Trigger.dev version.

---

## 16. Reference Integration Flow

### 16.1 Starting a workflow node

1. The marketplace receives a workflow start request.
2. It validates the graph, node versions, schemas, field mappings, workspace limits, and permissions.
3. It creates a `workflow_run` and `node_run` record in PostgreSQL.
4. It stores the validated node input or a protected reference to it.
5. It dispatches the corresponding Trigger.dev task with correlation IDs and an idempotency key.
6. The task loads the input through an authenticated internal API and invokes the Python Agent API.
7. The Python service returns a contract-conforming result.
8. The marketplace validates and persists the output, updates the node state, and evaluates downstream edges.
9. The next eligible nodes are dispatched only after dependency and routing rules pass.

### 16.2 Example internal API boundary

Illustrative endpoint design; these routes are owned by the application and are not Trigger.dev or Sarvam endpoints.

```text
POST /internal/agents/universal-outreach-agent/execute
GET  /internal/workflow-runs/{workflow_run_id}/nodes/{node_run_id}
POST /internal/provider-events/{provider}/ingest
POST /internal/approvals/{approval_id}/decision
```

Protect internal routes with service authentication, authorization, request validation, timeouts, and audit logging. Prefer a service identity or short-lived signed token over a shared hard-coded secret.

### 16.3 Illustrative Trigger.dev task

The following is a **shape example**, not drop-in code. Adapt imports, task options, retry syntax, and wait APIs to the installed Trigger.dev SDK version.

```typescript
// TypeScript worker — illustrative pseudocode
import { task } from "@trigger.dev/sdk";

type ExecuteNodePayload = {
  workflowRunId: string;
  nodeRunId: string;
  workspaceId: string;
  agentId: string;
  agentVersion: string;
  idempotencyKey: string;
};

export const executeWorkflowNode = task({
  id: "workflow-execute-node",
  // Configure bounded retries and concurrency using the SDK version in use.
  run: async (payload: ExecuteNodePayload) => {
    // 1. Ask the marketplace API to claim/check the node run.
    // 2. Fetch validated input through an authenticated internal API.
    // 3. Invoke the Python agent service.
    // 4. Validate/persist the result through the marketplace API.
    // 5. Let the workflow runtime decide which node runs next.
    return {
      workflowRunId: payload.workflowRunId,
      nodeRunId: payload.nodeRunId,
      status: "delegated_to_marketplace_runtime"
    };
  }
});
```

Do not make the task itself the source of truth for workflow graph semantics. It should execute the requested unit of work and report its result to the marketplace runtime.

### 16.4 Illustrative Python agent endpoint

```python
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

app = FastAPI()

@app.post("/internal/agents/universal-outreach-agent/execute")
async def execute_outreach(payload: dict):
    try:
        request = OutreachInput.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors())

    # Authenticate the calling service before this handler in production.
    # Enforce authorization and policy checks before any external action.
    result = await outreach_service.execute(request)

    # Validate the final public result contract.
    validated = OutreachResult.model_validate(result)
    return validated.model_dump(mode="json")
```

This snippet assumes that `OutreachInput`, `OutreachResult`, and `outreach_service` are implemented elsewhere. Production code must add service authentication, workspace authorization, request-size limits, timeouts, redacted error handling, and audit events.

---

## 17. Persistence Model and Correlation IDs

Use PostgreSQL as the business source of truth. Suggested logical entities:

| Entity | Key fields |
|---|---|
| `workflow_runs` | `id`, `workspace_id`, `workflow_version`, `status`, `created_at`, `finished_at` |
| `node_runs` | `id`, `workflow_run_id`, `node_id`, `agent_id`, `agent_version`, `status`, `input_ref`, `output_ref` |
| `task_dispatches` | `id`, `node_run_id`, `trigger_run_id`, `idempotency_key`, `dispatch_status` |
| `outreach_recipients` | `id`, `node_run_id`, `recipient_id`, `channel`, `status` |
| `outreach_actions` | `id`, `recipient_id`, `action_type`, `idempotency_key`, `provider`, `provider_reference`, `status` |
| `approvals` | `id`, `node_run_id`, `requested_by`, `decision`, `decided_by`, `expires_at` |
| `provider_events` | `id`, `provider`, `provider_event_id`, `event_type`, `received_at`, `processed_at` |
| `audit_events` | `id`, `workspace_id`, `actor`, `action`, `resource_ref`, `created_at` |

Use foreign keys and unique constraints for stable IDs and deduplication. For example, enforce uniqueness on provider plus provider event ID when the provider supplies a stable event ID, and on the logical dispatch idempotency key within its intended scope.

Store large transcripts and sensitive payloads in access-controlled storage; keep references and metadata in PostgreSQL. Apply workspace isolation, retention rules, and deletion workflows.

---

## 18. Concurrency, Queues, and Cost Controls

Configure limits at multiple levels:

- **Workspace:** maximum concurrent workflow runs and maximum outbound actions.
- **Workflow:** maximum active nodes and bounded fan-out.
- **Agent:** maximum concurrent executions for the same agent version.
- **Provider:** provider-specific rate limits and concurrency ceilings.
- **Recipient:** maximum actions and retry attempts within a defined period.
- **AI calls:** model-specific timeout, token budget, and maximum generation attempts.

For a batch of recipients, do not launch an unbounded task for every record. Use bounded fan-out or chunking and respect provider quotas. Keep separate concurrency pools for AI generation and external dispatch so a slow provider does not consume all generation capacity.

Before an outbound action, check the current campaign budget and workspace quota. Record estimated and actual model/provider costs where available. Stop or pause execution when configured budgets are exceeded.

---

## 19. Failure Handling and Recovery Matrix

| Failure | Required behavior |
|---|---|
| Invalid input schema | Reject before dispatch; return structured validation errors |
| Missing required mapping from upstream agent | Mark node blocked or invalid; do not invent values |
| Approval rejected or expired | Do not dispatch; record terminal or policy-defined state |
| Python Agent API timeout before any side effect | Retry within bounded policy if safe |
| Provider submission timeout with unknown result | Mark `unknown`; reconcile before retrying |
| Duplicate Trigger.dev task delivery | Claim node/action using database state and idempotency keys |
| Duplicate webhook | Deduplicate and acknowledge safely |
| Out-of-order provider events | Apply valid state transitions and retain event history |
| Worker restart | Reconstruct execution from persisted state and correlation IDs |
| Provider outage | Pause or retry according to provider policy and campaign limits |
| Workspace cancellation | Prevent new actions and cancel pending work where possible |
| Schema/version mismatch | Fail closed with a compatibility error; do not silently coerce unsafe fields |

All terminal and recoverable errors should follow a stable error contract, including a machine-readable code, safe message, retryability, and correlation IDs. Do not expose credentials, stack traces, or sensitive recipient data in public errors.

---

## 20. Security and Operational Configuration

- Keep Trigger.dev credentials and provider credentials in a secrets manager or supported secret configuration.
- Separate development, staging, and production projects/environments.
- Use service-to-service authentication between Trigger.dev workers, the marketplace API, and Python services.
- Verify webhook authenticity and protect against replay where the provider supports it.
- Redact email addresses, phone numbers, tokens, transcripts, and message bodies from ordinary logs.
- Apply least-privilege access to logs, execution traces, recordings, and stored results.
- Set task timeouts, bounded retries, concurrency limits, and explicit failure handling.
- Pin SDK versions and test behavior before upgrading Trigger.dev.
- Track task failures, queue wait time, retries, execution duration, provider latency, and cost.
- Ensure deployments do not invalidate in-flight workflow records or incompatible task payloads.
- Keep user cancellation and emergency campaign-stop controls available during execution.

Before production use, verify the current Trigger.dev documentation for the selected SDK version, including task configuration, retry behavior, concurrency controls, durable waits, and deployment requirements.

---

## 21. Testing and Acceptance Criteria

### Contract tests
- Valid `OutreachInput` passes validation.
- Invalid or unsupported channel/mode combinations are rejected.
- Output always conforms to the published schema.
- Version compatibility is checked before node execution.
- Unknown fields follow an explicit strictness policy.

### Workflow tests
- Lead Discovery output maps correctly into Outreach input.
- Downstream agents receive the normalized result, not provider-native objects.
- Conditional routing behaves correctly for `interested`, `not_interested`, `meeting_requested`, and failure states.
- Partial recipient success is preserved without losing successful results.
- Workflow cancellation prevents new external actions.

### Reliability tests
- Duplicate task delivery does not create duplicate messages or calls.
- Ambiguous provider responses are reconciled before another submission.
- Duplicate and out-of-order webhooks are handled safely.
- Worker restart and service timeout recovery preserve state.
- Retry exhaustion produces a structured terminal failure.

### Policy tests
- Approval-required actions cannot run before approval.
- Rejected, expired, or revoked approvals cannot authorize dispatch.
- Suppressed or opted-out contacts are skipped.
- Calling windows, consent rules, workspace limits, and campaign budgets are enforced.
- A model-generated plan cannot override policy-engine decisions.

### Production acceptance criteria
1. Every run can be traced using `workflow_run_id`, `node_run_id`, and provider references.
2. Every external action has a persisted authorization decision and idempotency key.
3. No successful delivery or call completion is claimed without provider evidence.
4. Partial failures are represented explicitly.
5. Provider-specific payloads do not leak into public marketplace contracts.
6. Workflow execution can recover from restarts and transient infrastructure failures.
7. All outbound actions can be audited and cancelled where technically possible.

---

## 22. Updated Technology Decisions

| Concern | Decision |
|---|---|
| Agent reasoning and structured tools | Pydantic AI |
| Agent input/output models | Pydantic v2 |
| Marketplace inter-agent contracts | Versioned JSON Schema |
| Marketplace API and workflow graph | Platform-owned backend/runtime |
| Durable asynchronous execution | Trigger.dev |
| Trigger.dev task SDK | TypeScript SDK, pinned to a tested version |
| Agent execution service | Python API |
| Normal outreach | Provider-independent messaging adapters |
| Voice outreach | Provider-independent voice adapter with managed-platform and model-level modes |
| Initial voice provider | Sarvam Voice Agents managed platform, subject to account/API/telephony verification |
| Persistence and workflow source of truth | PostgreSQL |
| Large/sensitive artifacts | Access-controlled object storage |
| Provider events | Authenticated webhooks plus durable processing and reconciliation |
| Observability | OpenTelemetry, plus optional LLM-specific tracing |
| Workflow composition | Typed nodes, edges, schema validation, explicit field mapping |
| Visual workflow canvas | React Flow (`@xyflow/react`) with controlled node/edge state |
| Dynamic configuration UI | JSON Schema + marketplace-owned UI metadata rendered as schema-driven forms |
| Agent configuration/versioning | Versioned agent manifest, config snapshots, validation and publish workflow |
| Live execution UI | Marketplace run state + Trigger.dev run references + normalized provider events |

### Final recommendation

Build **one Universal Outreach Agent** with normal and voice modes. Configure the voice agent in Sarvam, then connect it to the marketplace through a Sarvam adapter and a protected provider configuration. Use Trigger.dev as the durable execution engine behind the marketplace, not as the marketplace itself. Keep the visual workflow runtime, agent registry, universal contracts, permissions, and downstream routing under your platform's control. Use TypeScript for Trigger.dev task definitions and Python/Pydantic AI for the Outreach Agent's domain logic, connected through authenticated internal APIs.

Do not build a separate voice-agent implementation at first. If users later need a separately discoverable Voice Outreach Agent, expose a thin marketplace entry that reuses the same Sarvam adapter, policy gates, execution tasks, and normalized contracts.


---

## 23. Agreed Build Plan and Implementation Order

This section records the implementation decision so the team does not accidentally build duplicate outreach systems.

### Build now

1. **One public agent:** `universal-outreach-agent`.
2. **Two channel modes:** `email` and `voice`.
3. **Normal outreach:** connect one approved email provider and implement draft, approval, sending, and delivery reconciliation.
4. **Voice setup:** create and test the voice agent in Sarvam's platform, then connect it through the marketplace's Sarvam adapter.
5. **One universal contract:** keep `OutreachInput` and `OutreachResult` stable across both channels.
6. **Durable execution:** use Trigger.dev tasks to invoke the agent service, dispatch approved actions, and process asynchronous continuations.
7. **Marketplace orchestration:** the marketplace owns graph execution, typed mapping, approvals, authorization, persistence, and downstream routing.
8. **Production safeguards:** implement idempotency, bounded retries, consent/suppression checks, audit events, and reconciliation before enabling live campaigns.

### Do not build yet

- Do not build a separate voice outreach codebase.
- Do not expose Sarvam-specific request/response payloads in the marketplace's public agent contract.
- Do not assume startup credits include telephony or permit marketplace resale/hosted access without written confirmation.
- Do not implement model-level ASR–LLM–TTS orchestration unless the managed Sarvam Voice Agents path cannot meet the required use case.

### Add later, only if justified

A separately discoverable `voice-outreach-agent` can be added as a thin marketplace wrapper for simpler discovery or dedicated settings. It should reuse the same Sarvam adapter, policy engine, durable task patterns, persistence, and normalized result schema. It must not become a second independent implementation.

### Go-live gate

Do not enable real outbound calls until all of the following are confirmed:
- Sarvam account supports programmatic outbound calls and the required telephony setup.
- The exact Sarvam API and event/callback contract is verified.
- Startup credits and commercial terms cover the intended usage and marketplace model.
- Consent, opt-out, calling-time, workspace authorization, approval, and emergency-stop controls have been tested.


---

## 24. Product UX Principle: Users Configure Outcomes, Not Provider Internals

The marketplace UI should let a user describe what they need and configure an agent without learning Pydantic, JSON Schema, Trigger.dev, or Sarvam's API payloads. The interface translates user choices into a validated, versioned agent configuration.

The UI must be **schema-driven, not hard-coded per agent**. Each marketplace agent publishes a manifest with its capabilities, input/output contracts, configurable fields, UI hints, and version. The frontend renders the appropriate controls from that manifest.

### 24.1 Two levels of customization

**Guided mode (default)**
- User selects the outcome: e.g. “contact these leads and ask for a meeting.”
- User chooses a channel: Email or Voice.
- UI reveals only the fields relevant to that channel.
- Sensible defaults and presets are provided for tone, language, approval, and scheduling.
- The user tests the configuration before publishing/running.

**Advanced mode**
- Exposes detailed instructions, field mappings, retry rules, concurrency, output extraction, and supported provider settings.
- Provider-specific options appear only when the selected integration supports them.
- Advanced settings are validated server-side and cannot bypass policy gates or authorization.

The UI should not let free-form instructions override platform policies, consent requirements, opt-outs, workspace permissions, or campaign limits.

### 24.2 Recommended visual layout

Use a three-region workflow builder:

```text
┌─────────────────────┬────────────────────────────────┬─────────────────────┐
│ Agent / Tool Library│ Workflow Canvas                │ Configuration Panel │
│                     │                                │                     │
│ Lead Discovery      │ [Lead Discovery] ──> [Outreach]│ Selected: Outreach  │
│ Universal Outreach  │                       │        │ Channel: Voice      │
│ CRM Update          │                       v        │ Language: Hindi     │
│ Meeting Booking     │                 [CRM Update]   │ Goal: Book meeting  │
│ Conditions          │                                │ Approval: Required  │
└─────────────────────┴────────────────────────────────┴─────────────────────┘
```

- **Left library:** searchable, categorized, permission-filtered agent catalog with capability labels and input/output summaries.
- **Center canvas:** drag-and-drop nodes, connectable typed ports, conditional branches, grouping, zoom/pan, undo/redo, and minimap as needed.
- **Right inspector:** context-sensitive configuration for the selected node or edge. It displays fields generated from the agent manifest and its selected configuration.
- **Bottom or side run panel:** validation issues, execution status, logs, per-node results, and test output.
- **Top action bar:** workflow name, draft/published version, Save, Validate, Test, Publish, Run, and Run History. Enable each action only when its prerequisites pass.

React Flow supports custom nodes and multiple connection handles; the application must control and persist node/edge state, validate connections, and update dynamic handles when a node's ports change. React Flow is a canvas library, not the backend workflow engine. The marketplace must implement persistence, validation, execution, and authorization itself.

### 24.3 Agent cards and node presentation

Every agent card should show:
- Agent name, purpose, publisher, and version.
- Capabilities and supported execution modes.
- Required inputs and available outputs.
- Whether it can perform external side effects.
- Required permissions/approvals.
- Availability/connection status for required providers.
- Expected cost information only when a reliable estimate is available.
- A “Configure” and “Test” action where appropriate.

A workflow node should display its current channel/mode and configuration status, for example:
- `Universal Outreach · Email`
- `Universal Outreach · Voice · Sarvam`
- `Needs configuration`
- `Invalid mapping`
- `Provider not connected`
- `Ready to test`

Do not display “Ready” merely because a node has been placed on the canvas. It is ready only after its required fields, input mappings, provider connection, permissions, and schema compatibility checks pass.

---

## 25. Dynamic Configuration System

### 25.1 Manifest-driven forms

Each agent publishes a versioned manifest. The manifest's JSON Schema defines the valid data shape; additional UI metadata controls presentation. Keep business validation in backend code and schema validation, not in frontend-only conditions.

Illustrative manifest fragment:

```json
{
  "agent_id": "universal-outreach-agent",
  "version": "1.0.0",
  "config_schema_version": "1.0.0",
  "config_schema": {
    "type": "object",
    "required": ["channel", "objective"],
    "properties": {
      "channel": {
        "type": "string",
        "enum": ["email", "voice"],
        "default": "email",
        "title": "Outreach channel"
      },
      "objective": {
        "type": "string",
        "title": "What should this outreach achieve?"
      },
      "require_approval": {
        "type": "boolean",
        "default": true,
        "title": "Require approval before external action"
      }
    }
  },
  "ui_schema": {
    "channel": {
      "widget": "segmented_control",
      "help": "Choose how recipients will be contacted."
    },
    "objective": {
      "widget": "textarea",
      "placeholder": "Qualify the lead and request a meeting"
    },
    "require_approval": {
      "widget": "switch",
      "safety_critical": true
    }
  }
}
```

This is an internal marketplace example, not a provider API schema. The frontend may use the UI metadata for layout, labels, help text, conditional visibility, and widgets. The backend must validate all submitted values against the selected schema version and policy rules.

### 25.2 Conditional fields based on channel

When a user selects `email`, show email-related options:
- Sender identity and connected email provider.
- Subject generation and message body constraints.
- Tone, language, personalization level.
- Draft/approval/schedule/send mode.
- Delivery tracking and follow-up rules supported by the provider.

When a user selects `voice`, show voice-related options:
- Connected Sarvam workspace/provider status.
- Selected Sarvam agent reference and saved version.
- Language and conversation objective supported by that agent.
- Call schedule, campaign size, concurrency/rate limits, retry policy.
- Required approval, calling windows, consent/opt-out controls.
- Structured outcome fields and post-call actions.

er-selected values when switching modes where safe, but never silently send a voice-only configuration to email or vice versa. Validate the selected mode on the server and preserve separate channel-specific configuration objects.

### 25.3 Custom fields and dynamic workflow ports

Allow users to add supported custom output fields such as `lead_status`, `meeting_requested`, `preferred_callback_time`, or `qualification_score`. Each field must have a type, description, required/optional flag, and extraction/validation rule. Custom fields must be included in a versioned output schema. They must not create arbitrary executable code.

The workflow node's visible input/output handles are derived from the selected agent manifest and configuration. If the user changes output fields, the editor must detect connected edges that reference removed or incompatible fields. Never silently delete or reinterpret those edges: mark them invalid and require the user to repair or confirm the change.

---

## 26. Initial Agent Catalog: Five or Six Code-Defined Templates

The marketplace should launch with a small curated catalog. Templates are defined in code and registered through manifests, but users customize an instance through the marketplace UI. Do not create a separate bespoke frontend for every template.

| Template | Purpose | Customizable settings | Typical outputs | External side effect |
|---|---|---|---|---|
| `universal-outreach-agent` | Contact recipients by email or voice | Channel, objective, language, tone, instructions, schedule, approval, recipient mappings, output fields | Per-recipient status, response summary, structured outcome | Yes; sending/calling requires policy checks |
| `lead-qualification-agent` | Ask questions and classify leads | Qualification questions, scoring rubric, required fields, thresholds | Score, qualification status, missing information | Usually no; may trigger downstream actions |
| `follow-up-agent` | Decide and prepare follow-ups from prior results | Follow-up timing, conditions, max attempts, templates, stop conditions | Next action, due time, reason | Yes if it sends or calls |
| `meeting-booking-agent` | Request or arrange meetings through a connected calendar/booking integration | Meeting type, duration, availability policy, timezone, confirmation behavior | Proposed slots, booking reference, status | Yes; booking requires authorization |
| `crm-update-agent` | Normalize and update CRM records | Field mappings, deduplication rules, update/append policy | Record ID, changed fields, result | Yes; requires CRM permissions |
| `lead-research-agent` | Summarize provided lead/company context | Approved data sources, research questions, output schema, evidence requirements | Summary, evidence URLs, confidence/unknowns | Usually read-only |

These are a recommended starter catalog, not six separate runtime engines. Build shared runtime primitives and separate each template through a manifest, schema, implementation module, and adapter dependencies. If the team can only deliver one fully production-ready template initially, ship Universal Outreach first and label the remaining entries as unavailable, preview, or coming soon rather than pretending they work.

### Template implementation contract

Every registered template must define:

- Stable `agent_id` and semantic version.
- Human-readable name, description, category, icon key, and capabilities.
- `input_schema`, `config_schema`, and `output_schema` with versions.
- UI metadata: groups, labels, help text, widgets, defaults, visibility conditions, and advanced/basic grouping.
- Required integrations and permission scopes.
- Whether it has side effects and what approval is required.
- Runtime entry point, timeout budget, retry policy, and idempotency strategy.
- Test fixtures and a health/readiness check.

A manifest is descriptive metadata, not a security boundary. The backend must use an allowlisted `agent_id` to select a known implementation. Never import or execute a Python module path supplied by a user.

---

## 27. Complete Feature Scope

### 27.1 Marketplace and agent catalog

- Search and filter agents by category, capability, channel, and availability.
- Agent detail page with purpose, examples, inputs, outputs, permissions, integrations, version, and status.
- Create a configured instance from a template; save multiple instances with separate configurations.
- Basic mode for common settings and advanced mode for supported controls.
- Version history, draft/published state, configuration validation, and rollback to a prior saved version.
- Clear status for unavailable integrations, missing permissions, unsupported options, and deprecated versions.

### 27.2 Dynamic configuration UI

- Render forms from versioned JSON Schema plus marketplace-owned UI metadata.
- Conditional fields, repeatable fields, enums, defaults, validation messages, tooltips, and advanced settings.
- Email/voice conditional configuration for Universal Outreach.
- Custom structured output fields with type validation.
- Safe preservation of compatible values when a user changes modes.
- Dirty-state detection, save draft, discard changes, and version comparison.
- Server-side validation on save, test, publish, and run; frontend validation is only a convenience.

### 27.3 Visual workflow builder

- Searchable agent/tool library, drag-and-drop nodes, typed input/output ports, edges, zoom/pan, minimap, selection, delete, duplicate, undo/redo, and autosave.
- Conditional branches using explicit normalized output values, not arbitrary code snippets.
- Field mapping UI from upstream output paths to downstream input paths, with type compatibility checks and sample previews.
- Required-input indicators, missing mapping warnings, invalid-edge diagnostics, and cycle validation.
- Save draft, validate, dry-run/test, publish immutable version, run, cancel when safe, and inspect run history.
- Dynamic handles derived from the selected agent's manifest and configured output schema.
- Workflow graph stored as versioned JSON in PostgreSQL; never use the browser canvas state as the only source of truth.

### 27.4 Universal Outreach — email mode

- Select connected sender/provider; validate connection and sender identity.
- Import or submit recipients with schema validation and deduplication.
- Map canonical recipient fields such as name, email, company, locale, and custom attributes.
- Set goal, language, tone, message constraints, and approved personalization context.
- Preview generated messages and optionally edit them before approval.
- Dry run, test recipient, approval queue, scheduled sending, bounded batch size, provider rate limits, idempotent dispatch, and per-recipient result tracking.
- Distinguish `drafted`, `awaiting_approval`, `queued`, `submitted`, `delivered` (only with provider evidence), `bounced`, `failed`, and `unknown`.
- Follow-up policy with explicit stop conditions, opt-out/suppression checks, and maximum attempts.

### 27.5 Universal Outreach — voice mode

- Select a connected voice configuration/provider agent reference managed through the marketplace's integration layer.
- Configure objective, language, allowed instructions, supported voice settings, campaign limits, call windows, and result fields.
- Preview recipient-to-provider variable mapping and validate all required variables before launch.
- Test using a supported sandbox/test route before live calls.
- Enforce consent/eligibility, suppression, calling window, approval, per-campaign limits, concurrency, and emergency stop.
- Track call request, provider call/campaign ID, provider status events, transcript/summary where available, structured outcome, and reconciliation state.
- Handle duplicate/out-of-order callbacks, timeouts, partial provider responses, and ambiguous call initiation safely.
- Do not assume every Sarvam capability or API is available to the account; maintain a provider capability check and verify actual API/event schemas before enabling each control.

### 27.6 Shared platform features

- Authentication and tenant/workspace isolation using the platform's established identity system.
- Role-based permissions for owner, editor, approver, operator, and viewer where needed.
- Integration connection management with secrets stored server-side.
- Audit events for configuration changes, approvals, launches, provider actions, opt-outs, and administrative overrides.
- Per-tenant quotas, rate limits, concurrency limits, cost budgets, and kill switch.
- Structured logs, correlation IDs, traces, run status, provider reconciliation, and operational alerts.
- Exportable run results with sensitive data redacted according to access policy.
- Retention/deletion policy for recipient data, prompts, transcripts, and logs.

### 27.7 Explicit non-goals for the first release

- Arbitrary user-supplied Python/JavaScript execution inside agents.
- Fully general-purpose autonomous agents with unrestricted network or tool access.
- A custom ASR–LLM–TTS voice stack while managed Sarvam Voice Agents meets requirements.
- A separate implementation for every catalog template.
- Live campaigns before provider API, telephony, compliance, and commercial requirements are verified.

---

## 28. Recommended Repository and Folder Structure

Use a monorepo so the React marketplace, Trigger.dev tasks, Python agent API, shared contracts, and infrastructure definitions evolve together. This is a recommended structure; adapt naming to an existing repository rather than rewriting working code solely to match it.

```text
ai-agent-marketplace/
├── apps/
│   ├── web/                              # React + Vite + TypeScript UI
│   │   ├── public/
│   │   └── src/
│   │       ├── app/                      # route composition and app shell
│   │       ├── routes/                   # catalog, agent detail, builder, runs
│   │       ├── components/
│   │       │   ├── ui/                   # shared primitives
│   │       │   ├── catalog/              # cards, filters, detail panels
│   │       │   ├── config-form/          # schema-driven form renderer
│   │       │   ├── workflow/             # React Flow canvas, nodes, edges
│   │       │   ├── mapping/              # field mapping editor
│   │       │   └── run-inspector/        # status, logs, node outputs
│   │       ├── features/
│   │       │   ├── agents/
│   │       │   ├── integrations/
│   │       │   ├── workflows/
│   │       │   └── runs/
│   │       ├── hooks/
│   │       ├── lib/                      # API client, auth, utilities
│   │       ├── schemas/                  # frontend-safe schema helpers
│   │       ├── state/                    # local/editor state only
│   │       ├── types/
│   │       └── main.tsx
│   └── trigger/                          # Trigger.dev TypeScript tasks
│       ├── src/
│       │   ├── tasks/
│       │   │   ├── execute-workflow.ts
│       │   │   ├── execute-outreach-batch.ts
│       │   │   ├── dispatch-email.ts
│       │   │   ├── initiate-voice-campaign.ts
│       │   │   ├── process-provider-event.ts
│       │   │   └── reconcile-provider-status.ts
│       │   ├── clients/                  # authenticated Python API client
│       │   └── trigger.config.ts
│       └── package.json
├── services/
│   └── agent-api/                        # Python FastAPI service
│       ├── pyproject.toml
│       ├── alembic.ini
│       ├── alembic/
│       ├── app/
│       │   ├── main.py
│       │   ├── api/
│       │   │   ├── routes/
│       │   │   │   ├── agents.py
│       │   │   │   ├── configs.py
│       │   │   │   ├── workflows.py
│       │   │   │   ├── runs.py
│       │   │   │   ├── approvals.py
│       │   │   │   ├── integrations.py
│       │   │   │   └── webhooks.py
│       │   │   └── dependencies.py
│       │   ├── core/                     # settings, auth, errors, logging
│       │   ├── domain/
│       │   │   ├── agents/               # registry and manifest loader
│       │   │   ├── workflows/            # graph validation and execution plan
│       │   │   ├── outreach/             # planner, policies, dispatch logic
│       │   │   ├── approvals/
│       │   │   ├── integrations/
│       │   │   └── runs/
│       │   ├── contracts/                # Pydantic input/output models
│       │   ├── schemas/                  # versioned JSON Schema artifacts
│       │   ├── agents/
│       │   │   ├── universal_outreach/
│       │   │   ├── lead_qualification/
│       │   │   ├── follow_up/
│       │   │   ├── meeting_booking/
│       │   │   ├── crm_update/
│       │   │   └── lead_research/
│       │   ├── adapters/
│       │   │   ├── email/                # provider interface + implementations
│       │   │   ├── voice/                # provider interface + Sarvam adapter
│       │   │   ├── crm/
│       │   │   └── calendar/
│       │   ├── policies/                # consent, suppression, limits, windows
│       │   ├── persistence/              # SQLAlchemy models and repositories
│       │   ├── services/                 # orchestration/application services
│       │   ├── events/                   # normalized internal event types
│       │   └── tests/
│       │       ├── unit/
│       │       ├── integration/
│       │       ├── contract/
│       │       └── fixtures/
│       └── Dockerfile
├── packages/
│   ├── agent-contracts/                  # shared JSON Schema / generated TS types
│   ├── config-schema/                    # UI schema conventions and validators
│   └── eslint-config/                    # optional shared frontend lint config
├── infra/
│   ├── docker-compose.yml                # local Postgres and optional Redis
│   ├── migrations/                       # only if migrations are centrally managed
│   ├── deployment/                       # environment-specific deployment files
│   └── observability/                    # dashboards and alert definitions
├── docs/
│   ├── architecture.md
│   ├── api-contracts.md
│   ├── provider-capabilities.md
│   ├── threat-model.md
│   └── runbooks/
├── scripts/
│   ├── dev-check.sh
│   ├── validate-schemas.py
│   └── seed-agent-catalog.py
├── .env.example
├── .gitignore
├── package.json                          # npm/pnpm workspace root
├── pnpm-workspace.yaml
└── README.md
```

### Folder rules

- `contracts/` contains canonical Pydantic models and their generated/versioned JSON Schemas; it must not contain provider-specific request payloads.
- `adapters/` contains provider-specific mapping, authentication, API calls, and error normalization.
- `policies/` contains safety and authorization decisions; never bury these inside prompts.
- `domain/workflows/` validates graphs and field mappings; React Flow is only the editor.
- `apps/trigger/` contains durable job definitions. Tasks call authenticated APIs and should not become a second source of business logic.
- `persistence/` is the only layer that directly knows database implementation details.
- `schemas/` and manifests are versioned. Do not mutate a published schema in place; publish a new version and define compatibility/migration behavior.
- Do not commit `.env`, API keys, voice credentials, provider tokens, recipient lists, or transcripts.

---

## 29. Technology Stack and What Each Part Does

| Layer | Recommended technology | Responsibility | Important boundary |
|---|---|---|---|
| Web UI | React + Vite + TypeScript | Marketplace, dynamic forms, workflow editor, run inspector | Does not decide permissions or execution truth |
| Styling/components | Tailwind CSS and a reusable component library already used by the platform | Consistent UI, responsive panels, accessible controls | Keep form widgets driven by schema metadata |
| Workflow canvas | `@xyflow/react` (React Flow) | Nodes, edges, ports, interactions | Not the workflow runtime or database |
| Form state | React Hook Form plus a schema-aware renderer | Dynamic configuration forms and field-level errors | Backend validation remains authoritative |
| API client | Typed fetch client or existing client library | Calls authenticated backend endpoints | Never expose provider secrets in browser code |
| API/backend | Python + FastAPI | Authenticated REST endpoints, validation, orchestration | Stateless API handlers; long-running jobs go to Trigger.dev |
| Agent contracts | Pydantic v2 + versioned JSON Schema | Validate input, config, output, and field mapping | Public contracts remain provider-neutral |
| Agent framework | Pydantic AI where model/tool orchestration is useful | Personalization, classification, structured extraction | Do not use an LLM where deterministic code is sufficient |
| Database | PostgreSQL + SQLAlchemy 2 + Alembic | Tenants, manifests, configs, workflows, approvals, runs, events | Database is source of truth for business state |
| Durable jobs | Trigger.dev TypeScript SDK | Long-running tasks, scheduled continuations, retries | Call the Python API; don't duplicate domain logic in tasks |
| Voice | Sarvam Voice Agents behind `VoiceProvider` interface | Managed real-time conversation and supported telephony path | Verify exact account/API/callback capabilities before launch |
| Email | Provider adapter chosen after deliverability and integration review | Send, status lookup, bounce/complaint events where available | Do not hard-wire a provider into the public agent contract |
| Secrets | Existing deployment secret manager | Provider tokens and internal service credentials | Encrypt, restrict access, rotate, and audit |
| Object storage | S3-compatible private bucket or current platform equivalent | Large transcripts, exports, artifacts | Private by default; signed URLs with short expiry |
| Observability | Structured logs + OpenTelemetry; optional Langfuse for LLM traces | Correlation, latency, failures, evaluations | Redact recipient PII and credentials |
| Tests | Pytest, frontend test runner, contract tests | Unit/integration/e2e/reliability tests | Test duplicate and ambiguous side effects explicitly |

Use the versions already supported by your deployment and lock them in package/lock files. Avoid blindly using floating `latest` versions in production. If the marketplace already has a frontend, auth system, database, or deployment pattern, reuse it rather than rebuilding that layer.

---

## 30. Canonical Contracts and Manifest Examples

### 30.1 Provider-neutral input contract

Illustrative Pydantic model (adapt names to the existing platform's contracts):

```python
from typing import Any, Literal
from pydantic import BaseModel, Field, ConfigDict

class Recipient(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_id: str
    name: str | None = None
    email: str | None = None
    phone_e164: str | None = None
    locale: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)

class OutreachInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Literal["1.0"] = "1.0"
    tenant_id: str
    workflow_run_id: str
    agent_instance_id: str
    idempotency_key: str
    channel: Literal["email", "voice"]
    objective: str = Field(min_length=1, max_length=2000)
    recipients: list[Recipient] = Field(min_length=1, max_length=500)
    config_version: str
    require_approval: bool = True
```

Tenant identity should normally be derived from authenticated context rather than trusted from a user-editable payload. The example includes it to make the contract's scope visible; production APIs must verify it against the caller's authorization context.

### 30.2 Normalized output contract

```python
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

class RecipientResult(BaseModel):
    recipient_id: str
    status: Literal[
        "drafted", "awaiting_approval", "queued", "submitted",
        "delivered", "answered", "no_answer", "failed", "suppressed", "unknown"
    ]
    provider_reference: str | None = None
    outcome: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    error_message_safe: str | None = None
    completed_at: datetime | None = None

class OutreachResult(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    workflow_run_id: str
    agent_instance_id: str
    status: Literal["accepted", "running", "partial", "succeeded", "failed", "cancelled"]
    results: list[RecipientResult]
    warnings: list[str] = Field(default_factory=list)
```

`delivered` must only be used when the provider supplies evidence of delivery. `answered` must only be used when the voice provider's events support that conclusion. An HTTP acceptance response means `submitted` or `queued`, not necessarily delivered or completed. Provider-specific status values are mapped to these canonical states in the adapter.

### 30.3 Agent manifest example

```yaml
agent_id: universal-outreach-agent
version: 1.0.0
status: active
category: outreach
capabilities:
  - email_outreach
  - voice_outreach
input_schema_ref: outreach.input.v1
config_schema_ref: universal_outreach.config.v1
output_schema_ref: outreach.result.v1
modes:
  - id: email
    required_integration: email_provider
  - id: voice
    required_integration: sarvam_voice
side_effects: true
approval_policy: required_by_default
runtime:
  handler: universal_outreach
  timeout_seconds: 900
```

The YAML above is a marketplace-owned example, not a Sarvam manifest format. The `handler` must resolve through an internal registry allowlist.

---

## 31. Backend API Surface

Use versioned, authenticated APIs. The names below are a starting contract, not a claim that these endpoints already exist.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/agents` | List available agent manifests and capability metadata |
| `GET /api/v1/agents/{agent_id}` | Fetch agent details and schema references |
| `POST /api/v1/agent-instances` | Create a configured instance from an allowlisted template |
| `GET /api/v1/agent-instances/{id}` | Load configuration and version state with permission checks |
| `PATCH /api/v1/agent-instances/{id}/draft` | Save an unvalidated or partially configured draft |
| `POST /api/v1/agent-instances/{id}/validate` | Return field, integration, permission, and policy errors |
| `POST /api/v1/agent-instances/{id}/test` | Run a safe dry run or test route without unintended live side effects |
| `POST /api/v1/agent-instances/{id}/publish` | Publish an immutable validated configuration version |
| `POST /api/v1/workflows` | Create a workflow draft |
| `PATCH /api/v1/workflows/{id}` | Save graph and mappings with optimistic concurrency/version checks |
| `POST /api/v1/workflows/{id}/validate` | Validate graph, cycles, mappings, schemas, integrations, permissions |
| `POST /api/v1/workflows/{id}/publish` | Publish immutable workflow version |
| `POST /api/v1/workflows/{id}/runs` | Start a run after policy and approval checks |
| `GET /api/v1/runs/{id}` | Get normalized run state and safe outputs |
| `POST /api/v1/runs/{id}/cancel` | Request cancellation where it is safe and supported |
| `POST /api/v1/approvals/{id}/decision` | Record an authorized approve/reject decision |
| `POST /api/v1/integrations/{provider}/connect` | Start a protected integration setup flow |
| `POST /api/v1/webhooks/{provider}` | Receive authenticated provider events after signature verification |

For every mutation, validate the caller's tenant and role, record an audit event, enforce CSRF protections where applicable, and use idempotency keys for run creation and external actions. Provider webhooks must be signature-verified where supported, deduplicated, and reconciled if events are missing or ambiguous.

---

## 32. Persistence Model

Use PostgreSQL as the business source of truth. A minimal first release should include the following logical entities (physical table names may differ):

- `tenants`, `users`, `memberships`, `roles` — tenant isolation and access control; reuse the platform's existing auth model if available.
- `agent_manifests`, `agent_schema_versions` — stable template metadata and immutable schema versions.
- `agent_instances`, `agent_config_versions` — user-created instances and immutable published configuration snapshots.
- `integrations`, `integration_credentials_ref` — provider connection metadata and a reference to secrets in a secret manager; never store raw provider tokens in ordinary rows.
- `workflows`, `workflow_versions`, `workflow_nodes`, `workflow_edges`, `field_mappings` — editable graph and published snapshots.
- `workflow_runs`, `node_runs`, `recipient_runs` — execution state, attempts, timestamps, normalized outputs, safe error information.
- `approvals`, `policy_decisions`, `suppression_entries`, `consent_records` — authorization and outreach controls.
- `provider_events`, `idempotency_records`, `reconciliation_jobs` — deduplication and recovery from external uncertainty.
- `audit_events`, `usage_records` — auditability, quotas, and cost/usage reporting.

Store the published workflow graph and configuration snapshots as immutable versions. Mutable runtime state belongs in run tables. Index tenant IDs, workflow/run IDs, provider references, idempotency keys, event IDs, and status/timestamp fields. Apply tenant scoping at the repository/service layer and, where feasible, reinforce it with PostgreSQL row-level security.

---

## 33. Step-by-Step Implementation Plan

### Phase 0 — Verify constraints before building

1. Confirm the existing marketplace framework, authentication, database, deployment, and API conventions. Reuse them where possible.
2. Verify Sarvam account access, outbound-call API, telephony requirements, callbacks/webhooks, variable mapping, rate limits, and commercial/marketplace terms.
3. Select the first email provider based on account access, sending domain setup, deliverability, API/webhook support, and pricing.
4. Write a short ADR (architecture decision record) for each provider and pin tested SDK versions.
5. Keep live sending/calling disabled until provider and policy checks pass.

**Deliverable:** signed-off provider capability matrix and no secrets committed to source control.

### Phase 1 — Contracts and catalog foundation

1. Create Pydantic models for `OutreachInput`, `OutreachResult`, `Recipient`, and normalized provider events.
2. Generate and version JSON Schemas from Pydantic models; add schema compatibility tests.
3. Implement the agent registry with an allowlist of known templates.
4. Register `universal-outreach-agent` and its email/voice modes.
5. Build configuration validation and structured error responses.
6. Add PostgreSQL migrations and repository/service layers.

**Deliverable:** backend can list the agent, validate a configuration, and return a predictable contract without contacting any provider.

### Phase 2 — Marketplace UI and dynamic forms

1. Build the catalog and agent detail pages.
2. Build a schema-driven form renderer using React Hook Form and the agreed JSON Schema/UI metadata conventions.
3. Add guided and advanced modes, conditional channel fields, defaults, validation errors, and draft saving.
4. Build integration connection status and configuration health checks.
5. Build an output schema editor limited to supported primitive/object/array types.
6. Add test preview that uses mocked providers by default.

**Deliverable:** a user can configure and validate an instance without editing code or opening Sarvam's workspace.

### Phase 3 — Email path first

1. Implement the email provider interface and one real provider adapter.
2. Implement recipient normalization, duplicate detection, suppression/consent checks, message drafting, preview, approval, and controlled dispatch.
3. Add Trigger.dev task to call the authenticated Python API for dispatch and status processing.
4. Persist per-recipient state and reconcile provider responses/events.
5. Test duplicate submissions, timeouts, provider 429s, partial batch failures, and safe retry behavior.

**Deliverable:** a sandbox/test campaign works end-to-end and live sends remain approval-gated.

### Phase 4 — Voice/Sarvam path

1. Implement a provider-neutral `VoiceProvider` interface.
2. Implement a Sarvam adapter only for verified, supported operations.
3. Map canonical recipient fields to configured Sarvam variables on the server.
4. Validate that required provider variables exist and are compatible before campaign launch.
5. Implement initiation, status lookup/callback handling, transcript/summary processing where available, and reconciliation.
6. Add consent, calling-window, approval, concurrency, quota, opt-out, and emergency-stop enforcement.
7. Use test calls/test routes first; enable production calls only after a documented go-live review.

**Deliverable:** voice results normalize to the same marketplace result contract and ambiguous provider outcomes do not trigger blind duplicate calls.

### Phase 5 — Workflow canvas and graph execution

1. Build the React Flow editor with controlled node/edge state.
2. Render node handles from input/output schemas and current configuration.
3. Implement field mapping and type checks, cycle checks, required-input validation, and configuration health indicators.
4. Save graph drafts; publish immutable workflow versions.
5. Implement a platform-owned graph executor that creates node runs, maps upstream outputs to downstream inputs, and applies conditions.
6. Use Trigger.dev for durable execution, delays, retries, and asynchronous continuations; it calls the Python API for domain operations.
7. Build run inspector with node status, safe logs, normalized outputs, and retry/reconciliation indicators.

**Deliverable:** a workflow can route normalized results from outreach to downstream agents without provider-specific edges.

### Phase 6 — Hardening and rollout

1. Add tenant isolation and role tests, rate limits, quota enforcement, audit events, and secrets rotation.
2. Add observability, alerts, retention/deletion jobs, and incident runbooks.
3. Run contract, integration, end-to-end, load, and failure-injection tests.
4. Release to internal users, then a small allowlisted pilot, then broader availability.
5. Keep a feature flag/kill switch for each provider and for all live outreach.

**Deliverable:** controlled release with measurable failure rates, reconciliation, rollback, and incident response.

---

## 34. Trigger.dev Task Design Rules

Use Trigger.dev as a durable execution layer, not as the source of truth for workflow state or business policy. Keep tasks small, idempotent, observable, and safe to resume.

Recommended task responsibilities:

- `execute-workflow`: request a run from the platform runtime and advance durable steps.
- `execute-outreach-batch`: process a bounded batch with concurrency limits.
- `dispatch-email`: ask the backend to dispatch one approved idempotent message or a bounded batch.
- `initiate-voice-campaign`: ask the backend to start an approved campaign only after live-action policy gates pass.
- `process-provider-event`: pass verified/deduplicated normalized provider events to the backend.
- `reconcile-provider-status`: query provider state for records left in `unknown`/pending states.

Rules:

1. Do not put raw provider secrets in task payloads.
2. Do not use task retries to repeat an external side effect unless idempotency is guaranteed or state has been reconciled.
3. If a provider request times out after submission, mark the result as uncertain and reconcile by idempotency/provider reference before retrying.
4. Use bounded concurrency and batch sizes; respect provider limits.
5. Pass correlation IDs and idempotency keys through every layer.
6. Persist business state in PostgreSQL before and after external actions.
7. Keep retry policies per failure class: validation/policy failures are not retried; transient provider failures may be retried with bounded backoff; ambiguous outcomes are reconciled first.

---

## 35. Security, Privacy, and Operational Requirements

- Tenant isolation is enforced on every API query and mutation.
- Authentication is inherited from the platform; service-to-service calls use short-lived or rotated credentials.
- Provider secrets are held in a secret manager or encrypted credential service and never sent to the browser.
- Validate webhook signatures and timestamps where supported; deduplicate events by provider event ID.
- Maintain explicit consent/eligibility and suppression records; process opt-outs before any subsequent contact.
- Enforce local applicable contact/calling-time restrictions and user-configured campaign windows.
- Require human approval by default for external sends/calls in the initial release.
- Use a global kill switch plus per-tenant and per-campaign pause controls.
- Redact phone numbers, email addresses, message bodies, transcripts, and tokens from routine logs.
- Define retention and deletion for recipients, message content, transcripts, generated artifacts, and audit data.
- Treat prompts, recipient data, provider transcripts, and tool outputs as untrusted input; they must not override system policy or cause arbitrary tool execution.
- Keep a clear distinction between user-visible status and confirmed provider evidence.

### Environment variables

Create `.env.example` with names and descriptions only, never real values. Exact provider-specific variables should follow the SDK/API contract actually adopted. Typical categories include:

```dotenv
APP_ENV=development
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/agent_marketplace
INTERNAL_API_TOKEN=replace-in-secret-manager
TRIGGER_SECRET_KEY=replace-in-secret-manager
TRIGGER_PROJECT_REF=replace-with-project-ref
SARVAM_API_KEY=replace-in-secret-manager
EMAIL_PROVIDER_API_KEY=replace-in-secret-manager
OBJECT_STORAGE_BUCKET=private-agent-artifacts
OTEL_EXPORTER_OTLP_ENDPOINT=
```

These are illustrative variable names, not a guarantee that every SDK uses these exact names. Load secrets from the deployment secret manager in production. Never expose them through Vite `VITE_*` variables, because those are bundled into client-side code.

---

## 36. Testing Strategy and Definition of Done

### Required automated tests

- Unit: schema validation, config migration, field mapping, status normalization, policy decisions, suppression, idempotency.
- Contract: input/output JSON Schema, provider adapter contract, webhook event normalization, backward compatibility.
- Integration: database transactions, API auth/tenant isolation, Trigger.dev-to-API authentication, provider sandbox calls.
- UI: dynamic form conditions, schema changes, invalid edge states, save/publish errors, accessibility of controls.
- End-to-end: configure agent, validate, test, approve, execute, inspect results, and route output downstream.
- Failure injection: provider timeout after request submission, duplicate webhook, out-of-order events, HTTP 429, expired credential, worker restart, partial recipient batch, and unknown provider status.
- Security: cross-tenant access, unauthorized approvals, forged webhooks, leaked secret checks, prompt injection in recipient-supplied content.

### Definition of done for a feature

A feature is not complete until:

- It has a versioned input/config/output contract.
- UI and backend validation agree on expected valid/invalid states.
- Authorization and tenant scope are tested.
- Errors are structured and actionable without leaking secrets.
- Side effects are idempotent or reconciled safely.
- Run/audit state is persisted and visible to authorized users.
- It has unit and integration coverage plus a documented operational failure mode.

### MVP acceptance checklist

- [ ] User can select Universal Outreach and choose email or voice.
- [ ] User can customize supported fields entirely inside the marketplace UI.
- [ ] Backend validates configuration and integration readiness.
- [ ] User can preview/test without accidental live sends/calls.
- [ ] Email send is approval-gated, idempotent, and status-reconciled.
- [ ] Voice execution is disabled until Sarvam API, telephony, callback, and commercial capability are verified.
- [ ] Provider payloads never leak into public contracts or workflow edges.
- [ ] Workflow graph and configuration versions are persisted and recoverable.
- [ ] Trigger.dev retries do not blindly repeat ambiguous external actions.
- [ ] Every run has correlation IDs, normalized results, safe logs, and audit events.
- [ ] Tenant isolation, suppression/consent, quotas, and emergency stop are tested.

---

## 37. Final Build Order and Product Rule

**Build in this order:** contracts and registry → dynamic configuration UI → email adapter and approvals → durable tasks and reconciliation → Sarvam adapter after capability verification → workflow canvas and typed mapping → downstream agents → production hardening.

**Product rule:** Users configure the outcome in your marketplace. Your code owns supported capabilities and safety rules. Manifests and versioned schemas drive the UI. Provider adapters translate only the supported configuration into external APIs. The workflow engine routes normalized outputs. Trigger.dev makes long-running work durable. PostgreSQL remains the source of truth.

The initial 5–6 agent templates are a catalog strategy, not a reason to build 5–6 separate systems. Start with Universal Outreach as the only fully operational template; implement shared contracts, dynamic forms, policy gates, adapters, and workflow primitives so the remaining templates can be added incrementally and honestly.

---

## 38. Marketplace Standard for Agents with Different Internal Architectures

The existing Research Agent is a useful example of a specialized agent that uses its own internal stack:

- Node.js native HTTP server and a minimal HTML/CSS/JavaScript UI today.
- Server-Sent Events (SSE) for streaming progress and partial results.
- LangGraph for research orchestration and bounded parallel workers.
- Trigger.dev for durable background execution.
- SerpAPI and Firecrawl for search and extraction.
- OpenAI, Groq, and OpenRouter-backed safety classification for different model tasks.
- Langfuse for LLM tracing and latency/token observability.

Universal Outreach has different technical needs:

- TypeScript Trigger.dev tasks for durable marketplace execution.
- A Python FastAPI service using Pydantic v2 contracts and, where useful, Pydantic AI.
- PostgreSQL as the business/workflow source of truth.
- Email and Sarvam voice adapters behind stable internal interfaces.
- Provider callbacks, reconciliation, idempotency, approval gates, and normalized outcomes.
- React Flow and schema-driven configuration in the marketplace frontend.

### 38.1 Standardize the boundary, not every agent's implementation

**Do not force every agent to use the same framework or programming language.** The Research Agent can remain a TypeScript/Node.js + LangGraph service, while Universal Outreach can remain a TypeScript/Python hybrid. Other agents may use a different stack when it is justified by their capabilities and operational requirements.

The marketplace should standardize the external agent protocol and lifecycle:

1. **Manifest:** agent ID, version, display metadata, capabilities, supported actions, permissions, configuration schema reference, input/output schema references, health/readiness behavior, resource limits, and required integrations.
2. **Input/output contracts:** versioned JSON Schema documents. Each agent may use its native internal models, but it must validate and translate at the boundary.
3. **Configuration contract:** a versioned schema plus UI metadata so the marketplace can dynamically render forms without knowing the agent's internal implementation.
4. **Invocation contract:** authenticated, tenant-scoped execution request with run ID, correlation ID, idempotency key, deadline/budget, and validated input.
5. **Lifecycle and status contract:** accepted, queued/running, waiting for approval/input, completed, partially completed, failed, cancelled, or outcome unknown. Only expose states that the agent can reliably support.
6. **Result contract:** normalized output, structured errors, artifact references, usage/metrics where applicable, and provenance/citations where the agent's function requires them.
7. **Events and callbacks:** authenticated, replay-safe events for progress, approval requests, completion, provider updates, and failures. Events need IDs and timestamps; consumers must tolerate duplicates and out-of-order delivery.
8. **Security and trust:** declared permissions, tenant isolation, secret references rather than plaintext credentials, audit records, quotas, policy enforcement, and explicit external side-effect declarations.
9. **Observability:** shared correlation IDs and a common minimum set of run metrics. Agents may use Langfuse, OpenTelemetry, or both internally; the marketplace should not depend on one vendor-specific trace format for correctness.
10. **Packaging and deployment:** agents may be hosted services or managed workers, but their deployment type, health check, version, timeout, concurrency, and resource requirements must be declared and verified.

### 38.2 Example: marketplace-level invocation flow

```text
User selects an agent and configures it in the marketplace
                    |
                    v
Marketplace loads the versioned manifest + config/input schemas
                    |
                    v
UI renders supported fields and workflow ports dynamically
                    |
                    v
Marketplace validates tenant permissions, config, input, quota and policy
                    |
                    v
Marketplace creates a durable run record and correlation/idempotency IDs
                    |
                    v
Agent adapter / execution gateway invokes the agent's declared interface
           /                                  \
          v                                    v
Research Agent                           Universal Outreach Agent
Node.js + LangGraph                     TypeScript task + Python API
          |                                    |
          v                                    v
Research/report result                   Normalized outreach result
           \                                  /
            v                                v
      Validate output against the declared versioned output schema
                              |
                              v
      Persist status, artifacts, usage, events and audit records
                              |
                              v
          Route normalized output to the next workflow node
```

The diagram represents a recommended marketplace integration boundary, not a claim that all these services or endpoints already exist in the repository.

### 38.3 Keep agent-specific frameworks inside their own service

- **Research Agent:** LangGraph owns its internal research graph, worker fan-out, critique/refinement loop, and research-specific budgets. Its SSE UI can remain useful for local development or standalone operation. When launched from a marketplace workflow, its result must also be returned through the marketplace execution contract; SSE alone is not the durable agent contract.
- **Universal Outreach Agent:** its provider-independent domain layer owns recipient validation, message/call policy, consent and suppression checks, provider dispatch, normalized results, and reconciliation. Trigger.dev coordinates durable execution; it is not a replacement for marketplace workflow definitions or business state.
- **Other specialized agents:** can use LangGraph, Pydantic AI, a deterministic pipeline, plain TypeScript/Python, or another framework when justified. A framework is an implementation choice, not a marketplace capability declaration.

Do not put every agent into one giant LangGraph. Do not require every agent to use Pydantic AI. Do not use SSE as the only interface for long-running execution. Keep framework-specific state internal and translate at the contract boundary.

### 38.4 Shared monorepo structure without forcing a shared runtime

A recommended repository layout is:

```text
agentic-marketplace/
├── apps/
│   ├── marketplace-web/             # React/Vite UI, catalog, configuration, workflow canvas
│   └── marketplace-api/             # Auth, registry, workflow/run APIs, policies
├── packages/
│   ├── agent-protocol/              # OpenAPI definitions, JSON Schemas, error/status/event envelopes
│   ├── agent-sdk-typescript/        # TypeScript client and manifest helpers
│   ├── agent-sdk-python/            # Python client and Pydantic validation helpers
│   ├── workflow-contracts/          # Shared node, edge, mapping and run contracts
│   └── observability/               # Correlation IDs and common telemetry conventions
├── agents/
│   ├── research-agent/              # Existing Node.js + LangGraph implementation
│   └── universal-outreach-agent/   # TypeScript tasks + Python API + provider adapters
├── workers/
│   └── trigger-dev/                 # Durable task entrypoints and scheduled reconciliation
├── infra/
│   ├── docker/
│   └── deployment/
├── docs/
│   ├── agent-authoring-guide.md
│   ├── agent-protocol.md
│   └── security-and-review.md
└── tests/
    ├── contract-conformance/
    └── end-to-end/
```

This is a proposed target layout. Preserve the current repository layout where practical and migrate incrementally; do not move files solely to match this example before inspecting the actual repository and its deployment constraints.

### 38.5 Agent manifest example

The exact schema should be versioned and validated in code. The following is an illustrative manifest shape, not a ready-to-use validated schema:

```json
{
  "protocolVersion": "1.0",
  "id": "research-agent",
  "version": "1.0.0",
  "displayName": "Research Agent",
  "capabilities": ["web_research", "report_generation", "source_citations"],
  "execution": {
    "mode": "remote_service",
    "supportsStreaming": true,
    "supportsCancellation": true
  },
  "schemas": {
    "config": "research-agent.config.v1",
    "input": "research-agent.input.v1",
    "output": "research-agent.output.v1"
  },
  "permissions": ["web_search", "web_fetch"],
  "limits": {
    "maxRuntimeSeconds": 300,
    "maxConcurrentRuns": 5
  }
}
```

Do not assume that `supportsCancellation`, streaming, limits, or a particular execution mode are available until the agent implementation actually supports and tests them. The registry must distinguish declared capability from verified capability.

### 38.6 TypeScript and Python interoperability

Use OpenAPI for HTTP endpoint definitions and JSON Schema for configuration, input, output, and event payloads. Generate or validate language-specific types where possible, but treat the versioned schemas as the interoperability source of truth. Keep these rules:

- Use the same semantic field names and meanings across TypeScript and Python.
- Define optionality, nullability, timestamps, enums, IDs, and error codes explicitly.
- Reject unknown or invalid values at the boundary where strictness is required; version schema changes deliberately.
- Never pass Python objects, LangGraph state, Pydantic model internals, or provider-native Sarvam payloads directly across public workflow edges.
- Store schema version with every saved node configuration and run input/output.
- Test each agent against a shared contract-conformance suite.

### 38.7 Trigger.dev's role across agents

Trigger.dev can be shared infrastructure for durable TypeScript tasks, schedules, retries, and event-driven continuation, but it must not become the only source of business truth. The marketplace database owns run records, authorization decisions, workflow versions, approval state, and normalized outcomes. Trigger.dev task payloads should carry stable IDs and references rather than large or sensitive business payloads where possible.

For agents with a native durable engine such as LangGraph, decide explicitly which layer owns each retry and checkpoint. Avoid nested, unbounded retries across LangGraph, Trigger.dev, provider SDKs, and HTTP clients. For external side effects, use idempotency or reconciliation before repeating a call/send whose outcome is ambiguous.

### 38.8 Streaming versus durable completion

SSE is appropriate for sending live progress to a browser, but it is a transport, not a durable record of execution. Persist progress and final status independently. The marketplace UI can subscribe to a marketplace event/SSE endpoint, reconnect using run/event IDs, and reload the canonical run record after reconnecting. The Research Agent's current local UI may remain separate, while marketplace-launched research runs report status through the standard agent integration boundary.

### 38.9 Rollout plan

1. **Inventory:** document the existing Research Agent's actual endpoints, input/output shape, auth, task behavior, deployment, SSE behavior, limits, and failure modes. Verify code rather than treating architecture documentation as proof of implementation.
2. **Protocol first:** define manifest, config/input/output schemas, invocation envelope, normalized status/error model, and event envelope.
3. **Conformance tests:** validate example requests, responses, events, invalid schemas, tenant scope, and duplicate events.
4. **Research adapter:** wrap the existing Research Agent without rewriting LangGraph or replacing its UI. Add marketplace authentication and normalized result handling as needed.
5. **Outreach adapter:** implement its stable contract and provider-independent normalized outputs; keep email and voice capabilities explicit.
6. **Registry and dynamic UI:** load schemas/manifests from the registry and render agent forms and workflow ports from verified capabilities.
7. **Observability and operations:** propagate correlation IDs, expose safe run status, persist events, define alerting, and test failure recovery.
8. **Add more agents:** each new agent implements the protocol and passes conformance/security review; it does not need to copy another agent's internal stack.

### 38.10 Acceptance criteria for marketplace interoperability

- [ ] Research Agent and Universal Outreach Agent can be invoked through a documented, authenticated marketplace boundary.
- [ ] Their internal frameworks and languages remain independent.
- [ ] Manifests and config/input/output schemas are versioned.
- [ ] The UI renders only declared and verified capabilities.
- [ ] Workflow edges map compatible typed fields and reject invalid mappings.
- [ ] Outputs are validated and normalized before downstream routing.
- [ ] Long-running state is persisted independently of SSE connections and worker memory.
- [ ] Duplicate or out-of-order events do not corrupt run state.
- [ ] Retry ownership is explicit, and ambiguous external side effects are reconciled safely.
- [ ] Shared authorization, tenant isolation, quotas, audit and observability requirements are tested.

**Marketplace architecture decision:** standardize the protocol, contracts, security, lifecycle, observability, and workflow integration. Let each specialized agent choose the internal framework and runtime that best fit its job. This gives the marketplace interoperability without needless rewrites or a monolithic agent implementation.
