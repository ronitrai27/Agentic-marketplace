import { randomUUID } from "node:crypto";
import { SecurityManager, SecurityVerificationError } from "./security.js";
import { SSEWriter, NoopStream } from "./sse.js";
import { toJsonSchema, validateSchemaData, type SchemaLike } from "./schema.js";
import { buildExecutionContext } from "./context.js";
import { TelemetryReporter } from "./telemetry.js";
import {
  pipeAiSdkStream,
  pipeOpenAiStream,
  pipeLangGraphStream,
  pipeAsyncIterableStream,
} from "./adapters.js";
import {
  PROTOCOL_VERSION,
  NEED_INPUT_SYMBOL,
  type AgentCapabilities,
  type AgentExecutionContext,
  type AgentExecutionResult,
  type AgentManifest,
  type ExecuteRequest,
  type ExecuteResponse,
  type ExecutionMode,
  type HealthCheckResponse,
  type NeedInputResult,
  type StructuredError,
  type TelemetryData,
} from "./types.js";
import { startAgentServer, type ServerOptions } from "./server.js";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

// ─────────────────────────────────────────────────
//  CatelogAgent Config
// ─────────────────────────────────────────────────

export interface CatelogAgentConfig<TInput = any, TOutput = any> {
  /** Unique slug ID (auto-generated from name if omitted) */
  id?: string;
  /** Human-readable agent name */
  name: string;
  /** Semantic version (default: "1.0.0") */
  version?: string;
  /** Short description for marketplace listing */
  description?: string;
  /**
   * Secret key for HMAC / Bearer auth.
   * Auto-reads CATELOG_SECRET_KEY from env if omitted.
   */
  secretKey?: string;
  /**
   * Publishable key for public endpoints.
   * Auto-reads CATELOG_PUBLIC_KEY from env if omitted.
   */
  publicKey?: string;
  /**
   * Execution mode:
   * - "sync" (default): Direct HTTP/SSE stream, resolves in same connection.
   * - "async": Returns 202 immediately, polled via GET /tasks/:id.
   * - "conversational": Supports ctx.needInput() for HITL multi-turn.
   */
  mode?: ExecutionMode;
  /** Partial capabilities overrides */
  capabilities?: Partial<AgentCapabilities>;
  /**
   * Input schema (Zod or JSON Schema). OPTIONAL — if omitted, accepts any JSON.
   */
  inputSchema?: SchemaLike;
  /**
   * Output schema (Zod or JSON Schema). OPTIONAL — if omitted, no output validation.
   */
  outputSchema?: SchemaLike;
  /**
   * The core execution function. This is the ONLY thing the developer MUST provide.
   *
   * - Return a value → task completes automatically
   * - Throw an error → task fails automatically
   * - Use ctx.needInput() → task suspends for human input
   * - Use stream.delta() / stream.progress() → real-time events to marketplace
   */
  execute: (ctx: AgentExecutionContext<TInput>) => Promise<AgentExecutionResult<TOutput> | NeedInputResult | TOutput>;
  /** Optional telemetry reporting config */
  telemetry?: {
    endpoint?: string;
    disabled?: boolean;
  };
}

// ─────────────────────────────────────────────────
//  Async Job Store (for mode: "async")
// ─────────────────────────────────────────────────

interface AsyncJob<TOutput = any> {
  runId: string;
  status: "working" | "completed" | "failed";
  output?: TOutput;
  error?: StructuredError;
  telemetry?: TelemetryData;
  durationMs?: number;
  createdAt: number;
}

const asyncJobs = new Map<string, AsyncJob>();

// Clean up old jobs periodically (keep for 1 hour)
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of asyncJobs) {
    if (job.createdAt < cutoff) asyncJobs.delete(id);
  }
}, 300_000).unref();

// ─────────────────────────────────────────────────
//  CatelogAgent Class
// ─────────────────────────────────────────────────

