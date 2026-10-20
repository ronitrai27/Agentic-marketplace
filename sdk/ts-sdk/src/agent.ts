import { SecurityManager } from "./security.js";
import { SSEWriter } from "./sse.js";
import { toJsonSchema, validateSchemaData, type SchemaLike } from "./schema.js";
import {
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type AgentExecutionContext,
  type AgentExecutionResult,
  type AgentManifest,
  type ExecuteRequest,
  type ExecuteResponse,
  type HealthCheckResponse,
  type StructuredError,
} from "./types.js";
import { startAgentServer, type ServerOptions } from "./server.js";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

export interface MarketplaceAgentConfig<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> {
  id?: string;
  name: string;
  version?: string;
  description?: string;
  secret?: string;
  capabilities?: Partial<AgentCapabilities>;
  inputSchema: SchemaLike;
  outputSchema: SchemaLike;
  execute: (ctx: AgentExecutionContext<TInput>) => Promise<AgentExecutionResult<TOutput>>;
}

export class MarketplaceAgent<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public readonly description: string;
  public readonly capabilities: AgentCapabilities;
  public readonly security: SecurityManager;
  private readonly config: MarketplaceAgentConfig<TInput, TOutput>;
  private readonly startTime: number;

  constructor(config: MarketplaceAgentConfig<TInput, TOutput>) {
    this.config = config;
    this.name = config.name;
    this.id = config.id || slugify(config.name);
    this.version = config.version || "1.0.0";
    this.description = config.description || `Agent for ${this.name}`;
    this.capabilities = {
      streaming: true,
      delta_stream: false,
      max_timeout_seconds: 300,
      ...config.capabilities,
    };
    this.security = new SecurityManager({ secret: config.secret });
    this.startTime = Date.now();
  }

  public getHealth(): HealthCheckResponse {
    return {
      status: "ready",
      protocol_version: PROTOCOL_VERSION,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      environment_ready: true,
    };
  }

  public getManifest(): AgentManifest {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      protocol_version: PROTOCOL_VERSION,
      capabilities: this.capabilities,
      input_schema: toJsonSchema(this.config.inputSchema, "InputSchema"),
      output_schema: toJsonSchema(this.config.outputSchema, "OutputSchema"),
    };
  }

  public serve(portOrOptions?: number | ServerOptions): Server {
    const opts = typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;
    return startAgentServer(this, opts);
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Enable CORS for testing & browser callers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, X-Marketplace-Protocol, X-Marketplace-Timestamp, X-Marketplace-Nonce, X-Marketplace-Run-Id, X-Marketplace-Signature"
    );

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === "/health" && method === "GET") {
        this.writeJsonResponse(res, 200, this.getHealth());
        return;
      }

      if (pathname === "/schema" && method === "GET") {
        this.writeJsonResponse(res, 200, this.getManifest());
        return;
      }

      if (pathname === "/execute" && method === "POST") {
        await this.handleExecute(req, res);
        return;
      }

      this.writeJsonResponse(res, 404, {
        error: {
          code: "NOT_FOUND",
          message: `Endpoint ${method} ${pathname} not found`,
          retryable: false,
        },
      });
    } catch (err) {
      const error = normalizeError(err);
      this.writeJsonResponse(res, 500, {
        error,
      });
    }
  }

  private async handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    const headers = req.headers;
    const path = req.url || "/execute";
    const method = req.method || "POST";

    // 1. Security & Signature verification
    let authInfo: { runId: string; nonce: string; timestamp: number };
    try {
      authInfo = this.security.verifyRequest({
        method,
        path,
        headers,
        rawBody,
      });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && "statusCode" in err) {
        const secErr = err as { code: string; message: string; statusCode: number };
        this.writeJsonResponse(res, secErr.statusCode, {
          error: {
            code: secErr.code,
            message: secErr.message,
            retryable: false,
          },
        });
        return;
      }
      throw err;
    }

    // Parse request body
    let payload: ExecuteRequest<TInput>;
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    } catch {
      this.writeJsonResponse(res, 400, {
        error: {
          code: "INVALID_INPUT",
          message: "Malformed JSON request body",
          retryable: false,
        },
      });
      return;
    }

    const runId = payload.run_id || authInfo.runId;
    this.security.markRunStarted(runId);

    // 2. Pre-Execution Schema Validation
    const validation = validateSchemaData<TInput>(this.config.inputSchema, payload.input);
    if (!validation.success) {
      this.security.markRunCompleted(runId);
      this.writeJsonResponse(res, 400, {
        run_id: runId,
        status: "failed",
        duration_ms: 0,
        error: {
          code: "INVALID_INPUT",
          message: `Input validation failed: ${validation.errors.join("; ")}`,
          retryable: false,
          details: { validationErrors: validation.errors },
        },
      });
      return;
    }

    const startTimestamp = Date.now();
    const acceptsSse = req.headers.accept?.includes("text/event-stream") ?? true;

    // Setup deadline timeout if specified
    const abortController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | undefined;
    if (payload.deadline_ms && payload.deadline_ms > Date.now()) {
      const waitTime = payload.deadline_ms - Date.now();
      timeoutTimer = setTimeout(() => {
        abortController.abort(new Error("EXECUTION_TIMEOUT"));
      }, waitTime);
    }

    if (acceptsSse) {
      // Streaming SSE Response Mode
      const sseWriter = new SSEWriter(runId, res, {
        onClientDisconnect: () => {
          abortController.abort(new Error("CLIENT_DISCONNECTED"));
        },
      });

      // Forward abort signal
      sseWriter.signal.addEventListener("abort", () => {
        abortController.abort(sseWriter.signal.reason);
      });

      // Send initial run.started event
      sseWriter.sendRunStarted();

      try {
        const result = await this.config.execute({
          runId,
          input: validation.data,
          stream: sseWriter,
          signal: abortController.signal,
          metadata: payload.metadata,
          deadlineMs: payload.deadline_ms,
        });

        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTimestamp;
        this.security.markRunCompleted(runId);
        sseWriter.sendRunSucceeded(result.output, durationMs, result.telemetry);
      } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTimestamp;
        this.security.markRunCompleted(runId);
        const error = normalizeError(err);
        sseWriter.sendRunFailed(error, durationMs);
      }
    } else {
      // Batch JSON Mode
      try {
        const noopStream = {
          step: () => {},
          delta: () => {},
          emit: () => {},
          isClosed: () => false,
        };

        const result = await this.config.execute({
          runId,
          input: validation.data,
          stream: noopStream,
          signal: abortController.signal,
          metadata: payload.metadata,
          deadlineMs: payload.deadline_ms,
        });

        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTimestamp;
        this.security.markRunCompleted(runId);

        const response: ExecuteResponse<TOutput> = {
          run_id: runId,
          status: "succeeded",
          duration_ms: durationMs,
          output: result.output,
          telemetry: result.telemetry,
        };
        this.writeJsonResponse(res, 200, response);
      } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTimestamp;
        this.security.markRunCompleted(runId);

        const error = normalizeError(err);
        const response: ExecuteResponse<TOutput> = {
          run_id: runId,
          status: "failed",
          duration_ms: durationMs,
          error,
        };
        this.writeJsonResponse(res, 200, response);
      }
    }
  }

  private writeJsonResponse(res: ServerResponse, status: number, data: unknown): void {
    if (res.writableEnded) return;
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}

/**
 * Convenience builder function for creating a compliant Marketplace Agent
 */
export function createMarketplaceAgent<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(
  config: MarketplaceAgentConfig<TInput, TOutput>
): MarketplaceAgent<TInput, TOutput> {
  return new MarketplaceAgent(config);
}

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
      return {
        code: "EXECUTION_TIMEOUT",
        message: "Execution exceeded allowed deadline or timeout",
        retryable: true,
      };
    }

    // Check for standard error codes attached to error object
    const code = (err as unknown as { code?: string }).code || defaultCode;
    const retryable = (err as unknown as { retryable?: boolean }).retryable ?? false;

    return {
      code,
      message: err.message,
      retryable,
    };
  }

  return {
    code: defaultCode,
    message: String(err),
    retryable: false,
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
