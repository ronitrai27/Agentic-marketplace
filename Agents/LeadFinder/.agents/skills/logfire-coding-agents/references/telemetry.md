# Coding-session Telemetry

Confirm the destination and capture policy before enabling recording. Settings
are user-level: sessions in other repositories can also send to this project.
Disabling the Logfire MCP/skills plugin does not stop native telemetry.

All examples use a synthetic absolute data directory. Replace it with the
confirmed credential directory from the handoff or connection guide; keep it
on configuration, status, and removal commands rather than falling back to
another application's `.logfire` directory. Preserve target and organization.

## Claude Code

```bash
logfire-cli --org acme --beta --no-input --output json agent claude --data-dir /absolute/project-data configure --capture metadata-only
logfire-cli --org acme --beta --no-input --output json agent claude --data-dir /absolute/project-data status
```

Use `--capture full` only when the user chooses content capture. Full includes
messages, supported tool inputs/outputs, and raw model API bodies, which can
contain conversation history, source code, and secrets. Metadata-only retains
native traces, timing, and usage without message/tool content. Full is the CLI
default, so specify the chosen policy explicitly.

Claude exports logs, metrics, and beta traces natively. The CLI installs an
`otelHeadersHelper` pointing to the connected SDK credential; it does not add
transcript hooks or put the token in Claude settings. Keep the credential file
and executable available at their configured paths. Both telemetry and Gateway
honor `CLAUDE_CONFIG_DIR`; do not retarget a different Claude installation.

Native tool-output capture requires Claude Code 2.1.283 or later; not every
tool or failed call produces output, and thinking remains redacted. Detailed
beta tracing is separate and is not enabled. An older configuration can report
`needs_update`; reconfiguration enables the expanded capture policy, so obtain
the user's capture choice rather than silently upgrading it.

Restart Claude after configuration. If effective settings differ, check its
`/status` and the CLI status. Independent exporters or higher-priority settings
can conflict; report the conflict instead of rewriting them by hand.

## Codex

```bash
logfire-cli --org acme --beta --no-input --output json agent codex --data-dir /absolute/project-data configure --capture metadata-only
logfire-cli --org acme --beta --no-input --output json agent codex --data-dir /absolute/project-data status
```

Choose one explicit policy:

| Policy | Content |
| --- | --- |
| `full` | Native traces and logs with prompts, tool arguments, bounded tool-result previews, account email and host name; enrichment adds final assistant responses |
| `no-tool-content` | Native traces with prompt and final-response enrichment, without native logs or tool content |
| `metadata-only` | Timing and usage metadata without message/tool content |

The CLI configures native export plus its pinned `logfire-exporter` enrichment
plugin for fields native telemetry lacks. Do not install a duplicate transcript
exporter. Codex metrics are not redirected to Logfire. Static OTLP headers put
the write token in Codex configuration and the exporter credential file; treat
both as secrets, and do not print or commit them.

Restart Codex and review new hooks with `/hooks` if prompted. Configuration
refuses an independent exporter. A failed operation can leave the plugin
installed or a newly created token behind; follow the reported recovery action
instead of claiming the operation rolled back.

## Verify delivery, not just configuration

After restart, send one harmless prompt and record its time. With read-capable
MCP or CLI access, check fresh telemetry for that agent in the exact destination
project, matching the session identity when available. Old or unrelated data
is not delivery proof. A local status check does not prove token validity or
ingestion. If read access or session correlation is unavailable, report delivery
as unverified; never use a send-only SDK token for reads.

## Stop recording

For Claude, preview removal before confirming it:

```bash
logfire-cli --beta --no-input --output json agent claude --data-dir /absolute/project-data remove --dry-run
logfire-cli --beta --no-input --output json agent claude --data-dir /absolute/project-data remove --yes
```

For Codex, remove its managed export settings and enrichment plugin:

```bash
logfire-cli --beta --no-input --yes --output json agent codex --data-dir /absolute/project-data remove
```

Recheck the selected agent's status and restart it. Removal leaves Gateway and
MCP separate and does not revoke remote write tokens. Codex retains the local
exporter credential unless `--delete-config` is explicitly requested. Claude
retains its SDK credential and helper runtime. Do not delete files still used
by an active helper or bypass ownership conflicts with manual settings edits.
