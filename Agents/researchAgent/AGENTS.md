## Temporal Agent Skills

This project uses Temporal (`@temporalio/*`) for durable deep-research background execution.
Workflows are defined in `src/temporal/workflows.ts`, activities in `src/temporal/activities.ts`, and the worker in `src/temporal/worker.ts`.
Direct chit-chat responses bypass Temporal workers and are handled instantly via Groq in `src/index.ts`.
