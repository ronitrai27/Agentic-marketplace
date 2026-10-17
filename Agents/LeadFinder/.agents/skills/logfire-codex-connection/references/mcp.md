# Choose the MCP connection

The bundled server is fixed to `https://logfire-us.pydantic.dev/mcp`. Codex's
plugin policy can disable it but cannot change its URL. Do not edit plugin cache
files or use `LOGFIRE_MCP_URL` as an override.

Use native connection controls to inspect the installed Logfire plugin ID and
existing MCP connections. Inspect only names, URLs, and enabled state, not saved
headers or credentials. `codex plugin list --json` identifies the exact plugin ID
(normally `logfire@pydantic-skills`; other marketplaces have different IDs).
Do not assume an installed plugin's MCP server is listed by `codex mcp list`.

Confirm the region or exact self-hosted MCP URL. These are user-wide changes,
independent of session recording. Reuse a working connection matching the chosen
endpoint. If other Logfire connections are already enabled, explain the conflict
and get agreement on which to keep; never disable or replace them silently.

## US cloud

Use the bundled connection when there is no separately configured Logfire MCP.
If returning from regional setup, confirm removing the previous regional
connection first. Inspect its exact name and endpoint, then run
`codex mcp remove <confirmed-server-name>` only for that agreed connection.
Do not remove another server just because its name resembles Logfire.

Enable the bundled server with the helper below, authenticate it through Codex's
native connection controls, and verify with a small authenticated read.

## EU cloud or self-hosted

EU cloud uses `https://logfire-eu.pydantic.dev/mcp`. For self-hosted, use the
confirmed full MCP URL, not an assumed path or a hostname inferred from a token.

1. Confirm disabling the bundled server while retaining the plugin and skills.
   Run the helper below with `disable` and the actual installed plugin ID.
2. If an existing native connection matches this endpoint, reuse it. Otherwise
   use an available name (for example `logfire-regional`) and run
   `codex mcp add <server-name> --url <confirmed-mcp-url>`.
   Never overwrite an occupied name. Switching destinations requires explicit
   confirmation before removing the old connection and adding its replacement.
3. Verify the endpoint through native controls, or parse
   `codex mcp get <server-name> --json` locally and emit only its URL/enabled state,
   never raw saved headers or credentials. Authenticate with
   `codex mcp login <server-name>`, or the
   equivalent native app controls. Do not launch a competing pending OAuth flow.
4. Restart/reload Codex's MCP connections. Verify the regional connection with a
   small authenticated read and check the bundled server remains disabled. If
   reload is unavailable, give restart as the next action; do not claim current
   tools already use the new endpoint.

Only one selected Logfire connection should be active. Disabling the bundled
server does not disable this plugin, its skills, or session recording.

## Bundled-server policy helper

After consent, run the bundled helper relative to the installed skill directory:

```text
python3 <skill-directory>/../../scripts/codex_mcp_policy.py disable --plugin-id <installed-plugin-id> --yes
```

Use `enable` instead of `disable` to return to the bundled US server. This helper
uses Codex's native config API to change only
`plugins.<installed-plugin-id>.mcp_servers.logfire.enabled`; it does not edit or
print secret-bearing configuration, install dependencies, or authenticate.
Python 3 and the Codex CLI must be available. If either is unavailable, use native
app settings to toggle only that server; do not install software without asking.

On failure, inspect actual state before retrying. For example, disabling may have
succeeded before a later connection step failed. Do not automatically restore the
US server after an EU setup failure or claim that the switch was rolled back.

## Status and disconnect

Status is read-only: inspect the selected connection, endpoint, authentication,
and bundled-server policy using native controls. Do not run the policy helper,
`mcp add`, or login just to check status.

For an explicit MCP disconnect, use native logout/disable controls on the exact
selected connection. For a regional CLI connection, `codex mcp logout <name>`
clears OAuth; remove its registration only if requested. Keep the bundled server
disabled after regional disconnect, rather than silently reverting to US. Session
recording and remote token revocation remain separate actions.
