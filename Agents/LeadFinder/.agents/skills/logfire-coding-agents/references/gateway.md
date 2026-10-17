# Gateway Routing for Coding Agents

Gateway routes model requests; telemetry observes activity. A Gateway key is
not a telemetry write token, and neither authenticates the MCP client. Explain
that inference uses the selected organization's Gateway balance and may incur
model charges. Do not change the user's provider or model merely because they
asked to record sessions.

## Persistent connection

For continued use, configure the explicitly selected agent:

```bash
logfire-cli --org acme --beta --no-input --output json agent gateway --agent claude
logfire-cli --org acme --beta --no-input --output json agent gateway --agent codex
```

Run only the requested agent's command. The CLI creates or revalidates a
project-bound Gateway key in the OS credential store. Agent settings contain
the Gateway URL and a credential-helper command, not the key. Use a persistent
CLI executable path because the helper must remain available after setup.
Repeated setup reuses the bound active key; do not mint another with `api-key`
as a workaround. Surface conflicting settings or missing permissions.

Codex uses a dedicated profile, launched with `codex --profile logfire`.
Claude uses its base URL and `apiKeyHelper` settings; restart it after setup.
Gateway setup and removal preserve independently configured telemetry.

```bash
logfire-cli --org acme --beta --no-input --output json agent gateway status --agent claude
logfire-cli --org acme --beta --no-input --output json agent gateway status --agent codex
```

Status checks configuration, not live key validity or inference. In particular,
`credential: not_checked` is not successful credential verification.

## Temporary connection

Use a temporary proxy when the user wants a one-session trial rather than
persistent provider settings. Launch only when the user intends to start that
agent; otherwise provide the command for their terminal, not a nested session.

```bash
logfire-cli --org acme --beta agent proxy launch claude
logfire-cli --org acme --beta agent proxy launch codex
logfire-cli --org acme --beta agent proxy launch copilot --model gpt-5.4
```

The proxy uses the selected project's organization-bound browser OAuth session,
not a headless API key. It exchanges that grant for a short-lived Gateway token;
the child receives only a local temporary credential. Copilot requires an
explicit model. Do not claim temporary support for Cursor or Antigravity.
Claude's `--settings` option is reserved for the temporary provider override.
When the agent exits, the proxy stops without changing persistent telemetry.

For other supported clients, `agent proxy serve` provides a local `base_url`
and temporary secret `token`. Capture that output privately; do not paste it in
chat. The root URL is not an inference endpoint: OpenAI/Codex uses
`/proxy/openai`, Anthropic/Claude uses `/proxy/anthropic`. Do not append `/v1`
to the OpenAI base URL; the configured upstream already supplies its API
version. To repair older persistent Codex routes, rerun the Gateway setup
command, which revalidates and reuses the existing key.

Hosted US/EU targets select their Gateway automatically. Self-hosted targets
need a confirmed `--gateway-url` using HTTPS or loopback HTTP. Do not derive a
Gateway resource from an arbitrary platform hostname.

## Verify and recover

Run one harmless model request through the chosen configuration when authorized.
A working settings file or status result is not proof that inference used
Gateway. Check the response and fresh Gateway activity in the exact project
when read access is available. Report inference and Logfire-side observation
separately. Do not count an existing session still using its original provider.

The temporary proxy does not replay model requests. Expired/rejected OAuth
requires signing in for the same organization and restarting the proxy; do not
retry model calls in a loop or select another project. Report provider billing,
activation, and permission failures as prerequisites, not successful setup.

## Remove persistent routing

Preview the selected agent's changes, then remove after confirmation:

```bash
logfire-cli --org acme --beta --no-input --output json agent gateway remove --agent claude --dry-run
logfire-cli --org acme --beta --no-input --output json agent gateway remove --agent claude --yes
```

Use `--agent codex` for Codex. Removal preserves unrelated settings, telemetry,
and the stored Gateway key. It is not key revocation. Recheck status and restart
the agent; report an ownership conflict rather than deleting settings manually.
