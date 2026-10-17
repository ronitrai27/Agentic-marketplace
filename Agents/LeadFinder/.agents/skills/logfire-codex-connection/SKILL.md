---
name: logfire-codex-connection
description: Connect Codex itself to Logfire, check connection status, or stop session recording. Use for this plugin's MCP access and optional native Codex telemetry, not application instrumentation or AI Gateway routing.
---

# Connect Codex to Logfire

Help the user connect, check status, or disconnect without making them run a
setup checklist. Honor the requested operation; a status request never grants
permission to install, authenticate, or repair anything.

For connection, ask only if missing: "Would you like to query Logfire, record
your Codex sessions, or both?" MCP access and recording are independent. Do not
require CLI login for working MCP, or MCP read access to record sessions.

- **Connect:** follow [connection setup](references/connect.md).
- **Status:** follow [status and removal](references/status.md#status).
- **Disconnect:** follow [status and removal](references/status.md#disconnect).

Resolve bundled scripts relative to this installed skill directory. The runtime
helper is `../../scripts/agent_runtime.py --agent codex`; the explicit agent
selects Codex's separate runtime and project credential directory.
Quote paths as single arguments. Do not assume
`CLAUDE_PLUGIN_ROOT` exists in Codex.

Leave telemetry configuration and exporter installation to the native Logfire
CLI. Do not add custom transcript hooks, copy credentials, open secret-bearing
Codex/exporter configuration files, or start a nested coding session for setup.
Keep existing application instrumentation, model providers, and Gateway routing
unchanged. Plugin installation is not consent to session capture.

Finish with MCP access, capture mode/destination, and delivery evidence as
separate facts. Give one next action. "Configured" does not mean data arrived.