export class CatelogAgent<TInput = any, TOutput = any> {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public readonly description: string;
  public readonly mode: ExecutionMode;
  public readonly capabilities: AgentCapabilities;
  public readonly security: SecurityManager;
  private readonly config: CatelogAgentConfig<TInput, TOutput>;
  private readonly startTime: number;
  private readonly telemetryReporter: TelemetryReporter;

  constructor(config: CatelogAgentConfig<TInput, TOutput>) {
    this.config = config;
    this.name = config.name;
    this.id = config.id || slugify(config.name);
    this.version = config.version || "1.0.0";
    this.description = config.description || `Agent: ${this.name}`;
    this.mode = config.mode || "sync";
    this.capabilities = {
      streaming: true,
      delta_stream: true,
      max_timeout_seconds: 300,
      execution_modes: [this.mode],
      ...config.capabilities,
    };
    this.security = new SecurityManager({
      secret: config.secretKey,
      publicKey: config.publicKey,
    });
    this.startTime = Date.now();
    this.telemetryReporter = new TelemetryReporter(config.telemetry);
  }

  // ─────────────────────────────────────────────
  //  GET /health — Ping probe for registration
  // ─────────────────────────────────────────────

  /**
   * Generates the health check payload for `GET /health`.
   * Used by the marketplace engine to verify agent liveness, check protocol compatibility,
   * and introspect supported capabilities before routing calls.
   */
  public getHealth(): HealthCheckResponse {
    return {
      status: "ready",
      protocol_version: PROTOCOL_VERSION,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      environment_ready: true,
      capabilities: this.capabilities,
    };
  }

  // ─────────────────────────────────────────────
  //  GET /schema — Agent Manifest
  // ─────────────────────────────────────────────

