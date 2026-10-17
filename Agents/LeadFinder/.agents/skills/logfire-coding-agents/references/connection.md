# Connect the Native CLI

Use this reference when a plugin or standalone skill was invoked without a
prepared CLI handoff. A CLI-launched skill already has its executable and
destination: preserve those and do not repeat setup.

## Choose the executable

Prefer an explicit executable from `LOGFIRE_SETUP_CLI` or the user's handoff.
Otherwise locate a trusted installed `logfire-cli` and inspect its version:

```bash
logfire-cli --output json version
```

Native npm installations and Python `logfire` version 6 or later can instead
provide `logfire`. Accept that trusted installed executable only when its
`--output json version` response has envelope version 1 and native CLI
`data.installed` metadata. A legacy SDK command is not interchangeable.
Require native CLI version 0.1.14 or later for coding-agent capture and Gateway
setup. Do not execute an untrusted repository-local binary. If unavailable,
offer installation rather than silently adding dependencies to the application.
For a settings helper that will run in future sessions, use a persistent install
(such as `uv tool install logfire-cli`), not a temporary package-runner cache path.
Use the resolved absolute executable for subsequent commands.

## Confirm account and project

Confirm the region/origin, organization, and project before sending credentials
or making changes. Cloud uses `--region us` or `--region eu`; a self-hosted
instance requires its confirmed `--base-url`. Preserve that selection on every
command. Replace the synthetic names in these examples.
When selecting a cloud region, omit `LOGFIRE_BASE_URL` from CLI child processes
so an ambient base URL cannot override the confirmed destination.

```bash
logfire-cli --region us --org acme --no-input --output json auth status
logfire-cli --region us --org acme --no-input --output json mcp context
```

`auth status` reports local profile metadata; `mcp context` checks live identity.
If login is required, explain the browser approval and run `auth` against the
same target and organization. Do not request account keys in chat, read the OS
credential store directly, or silently switch to another account on failure.
For browser OAuth, omit ambient `LOGFIRE_API_KEY`, `LOGFIRE_TOKEN`, and
`LOGFIRE_MCP_TOKEN` from CLI child processes without printing their values or
changing the parent environment. Preserve explicitly requested headless access.

For session recording or creating a Gateway key, inspect `project current` with the chosen `--data-dir`
and reuse a verified matching SDK credential. Only if missing, create one with
the following command, replacing the region, organization, project name, and
data directory with the confirmed destination:

```bash
logfire-cli --region us --org acme --no-input --output json init use --name my-app --permission send --data-dir /absolute/project-data
```

For self-hosted instances, replace `--region us` with the confirmed `--base-url`.
That creates a write token: do not repeat it after a network/authentication error
or create another token on each reconnect. Keep helper credentials outside the
plugin cache and separate from an unrelated application's `.logfire` directory.

Frontend setup does not require an ordinary SDK write token. Gateway key
creation currently resolves the project from its SDK credential file, so
account-only access is insufficient for that CLI workflow. An existing
application Gateway key does not require this initialization.

## MCP remains independent

The agent's native MCP connection has its own OAuth session; CLI authentication
does not authenticate it. Existing native MCP can verify delivery without a
second CLI login. Use the plugin's `/logfire:connect` when available for Claude
session setup, and do not configure a second exporter or duplicate MCP server.
Do not install or authenticate the CLI merely to query data through working MCP.
