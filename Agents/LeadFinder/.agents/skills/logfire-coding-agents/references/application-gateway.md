# Create an Application Gateway Key with the CLI

Use this procedure only when the application needs a new Gateway key and the
user chose CLI-based setup. Existing Gateway keys and the UI's Connect flow do
not require initializing an SDK credential.

Reuse the exact executable, target, organization, project, and data directory
from a prepared handoff. Otherwise follow [CLI connection](./connection.md)
first. Key creation resolves the project from its local SDK credential file;
account-only access is insufficient. Reuse a matching file or initialize the
confirmed project as described there. Do not repeat token creation after an
authentication/network error.

Create a separate project-scoped key, replacing the synthetic region,
organization, and data directory with the confirmed values:

```bash
logfire-cli --region us --org acme --no-input api-key gateway --name app-gateway --data-dir /absolute/project-data
```

For self-hosted instances, replace `--region us` with `--base-url` and the
confirmed base URL as its argument.
Preserve the same target and organization on every operation.

This command prints a one-time secret. Execute it through a process API that
captures stdout in memory and accepts it only after exit zero, never bare in a
recorded terminal. Pass it directly to the application's existing secret
mechanism without displaying it. A failure after creation may still have
created the key; do not automatically retry or mint another.

Creating a key does not activate provider billing or configure a model route.
Continue with the [application Gateway skill](../../logfire-gateway/SKILL.md)
for client integration, secret storage, and request verification.