  /**
   * Generates the agent manifest payload for `GET /schema`.
   * Converts Zod or JSON Schema schemas into the standard MAPS agent manifest
   * containing identification, capabilities, and input/output contracts.
   */
  public getManifest(): AgentManifest {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      protocol_version: PROTOCOL_VERSION,
      capabilities: this.capabilities,
      input_schema: this.config.inputSchema
        ? toJsonSchema(this.config.inputSchema, "InputSchema")
        : { type: "object", additionalProperties: true },
      output_schema: this.config.outputSchema
        ? toJsonSchema(this.config.outputSchema, "OutputSchema")
        : { type: "object", additionalProperties: true },
    };
  }

  // ─────────────────────────────────────────────
  //  .listen(port) — Start the agent server
  // ─────────────────────────────────────────────

  /**
   * Starts a standalone Node HTTP server running the Catelog MAPS protocol endpoints:
   * - `GET  /health` - Liveness probe & capabilities
   * - `GET  /schema` - Manifest & input/output schemas
   * - `POST /execute` - Synchronous or SSE streaming execution
   * - `GET  /tasks/:id` - Async polling status
   *
   * @param portOrOptions Port number (e.g., 3000) or server options object
   * @returns Running Node.js `http.Server` instance
   *
   * @example
   * ```ts
   * agent.listen(3000);
   * ```
   */
  public listen(portOrOptions?: number | ServerOptions): Server {
    const opts = typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;
    return startAgentServer(this, opts);
  }

  /**
   * Alias for `.listen(port)`. Starts the agent HTTP server.
   *
   * @param portOrOptions Port number or server options
   */
  public serve(portOrOptions?: number | ServerOptions): Server {
    return this.listen(portOrOptions);
  }

  // ─────────────────────────────────────────────
  //  Request Router
  // ─────────────────────────────────────────────

  /**
   * Custom request router for mounting Catelog inside an existing server
   * (e.g. Express, Fastify, Next.js API routes, or native `http.createServer`).
   *
   * @param req Incoming Node.js HTTP request
   * @param res Outgoing Node.js HTTP response
   *
   * @example
   * ```ts
   * const server = http.createServer((req, res) => {
   *   if (req.url.startsWith("/marketplace")) {
   *     agent.handleRequest(req, res);
   *   }
   * });
   * ```
   */
  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, " +
      "X-Marketplace-Protocol, X-Marketplace-Timestamp, X-Marketplace-Nonce, " +
      "X-Marketplace-Run-Id, X-Marketplace-Signature"
    );

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Health probe
      if (pathname === "/health" && method === "GET") {
        this.writeJson(res, 200, this.getHealth());
        return;
      }

      // Schema manifest
      if (pathname === "/schema" && method === "GET") {
        this.writeJson(res, 200, this.getManifest());
        return;
      }

      // Execute
      if (pathname === "/execute" && method === "POST") {
        await this.handleExecute(req, res);
        return;
      }

      // Async job polling: GET /tasks/:id
      if (pathname.startsWith("/tasks/") && method === "GET") {
        const jobId = pathname.slice(7); // Remove "/tasks/"
        this.handleTaskPoll(res, jobId);
        return;
      }

      this.writeJson(res, 404, {
        error: { code: "NOT_FOUND", message: `${method} ${pathname} not found`, retryable: false },
      });
    } catch (err) {
      const error = normalizeError(err);
      this.writeJson(res, 500, { error });
    }
  }

  // ─────────────────────────────────────────────
  //  POST /execute — Core Execution Handler
  // ─────────────────────────────────────────────

  private async handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const path = req.url || "/execute";
    const method = req.method || "POST";

    // ── Authentication (Dual-Mode: Bearer / HMAC / Dev) ──
    let authInfo: { runId: string; nonce: string; timestamp: number; authMode: string };
    try {
      authInfo = this.security.authenticateRequest({ method, path, headers, rawBody });
    } catch (err) {
      if (err instanceof SecurityVerificationError) {
        this.writeJson(res, err.statusCode, {
          error: { code: err.code, message: err.message, retryable: false },
        });
        return;
      }
      throw err;
    }

    // ── Parse body ──
    let payload: ExecuteRequest<TInput>;
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : { input: {} };
    } catch {
      this.writeJson(res, 400, {
        error: { code: "INVALID_INPUT", message: "Malformed JSON body", retryable: false },
      });
      return;
    }

    const runId = payload.run_id || authInfo.runId;
    const inputBytes = rawBody.length;

    // ── Optional input validation (only if schema provided) ──
    let validatedInput: TInput;
    if (this.config.inputSchema) {
      const validation = validateSchemaData<TInput>(this.config.inputSchema, payload.input);
      if (!validation.success) {
        this.writeJson(res, 400, {
          run_id: runId,
          status: "failed",
          duration_ms: 0,
          error: {
            code: "INVALID_INPUT",
            message: `Validation failed: ${validation.errors.join("; ")}`,
            retryable: false,
            details: { validationErrors: validation.errors },
          },
        });
        return;
      }
      validatedInput = validation.data;
    } else {
      // No schema — accept any input
      validatedInput = (payload.input ?? {}) as TInput;
    }

    this.security.markRunStarted(runId);

    // ── Execution Mode Dispatch ──
    if (this.mode === "async") {
      await this.executeAsync(runId, validatedInput, payload, inputBytes, res);
    } else {
      // sync & conversational both stream via SSE or batch JSON
      await this.executeSyncOrConversational(runId, validatedInput, payload, inputBytes, req, res);
    }
  }

  // ── Async Mode: Return 202 immediately, run in background ──

  private async executeAsync(
    runId: string,
    input: TInput,
    payload: ExecuteRequest<TInput>,
    inputBytes: number,
    res: ServerResponse,
  ): Promise<void> {
    const job: AsyncJob = {
      runId,
      status: "working",
      createdAt: Date.now(),
    };
    asyncJobs.set(runId, job);

    // Respond immediately with 202
    this.writeJson(res, 202, {
      run_id: runId,
      status: "working",
      poll_url: `/tasks/${runId}`,
    });

    // Execute in background (fire-and-forget from HTTP perspective)
    const startTs = Date.now();
    const noopStream = new NoopStream();
    const abortController = new AbortController();

    try {
      const { ctx, telemetryCollector } = buildExecutionContext({
        runId,
        input,
        stream: noopStream,
        signal: abortController.signal,
        metadata: payload.metadata,
        deadlineMs: payload.deadline_ms,
        resumeToken: payload.resume_token,
        inputBytes,
      });

      const rawResult = await this.config.execute(ctx);
      const durationMs = Date.now() - startTs;
      const result = this.normalizeExecuteResult<TOutput>(rawResult);

      job.status = "completed";
      job.output = result.output;
      job.durationMs = durationMs;
      job.telemetry = telemetryCollector.finalize(result.telemetry);
    } catch (err) {
      job.status = "failed";
      job.error = normalizeError(err);
      job.durationMs = Date.now() - startTs;
    } finally {
      this.security.markRunCompleted(runId);
    }
  }

  // ── Sync / Conversational Mode ──

  private async executeSyncOrConversational(
    runId: string,
    input: TInput,
    payload: ExecuteRequest<TInput>,
    inputBytes: number,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const startTs = Date.now();
    const acceptsSse = req.headers.accept?.includes("text/event-stream") ?? true;

    // Abort controller for deadline / disconnect
    const abortController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | undefined;
    if (payload.deadline_ms && payload.deadline_ms > Date.now()) {
      const waitTime = payload.deadline_ms - Date.now();
      timeoutTimer = setTimeout(() => {
        abortController.abort(new Error("EXECUTION_TIMEOUT"));
      }, waitTime);
    }

    if (acceptsSse) {
      await this.executeWithSSE(runId, input, payload, inputBytes, startTs, res, abortController, timeoutTimer);
    } else {
      await this.executeWithJSON(runId, input, payload, inputBytes, startTs, res, abortController, timeoutTimer);
    }
  }

  // ── SSE Streaming Execution ──

  private async executeWithSSE(
    runId: string, input: TInput, payload: ExecuteRequest<TInput>,
    inputBytes: number, startTs: number,
    res: ServerResponse, abortController: AbortController, timeoutTimer?: NodeJS.Timeout,
  ): Promise<void> {
    const sseWriter = new SSEWriter(runId, res, {
      onClientDisconnect: () => abortController.abort(new Error("CLIENT_DISCONNECTED")),
    });

    sseWriter.signal.addEventListener("abort", () => {
      abortController.abort(sseWriter.signal.reason);
    });

    // Emit initial working status
    sseWriter.sendTaskStatus("working");

    const { ctx, telemetryCollector } = buildExecutionContext({
      runId,
      input,
      stream: sseWriter,
      signal: abortController.signal,
      metadata: payload.metadata,
      deadlineMs: payload.deadline_ms,
      resumeToken: payload.resume_token,
      inputBytes,
    });

    try {
      const rawResult = await this.config.execute(ctx);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTs;

      // Check if result is a needInput request
      if (this.isNeedInputResult(rawResult)) {
        const needInput = rawResult as NeedInputResult;
        const resumeToken = `resume_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        sseWriter.sendTaskInputRequired(needInput.prompt, resumeToken, needInput.schema);
        this.reportTelemetry(runId, "input-required", telemetryCollector.finalize(), durationMs);
        this.security.markRunCompleted(runId);
        return;
      }

      const result = this.normalizeExecuteResult<TOutput>(rawResult);
      const outputBytes = JSON.stringify(result.output).length;
      const telemetry = telemetryCollector.finalize({
        ...result.telemetry,
        duration_ms: durationMs,
        output_bytes: outputBytes,
        chunks_streamed: sseWriter.chunksStreamed,
      });

      res.setHeader("X-Catelog-Duration-Ms", String(durationMs));
      sseWriter.sendTaskCompleted(result.output, durationMs, telemetry);
      this.reportTelemetry(runId, "completed", telemetry, durationMs);
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTs;

      if (abortController.signal.aborted) {
        sseWriter.sendTaskCanceled(durationMs);
        this.reportTelemetry(runId, "canceled", telemetryCollector.finalize({ duration_ms: durationMs }), durationMs);
      } else {
        const error = normalizeError(err);
        sseWriter.sendTaskFailed(error, durationMs);
        this.reportTelemetry(runId, "failed", telemetryCollector.finalize({ duration_ms: durationMs }), durationMs);
      }
    } finally {
      this.security.markRunCompleted(runId);
    }
  }

  // ── Batch JSON Execution ──

  private async executeWithJSON(
    runId: string, input: TInput, payload: ExecuteRequest<TInput>,
    inputBytes: number, startTs: number,
    res: ServerResponse, abortController: AbortController, timeoutTimer?: NodeJS.Timeout,
  ): Promise<void> {
    const noopStream = new NoopStream();

    const { ctx, telemetryCollector } = buildExecutionContext({
      runId,
      input,
      stream: noopStream,
      signal: abortController.signal,
      metadata: payload.metadata,
      deadlineMs: payload.deadline_ms,
      resumeToken: payload.resume_token,
      inputBytes,
    });

    try {
      const rawResult = await this.config.execute(ctx);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTs;

      // Check needInput
      if (this.isNeedInputResult(rawResult)) {
        const needInput = rawResult as NeedInputResult;
        const resumeToken = `resume_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        this.security.markRunCompleted(runId);
        this.writeJson(res, 200, {
          run_id: runId,
          status: "input-required",
          duration_ms: durationMs,
          prompt: needInput.prompt,
          input_schema: needInput.schema,
          resume_token: resumeToken,
        });
        return;
      }

      const result = this.normalizeExecuteResult<TOutput>(rawResult);
      const outputBytes = JSON.stringify(result.output).length;
      const telemetry = telemetryCollector.finalize({
        ...result.telemetry,
        duration_ms: durationMs,
        output_bytes: outputBytes,
        chunks_streamed: noopStream.chunksStreamed,
      });

      this.security.markRunCompleted(runId);
      res.setHeader("X-Catelog-Duration-Ms", String(durationMs));
      const response: ExecuteResponse<TOutput> = {
        run_id: runId,
        status: "completed",
        duration_ms: durationMs,
        output: result.output,
        telemetry,
      };
      this.writeJson(res, 200, response);
      this.reportTelemetry(runId, "completed", telemetry, durationMs);
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTs;
      this.security.markRunCompleted(runId);

      const error = normalizeError(err);
      const response: ExecuteResponse<TOutput> = {
        run_id: runId,
        status: abortController.signal.aborted ? "canceled" : "failed",
        duration_ms: durationMs,
        error,
      };
      this.writeJson(res, 200, response);
    }
  }

  // ── Async Job Polling ──

  private handleTaskPoll(res: ServerResponse, jobId: string): void {
    const job = asyncJobs.get(jobId);
    if (!job) {
      this.writeJson(res, 404, {
        error: { code: "NOT_FOUND", message: `No task found: ${jobId}`, retryable: false },
      });
      return;
    }

    if (job.status === "working") {
      this.writeJson(res, 200, {
        run_id: job.runId,
        status: "working",
        elapsed_ms: Date.now() - job.createdAt,
      });
    } else if (job.status === "completed") {
      this.writeJson(res, 200, {
        run_id: job.runId,
        status: "completed",
        duration_ms: job.durationMs,
        output: job.output,
        telemetry: job.telemetry,
      });
    } else {
      this.writeJson(res, 200, {
        run_id: job.runId,
        status: "failed",
        duration_ms: job.durationMs,
        error: job.error,
      });
    }
  }

  // ── Helpers ──

  /**
   * Normalize the developer's return value into our standard result shape.
   * Supports:
   * - { output: T, telemetry?: ... } → standard result
   * - Any other value → treated as the output directly
   */
  private normalizeExecuteResult<T>(raw: any): AgentExecutionResult<T> {
    if (raw && typeof raw === "object" && "output" in raw) {
      return raw as AgentExecutionResult<T>;
    }
    // The developer just returned a plain object — that IS the output
    return { output: raw as T };
  }

  private isNeedInputResult(value: any): value is NeedInputResult {
    return value && typeof value === "object" && value[Symbol.for("catelog.needInput")] === true;
  }

  private reportTelemetry(runId: string, status: string, telemetry: TelemetryData, durationMs: number): void {
    this.telemetryReporter.report({
      agentId: this.id,
      runId,
      status,
      telemetry: { ...telemetry, duration_ms: durationMs },
      timestamp: Date.now(),
    });
  }

  private writeJson(res: ServerResponse, status: number, data: unknown): void {
    if (res.writableEnded) return;
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}

