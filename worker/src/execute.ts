import { Context } from "@temporalio/activity";
import { getRunContext, rememberSigningKey, reportComplete, reportEvents, reportStatus, type RunContext } from "./convex";
import { checkAgainstSchema } from "./schema";
import { openSealedSecret, signRequest } from "./signing";
import { readSse } from "./sse";
import { assertPublicUrl } from "./ssrf";

const HEALTH_EVERY_MS = 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
/** Strikes in a row, with the stream also silent for this long, before the agent is treated as gone. */
const HEALTH_STRIKES = 3;
const SILENCE_LIMIT_MS = 90_000;
const POLL_EVERY_MS = 3_000;

type Outcome = { kind: "completed"; output: unknown } | { kind: "failed"; code: string; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Batches events to Convex in order. Consecutive text deltas are merged so a token stream is one row, not hundreds. */
class EventFeed {
  private queue: Array<{ type: string; data: unknown }> = [];
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout;

  constructor(private readonly runId: string) {
    this.timer = setInterval(() => void this.flush(), 750);
  }

  push(type: string, data: unknown) {
    const last = this.queue[this.queue.length - 1];
    if (
      type === "task.delta" && last?.type === "task.delta" &&
      isRecord(data) && isRecord(last.data) &&
      typeof data.content === "string" && typeof last.data.content === "string"
    ) {
      last.data = { ...last.data, content: last.data.content + data.content };
      return;
    }
    this.queue.push({ type, data });
    if (this.queue.length >= 50) void this.flush();
  }

  flush(): Promise<void> {
    const batch = this.queue.splice(0);
    this.chain = this.chain.then(() => reportEvents(this.runId, batch));
    return this.chain;
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}

async function probe(baseUrl: string): Promise<number | null> {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { status?: string; environment_ready?: boolean } | null;
    return body?.status === "ready" && body.environment_ready !== false ? Date.now() - started : null;
  } catch {
    return null;
  }
}

function failureFrom(json: unknown, status: number): Outcome {
  const error = isRecord(json) && isRecord(json.error) ? json.error : {};
  return {
    kind: "failed",
    code: str(error.code) ?? `AGENT_HTTP_${status}`,
    message: str(error.message) ?? `The agent answered with an error (${status})`,
  };
}

async function readStream(body: ReadableStream<Uint8Array>, feed: EventFeed, onActivity: () => void): Promise<Outcome> {
  let outcome: Outcome | undefined;
  for await (const message of readSse(body)) {
    onActivity();
    if (message.event === "heartbeat") continue;
    feed.push(message.event, message.data);
    const data = isRecord(message.data) ? message.data : {};
    if (message.event === "task.completed") {
      outcome = { kind: "completed", output: data.output };
    } else if (message.event === "task.failed") {
      const error = isRecord(data.error) ? data.error : {};
      outcome = {
        kind: "failed",
        code: str(error.code) ?? "AGENT_ERROR",
        message: str(error.message) ?? "The agent reported an error",
      };
    } else if (message.event === "task.input_required") {
      outcome = {
        kind: "failed",
        code: "INPUT_REQUIRED",
        message: "This agent asked for more input, which marketplace runs don't support yet.",
      };
    }
  }
  return (
    outcome ?? { kind: "failed", code: "STREAM_ENDED", message: "The agent closed the connection before finishing" }
  );
}

/** Async-mode agents answer 202 and are polled at /tasks/:runId. Their step/progress/activity events come back with each poll. */
async function pollTask(baseUrl: string, runId: string, signal: AbortSignal, feed: EventFeed, onActivity: () => void): Promise<Outcome> {
  let lastStatus = "";
  let since = 0;
  while (!signal.aborted) {
    const res = await fetch(`${baseUrl}/tasks/${encodeURIComponent(runId)}?since=${since}`, { redirect: "manual", signal });
    const json = await res.json().catch(() => null);
    onActivity();
    if (isRecord(json)) {
      if (json.status !== lastStatus) {
        lastStatus = String(json.status);
        feed.push("task.status", { status: json.status });
      }
      if (Array.isArray(json.events)) {
        for (const e of json.events) {
          if (!isRecord(e)) continue;
          since = Math.max(since, Number(e.seq) || 0);
          if (e.type === "progress") feed.push("task.progress", { percent: e.percent, message: e.message });
          else if (e.type === "step") feed.push("task.progress", { message: e.message });
          else if (e.type === "activity") feed.push("task.activity", { activity_type: e.name, data: e.data });
          else feed.push(String(e.name ?? "event"), e.data ?? null);
        }
      }
      if (json.status === "completed") return { kind: "completed", output: json.output };
      if (json.status === "failed") return failureFrom(json, res.status);
    } else if (!res.ok) {
      return failureFrom(json, res.status);
    }
    await sleep(POLL_EVERY_MS);
  }
  throw signal.reason ?? new Error("aborted");
}

async function callAgent(
  ctx: RunContext,
  runId: string,
  input: unknown,
  secret: string,
  signal: AbortSignal,
  feed: EventFeed,
  onActivity: () => void,
): Promise<Outcome> {
  const url = new URL(`${ctx.baseUrl}/execute`);
  const body = JSON.stringify({ run_id: runId, input, deadline_ms: Date.now() + ctx.timeoutSeconds * 1000 });
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal,
    body,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...signRequest({ method: "POST", path: url.pathname, body, runId, secret }),
    },
  });
  onActivity();

  if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
    return readStream(res.body, feed, onActivity);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 202) return pollTask(ctx.baseUrl, runId, signal, feed, onActivity);
  if (res.ok && isRecord(json) && json.status === "completed") return { kind: "completed", output: json.output };
  return failureFrom(json, res.status);
}

