# Status and removal

## Status

Check MCP access separately through native Codex controls and, if available, a
small authenticated read. Do not launch login or change endpoints on failure.
Use the [MCP reference](mcp.md#status-and-disconnect) to distinguish the bundled
US server from a separately configured regional connection.

Run the bundled runtime helper with `--agent codex`, without `--install`, then
use its returned executable for `--beta --no-input --output json agent codex status`.
The status command needs no CLI account login or SDK project initialization.
Codex status/removal use `CODEX_HOME` and the exporter configuration selected by
`CODEX_LOGFIRE_CONFIG_FILE` or `XDG_CONFIG_HOME`; `--data-dir` is only the SDK
bootstrap credential directory used by configure, not an installation selector.
If the runtime is missing, report recording as unknown, not disabled: another
workflow may have configured it. Do not open secret-bearing configuration files.

Report native traces/logs and enrichment health, capture mode, destination, and
credential/permission problems. Delivery requires matching recent session data
in the confirmed project, not merely healthy local settings. Keep the user-facing
result short; offer connection setup for repairs without doing them automatically.

## Disconnect

Clarify whether the user wants to stop recording, disconnect MCP, or both when
ambiguous. MCP-only uses native connection controls and needs no runtime.
Follow [MCP disconnect](mcp.md#status-and-disconnect) without re-enabling a
previously disabled US connection.

For recording, explain that removal stops native export and removes enrichment,
but keeps skills, MCP, account login, and remote tokens. Once the user confirms
stopping recording, locate the runtime without `--install`, inspect
`--beta --no-input --output json agent codex status`, then run
`--beta --no-input --output json agent codex remove` and recheck status.
Codex removal has **no `--dry-run` option**; do not copy Claude's removal command.
Default removal retains the local exporter credential for reconnect. Do not use
`--delete-config` or revoke remote tokens unless requested separately.

If removal reports a conflict, missing runtime, or partial failure, preserve
unrelated settings and report it. Do not claim capture stopped. Never hand-delete
exporter fields or disable the entire Logfire plugin as a substitute. Ask for a
Codex restart to stop export from already-running sessions. Disconnect MCP
separately through native controls only if requested.