// ─────────────────────────────────────────────────
//  Factory Function
// ─────────────────────────────────────────────────

/**
 * Creates and configures a new `CatelogAgent` instance conforming to the
 * Marketplace Agent Protocol Specification (MAPS).
 *
 * Developers define the agent metadata, schemas, and a single `execute` function.
 * The SDK automatically provides:
 * - Built-in HTTP router (`/health`, `/schema`, `/execute`, `/tasks/:id`)
 * - Dual-mode security (Bearer API key + HMAC-SHA256 signatures)
 * - Real-time SSE streaming (`task.progress`, `task.delta`, `task.activity`)
 * - Schema validation via Zod or JSON Schema
 * - Execution telemetry and duration metrics
 *
 * @param config Configuration options including `name`, `execute`, schemas, and security keys
 * @returns Configured `CatelogAgent` instance ready for `.listen()` or `.handleRequest()`
 *
 * @example
 * ```ts
 * import { createAgent } from "catelog";
 * import { z } from "zod";
 *
 * const agent = createAgent({
 *   name: "Summarizer Agent",
 *   description: "Summarizes text documents",
 *   inputSchema: z.object({ text: z.string().min(1) }),
 *   outputSchema: z.object({ summary: z.string() }),
 *   async execute({ input, stream, log }) {
 *     stream.step("Analyzing input...");
 *     stream.progress(50, "Generating summary...");
 *     return {
 *       output: { summary: "..." }
 *     };
 *   }
 * });
 *
 * agent.listen(4000);
 * ```
 */
