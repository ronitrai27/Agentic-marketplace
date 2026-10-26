import { isAuthenticated } from "@/lib/auth-server";
import { resolveAgentRoot } from "@/lib/agent-url";

export const maxDuration = 300;

const MAX_RUN_MS = 120_000;
const POLL_MS = 1000;

type Out =
  | { kind: "progress"; label: string; percent?: number; ts: number }
  | { kind: "step" | "activity" | "event" | "delta" | "info"; label: string; data?: unknown; ts: number }
  | { kind: "completed"; output: unknown; telemetry?: unknown; durationMs?: number; ts: number }
  | { kind: "failed"; error: { code?: string; message: string }; ts: number };

function errorOf(e: unknown): { code?: string; message: string } {
  if (e && typeof e === "object") {
    const o = e as { code?: string; message?: string };
    return { code: o.code, message: o.message ?? "Run failed." };
  }
  return { message: typeof e === "string" ? e : "Run failed." };
}

/** Maps one SDK SSE event to the client's normalized event shape. */
function fromSse(name: string, d: Record<string, any>): Out | null {
  const ts = Date.now();
  switch (name) {
    case "task.progress":
      return { kind: "progress", label: d.message ?? "Progress", percent: d.percent, ts };
    case "task.delta":
      return { kind: "delta", label: String(d.content ?? ""), ts };
    case "task.activity":
      return { kind: "activity", label: d.activity_type ?? "activity", data: d.data, ts };
    case "task.completed":
      return { kind: "completed", output: d.output, telemetry: d.telemetry, durationMs: d.duration_ms, ts };
    case "task.failed":
      return { kind: "failed", error: errorOf(d.error), ts };
    case "task.input_required":
      return {
        kind: "failed",
        error: { code: "INPUT_REQUIRED", message: d.prompt ?? "Agent asked for more input." },
        ts,
      };
    case "task.status":
    case "heartbeat":
      return null;
    default:
      return { kind: "event", label: name, data: d, ts };
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    url?: string;
    input?: unknown;
    token?: string;
  } | null;

  const target = await resolveAgentRoot(body?.url);
  if (!target.ok) {
    return Response.json({ error: target.error }, { status: target.status });
  }
  const root = target.root;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: Out) =>
        controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      const deadline = AbortSignal.timeout(MAX_RUN_MS);

      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
        "x-catelog-dry-run": "1",
      };
      if (body?.token) headers.authorization = `Bearer ${body.token}`;

      try {
        const res = await fetch(`${root}/execute`, {
          method: "POST",
          headers,
          body: JSON.stringify({ input: body?.input ?? {} }),
          redirect: "error",
          signal: deadline,
        });

        const ctype = res.headers.get("content-type") ?? "";

        if (ctype.includes("text/event-stream") && res.body) {
          // Sync / conversational agent: relay the live SSE stream.
          send({ kind: "info", label: "Streaming connection opened", ts: Date.now() });
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let name = "message";
              let data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event:")) name = line.slice(6).trim();
                else if (line.startsWith("data:")) data += line.slice(5).trim();
              }
              if (!data) continue;
              let parsed: Record<string, any> = {};
              try {
                parsed = JSON.parse(data);
              } catch {
                parsed = { raw: data };
              }
              const out = fromSse(name, parsed);
              if (out) send(out);
            }
          }
          return;
        }

        const json = (await res.json().catch(() => null)) as Record<string, any> | null;

        if (!res.ok || json?.error) {
          send({ kind: "failed", error: errorOf(json?.error ?? { message: `HTTP ${res.status}` }), ts: Date.now() });
          return;
        }

        if (res.status === 202 && json?.poll_url) {
          // Async agent: poll the task endpoint and surface new events.
          send({ kind: "info", label: "Async task accepted. Polling for updates", ts: Date.now() });
          let since = 0;
          for (;;) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            deadline.throwIfAborted();
            const pr = await fetch(`${root}${json.poll_url}?since=${since}`, {
              headers: { accept: "application/json", ...(headers.authorization ? { authorization: headers.authorization } : {}) },
              redirect: "error",
              signal: deadline,
            });
            const poll = (await pr.json()) as Record<string, any>;
            for (const e of (poll.events ?? []) as Array<Record<string, any>>) {
              since = Math.max(since, e.seq ?? 0);
              const ts = e.timestamp ?? Date.now();
              if (e.type === "progress") send({ kind: "progress", label: e.message ?? "Progress", percent: e.percent, ts });
              else if (e.type === "step") send({ kind: "step", label: e.message ?? "Step", ts });
              else if (e.type === "activity") send({ kind: "activity", label: e.name ?? "activity", data: e.data, ts });
              else send({ kind: "event", label: e.name ?? e.type ?? "event", data: e.data, ts });
            }
            if (poll.status === "completed") {
              send({ kind: "completed", output: poll.output, telemetry: poll.telemetry, durationMs: poll.duration_ms, ts: Date.now() });
              return;
            }
            if (poll.status === "failed") {
              send({ kind: "failed", error: errorOf(poll.error), ts: Date.now() });
              return;
            }
          }
        }

        // Plain JSON batch response.
        if (json?.status === "completed") {
          send({ kind: "completed", output: json.output, telemetry: json.telemetry, durationMs: json.duration_ms, ts: Date.now() });
        } else {
          send({ kind: "failed", error: errorOf(json?.error ?? { message: `Unexpected status: ${json?.status ?? "unknown"}` }), ts: Date.now() });
        }
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        send({
          kind: "failed",
          error: {
            code: timedOut ? "TIMEOUT" : "UNREACHABLE",
            message: timedOut
              ? "Dry run stopped after 2 minutes."
              : e instanceof Error
                ? e.message
                : "Could not reach the server.",
          },
          ts: Date.now(),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