/** n8n agents: one JSON POST to the webhook with the creator's X-Marketplace-Key. The answer is the JSON it responds with. */
async function callN8n(ctx: RunContext, input: unknown, authKey: string, signal: AbortSignal): Promise<Outcome> {
  const res = await fetch(ctx.baseUrl, {
    method: "POST",
    redirect: "manual",
    signal,
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Marketplace-Key": authKey },
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    return { kind: "failed", code: "AGENT_AUTH_FAILED", message: "n8n did not accept the marketplace key. Nothing was charged." };
  }
  if (!res.ok) return failureFrom(json, res.status);
  if (json === null) return { kind: "failed", code: "BAD_RESPONSE", message: "The workflow did not answer with JSON. Nothing was charged." };
  return { kind: "completed", output: json };
}

/**
 * The activity that actually runs an agent: signs the request, streams its events into Convex, pings /health
 * while it works, and checks the output against the agent's schema. It reports its own terminal state; any
 * failure releases the buyer's hold, and only a clean, schema-valid answer is charged.
 */
export async function executeAgent(runId: string): Promise<void> {
  const feed = new EventFeed(runId);
  const fail = async (code: string, message: string) => {
    feed.push("run.note", { level: "error", message });
    await feed.close();
    await reportStatus(runId, "failed", { code, message });
  };

  try {
    const ctx = await getRunContext(runId);
    if (ctx.status !== "queued" && ctx.status !== "running") return await feed.close();

    if (ctx.platform === "n8n") {
      if (!ctx.authKey) return await fail("NO_AUTH_KEY", "The creator's X-Marketplace-Key is missing or expired. Nothing was charged.");
      try {
        await assertPublicUrl(ctx.baseUrl);
      } catch {
        return await fail("AGENT_UNREACHABLE", "Agent server is not reachable. Nothing was charged.");
      }
      const text = ctx.inputUrl ? await (await fetch(ctx.inputUrl, { signal: AbortSignal.timeout(60_000) })).text() : ctx.inputJson;
      const n8nInput: unknown = JSON.parse(text);
      const badInput = checkAgainstSchema(ctx.inputSchemaJson, n8nInput);
      if (badInput) return await fail("INVALID_INPUT", `Your input doesn't match what the agent expects: ${badInput}`);

      feed.push("run.note", { message: `Calling ${ctx.agentName}` });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("TIMEOUT")), (ctx.timeoutSeconds + 15) * 1000);
      const heartbeat = setInterval(() => Context.current().heartbeat(), 10_000);
      const onCancel = () => controller.abort(new Error("CANCELLED"));
      Context.current().cancellationSignal.addEventListener("abort", onCancel);
      let result: Outcome;
      try {
        result = await callN8n(ctx, n8nInput, ctx.authKey, controller.signal);
      } catch (err) {
        const reason = (controller.signal.reason as Error | undefined)?.message ?? (err as Error).message;
        if (reason === "CANCELLED") {
          await feed.close();
          await reportStatus(runId, "cancelled");
          return;
        }
        result =
          reason === "TIMEOUT"
            ? { kind: "failed", code: "AGENT_TIMEOUT", message: "The agent ran out of time. Nothing was charged." }
            : { kind: "failed", code: "AGENT_UNREACHABLE", message: "Lost contact with the agent server. Nothing was charged." };
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        Context.current().cancellationSignal.removeEventListener("abort", onCancel);
      }
      if (result.kind === "failed") return await fail(result.code, result.message);
      const badOutput = checkAgainstSchema(ctx.outputSchemaJson, result.output);
      feed.push("schema.check", badOutput ? { valid: false, problem: badOutput } : { valid: true });
      if (badOutput) return await fail("OUTPUT_SCHEMA_VIOLATION", "The agent's answer didn't match its declared output format. Nothing was charged.");
      await feed.close();
      return await reportComplete(runId, result.output);
    }

    if (ctx.signingKeys.length === 0) return await fail("NO_SIGNING_KEY", "This agent is not set up for marketplace runs yet. Nothing was charged.");
    const secrets: Array<{ keyId: string; secret: string }> = [];
    for (const key of ctx.signingKeys) {
      try {
        secrets.push({ keyId: key.keyId, secret: openSealedSecret(key.sealed) });
      } catch (err) {
        console.error("could not open a creator key", err);
      }
    }
    if (secrets.length === 0) return await fail("SIGNING_UNAVAILABLE", "Could not sign the request. Nothing was charged.");
    try {
      await assertPublicUrl(ctx.baseUrl);
    } catch {
      return await fail("AGENT_UNREACHABLE", "Agent server is not reachable. Nothing was charged.");
    }

    const inputText = ctx.inputUrl ? await (await fetch(ctx.inputUrl, { signal: AbortSignal.timeout(60_000) })).text() : ctx.inputJson;
    const input: unknown = JSON.parse(inputText);
    const inputProblem = checkAgainstSchema(ctx.inputSchemaJson, input);
    if (inputProblem) return await fail("INVALID_INPUT", `Your input doesn't match what the agent expects: ${inputProblem}`);

    feed.push("run.note", { message: `Calling ${ctx.agentName}` });

    const controller = new AbortController();
    let lastActivity = Date.now();
    let strikes = 0;
    const onActivity = () => (lastActivity = Date.now());

    const deadline = setTimeout(() => controller.abort(new Error("TIMEOUT")), (ctx.timeoutSeconds + 15) * 1000);
    const heartbeat = setInterval(() => Context.current().heartbeat(), 10_000);
    const health = setInterval(async () => {
      const latencyMs = await probe(ctx.baseUrl);
      feed.push("health", { ok: latencyMs !== null, latencyMs });
      strikes = latencyMs === null ? strikes + 1 : 0;
      if (strikes >= HEALTH_STRIKES && Date.now() - lastActivity > SILENCE_LIMIT_MS) {
        controller.abort(new Error("UNREACHABLE"));
      }
    }, HEALTH_EVERY_MS);
    const onCancel = () => controller.abort(new Error("CANCELLED"));
    Context.current().cancellationSignal.addEventListener("abort", onCancel);

    let outcome: Outcome;
    try {
      // The agent verifies against one of the creator's keys. A request it rejects for its signature is not
      // counted as a run on its side, so trying the next key is safe. The key that works is remembered.
      outcome = { kind: "failed", code: "AGENT_AUTH_FAILED", message: "" };
      for (const { keyId, secret } of secrets) {
        outcome = await callAgent(ctx, runId, input, secret, controller.signal, feed, onActivity);
        const rejected = outcome.kind === "failed" && /^AUTH_/.test(outcome.code);
        if (!rejected) {
          if (keyId !== ctx.signingKeys[0].keyId) void rememberSigningKey(runId, keyId);
          break;
        }
      }
      if (outcome.kind === "failed" && /^AUTH_/.test(outcome.code)) {
        outcome = {
          kind: "failed",
          code: "AGENT_AUTH_FAILED",
          message: "The agent did not accept the marketplace's signature. Its secret key must be one of the creator's keys. Nothing was charged.",
        };
      }
    } catch (err) {
      const reason = (controller.signal.reason as Error | undefined)?.message ?? (err as Error).message;
      if (reason === "CANCELLED") {
        await feed.close();
        await reportStatus(runId, "cancelled");
        return;
      }
      outcome =
        reason === "TIMEOUT"
          ? { kind: "failed", code: "AGENT_TIMEOUT", message: "The agent ran out of time. Nothing was charged." }
          : { kind: "failed", code: "AGENT_UNREACHABLE", message: "Lost contact with the agent server. Nothing was charged." };
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      clearInterval(health);
      Context.current().cancellationSignal.removeEventListener("abort", onCancel);
    }

    if (outcome.kind === "failed") return await fail(outcome.code, outcome.message);

    const problem = checkAgainstSchema(ctx.outputSchemaJson, outcome.output);
    feed.push("schema.check", problem ? { valid: false, problem } : { valid: true });
    if (problem) {
      return await fail("OUTPUT_SCHEMA_VIOLATION", "The agent's answer didn't match its declared output format. Nothing was charged.");
    }

    await feed.close();
    await reportComplete(runId, outcome.output);
  } catch (err) {
    console.error("executeAgent failed", runId, err);
    await fail("INTERNAL_ERROR", "Something went wrong on our side. Nothing was charged.");
  }
}