export function createAgent<TInput = any, TOutput = any>(
  config: CatelogAgentConfig<TInput, TOutput>
): CatelogAgent<TInput, TOutput> {
  return new CatelogAgent(config);
}

/**
 * Legacy alias for `createAgent`.
 * Creates and configures a new `CatelogAgent` instance for the Marketplace.
 *
 * @param config Configuration options for the agent
 */
export function createMarketplaceAgent<TInput = any, TOutput = any>(
  config: CatelogAgentConfig<TInput, TOutput>
): CatelogAgent<TInput, TOutput> {
  return new CatelogAgent(config);
}

// Backward compat alias
export { CatelogAgent as MarketplaceAgent };
export type { CatelogAgentConfig as MarketplaceAgentConfig };

// ─────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeError(err: unknown, defaultCode = "INTERNAL_CRASH"): StructuredError {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message === "EXECUTION_TIMEOUT") {
      return { code: "EXECUTION_TIMEOUT", message: "Exceeded deadline or timeout", retryable: true };
    }
    if (err.message === "CLIENT_DISCONNECTED") {
      return { code: "TASK_CANCELED", message: "Client disconnected", retryable: false };
    }

    const code = (err as any).code || defaultCode;
    const retryable = (err as any).retryable ?? false;
    return { code, message: err.message, retryable };
  }

  return { code: defaultCode, message: String(err), retryable: false };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
