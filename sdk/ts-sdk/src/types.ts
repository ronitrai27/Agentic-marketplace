export const PROTOCOL_VERSION = "1.0.0";

// ─────────────────────────────────────────────────
//  Error Codes
// ─────────────────────────────────────────────────

export type ErrorCode =
  | "AUTH_INVALID_SIGNATURE"
  | "AUTH_TIMESTAMP_OUT_OF_BOUNDS"
  | "AUTH_REPLAY_DETECTED"
  | "AUTH_MISSING_KEY"
  | "AUTH_INVALID_KEY"
  | "INVALID_INPUT"
  | "MODEL_RATE_LIMIT"
  | "UPSTREAM_TIMEOUT"
  | "EXECUTION_TIMEOUT"
  | "INTERNAL_CRASH"
  | "TOOL_FAILURE"
  | "TASK_CANCELED"
  | "TASK_INTERRUPTED"
  | "RATE_LIMITED"
  | "SERVER_BUSY"
  | "SHUTTING_DOWN"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND";

export interface StructuredError {
  code: ErrorCode | string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────
//  Task Lifecycle States (A2A compatible)
// ─────────────────────────────────────────────────

export type TaskState =
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "input-required";

// ─────────────────────────────────────────────────
//  Execution Modes
// ─────────────────────────────────────────────────

/**
 * sync:           Direct HTTP/SSE — stream and resolve in same connection.
 * async:          Returns 202 Accepted immediately, polled via GET /tasks/:id.
 * conversational: Supports multi-turn with ctx.needInput() suspensions.
 */
export type ExecutionMode = "sync" | "async" | "conversational";

// ─────────────────────────────────────────────────
//  Telemetry
// ─────────────────────────────────────────────────

export interface TelemetryData {
  llm_tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  model_used?: string;
  cost_usd?: number;
  /** Base metrics auto-collected by the SDK */
  duration_ms?: number;
  input_bytes?: number;
  output_bytes?: number;
  chunks_streamed?: number;
  /** Framework-specific extras (OpenAI usage, LangGraph nodes, etc.) */
  framework?: Record<string, unknown>;
  /** Any custom metrics or telemetry added by the agent */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────
//  Capabilities & Manifest
// ─────────────────────────────────────────────────

export interface AgentCapabilities {
  streaming: boolean;
  delta_stream?: boolean;
  max_timeout_seconds?: number;
  execution_modes: ExecutionMode[];
}

export interface AgentManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  protocol_version: string;
  capabilities: AgentCapabilities;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────
//  Health Check
// ─────────────────────────────────────────────────

export interface HealthCheckResponse {
  status: "ready" | "degraded" | "not_ready";
  protocol_version: string;
  uptime_seconds: number;
  environment_ready: boolean;
  capabilities?: AgentCapabilities;
  details?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────
//  Execute Request / Response
// ─────────────────────────────────────────────────

export interface ExecuteRequest<TInput = Record<string, unknown>> {
  run_id?: string;
  input: TInput;
  deadline_ms?: number;
  /** Resume token for conversational continuation */
  resume_token?: string;
  metadata?: {
    buyer_id?: string;
    session_id?: string;
    [key: string]: unknown;
  };
}

export interface ExecuteSuccessResponse<TOutput = Record<string, unknown>> {
  run_id: string;
  status: "completed";
  duration_ms: number;
  output: TOutput;
  error?: false;
  telemetry?: TelemetryData;
}

export interface ExecuteFailureResponse {
  run_id: string;
  status: "failed" | "canceled";
  duration_ms: number;
  error: StructuredError;
  output?: false;
  telemetry?: TelemetryData;
}

export interface ExecuteInputRequiredResponse {
  run_id: string;
  status: "input-required";
  duration_ms: number;
  prompt: string;
  input_schema?: Record<string, unknown>;
  resume_token: string;
  telemetry?: TelemetryData;
}

export interface ExecuteAsyncAcceptedResponse {
  run_id: string;
  status: "working";
  poll_url: string;
  telemetry?: TelemetryData;
}

export type ExecuteResponse<TOutput = Record<string, unknown>> =
  | ExecuteSuccessResponse<TOutput>
  | ExecuteFailureResponse
  | ExecuteInputRequiredResponse
  | ExecuteAsyncAcceptedResponse;

// ─────────────────────────────────────────────────
//  SSE Protocol Events
// ─────────────────────────────────────────────────

export interface TaskStatusEvent {
  event: "task.status";
  run_id: string;
  status: TaskState;
  timestamp: number;
}

export interface TaskProgressEvent {
  event: "task.progress";
  run_id: string;
  percent: number;
  message?: string;
  step?: number;
  timestamp: number;
}

export interface TaskDeltaEvent {
  event: "task.delta";
  run_id: string;
  index: number;
  delta_type: "text" | "json_patch";
  content: string;
}

export interface TaskActivityEvent {
  event: "task.activity";
  run_id: string;
  activity_type: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface TaskInputRequiredEvent {
  event: "task.input_required";
  run_id: string;
  prompt: string;
  input_schema?: Record<string, unknown>;
  resume_token: string;
  timestamp: number;
}

export interface TaskCompletedEvent<TOutput = Record<string, unknown>> {
  event: "task.completed";
  run_id: string;
  duration_ms: number;
  output: TOutput;
  telemetry?: TelemetryData;
}

export interface TaskFailedEvent {
  event: "task.failed";
  run_id: string;
  duration_ms: number;
  error: StructuredError;
}

export interface HeartbeatEvent {
  event: "heartbeat";
  timestamp: number;
}

export type SSEProtocolEvent =
  | TaskStatusEvent
  | TaskProgressEvent
  | TaskDeltaEvent
  | TaskActivityEvent
  | TaskInputRequiredEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | HeartbeatEvent;

// ─────────────────────────────────────────────────
//  Live Events for Async Polling (GET /tasks/:id)
// ─────────────────────────────────────────────────

/**
 * One live event recorded while an async job runs.
 * Produced by `stream.step()`, `stream.progress()`, `stream.activity()` and `stream.emit()`.
 */
export interface TaskEventRecord {
  /** Monotonic sequence number (starts at 1). Use as the `?since=` cursor. */
  seq: number;
  /** Which stream helper produced this event. */
  type: "step" | "progress" | "activity" | "event";
  /** Epoch milliseconds when the event was recorded. */
  timestamp: number;
  /** Human-readable message (step label / progress message). */
  message?: string;
  /** Progress percentage (only for `type: "progress"`). */
  percent?: number;
  /** Activity or custom event name (for `type: "activity" | "event"`). */
  name?: string;
  /** Optional structured payload (for `type: "activity" | "event"`). */
  data?: unknown;
}

/**
 * Optional live fields added to every `GET /tasks/:id` response.
 * Older clients simply ignore them.
 */
export interface TaskPollLiveFields {
  /** Most recent step/progress message, if any was emitted. */
  current_step?: string;
  /** Most recent progress percentage (0-100), if any was emitted. */
  progress_pct?: number;
  /** Events with `seq > since` (all buffered events when `since` is omitted). */
  events: TaskEventRecord[];
  /** Highest sequence number recorded so far. Pass back as `?since=` on the next poll. */
  last_seq: number;
}

// ─────────────────────────────────────────────────
//  Stream Interface
// ─────────────────────────────────────────────────

export interface AgentStream {
  /**
   * Emit an incremental progress percentage (0 to 100) and an optional human-readable status message.
   * Sends a `task.progress` SSE event to the client. Does NOT complete the task.
   * 
   * @param percent Progress percentage from 0 to 100
   * @param message Optional short status description (e.g. "Scraping web sources...")
   * 
   * @example
   * stream.progress(25, "Searching Google...");
   */
  progress: (percent: number, message?: string) => void;

  /**
   * Stream a text or JSON patch delta/token chunk to the client.
   * Sends a `task.delta` SSE event. Does NOT complete the task.
   * 
   * @param content The text chunk or JSON patch delta to emit
   * @param type Delta type: `"text"` for normal LLM tokens, `"json_patch"` for structured objects (defaults to `"text"`)
   * 
   * @example
   * stream.delta("Hello ");
   * stream.delta("world!");
   */
  delta: (content: string, type?: "text" | "json_patch") => void;

  /**
   * Stream a chunk of text. Convenience alias for `stream.delta(chunk)` / `stream.write(chunk)`.
   * Allows developers familiar with standard streams to emit text chunks seamlessly.
   * 
   * @param chunk The text string to send
   * 
   * @example
   * stream.chunk("Here is the completed research response...");
   */
  chunk: (chunk: string) => void;

  /**
   * Write arbitrary text to the stream. Convenience alias for `stream.delta(text)`.
   * 
   * @param text The text string to send
   * 
   * @example
   * stream.write("Generating summary...");
   */
  write: (text: string) => void;

  /**
   * Emit a named activity event (e.g., tool calls, database lookups, background tasks, web search).
   * Sends a `task.activity` SSE event with arbitrary payload data.
   * 
   * @param type Type/identifier for this activity (e.g. `"web_search"`, `"tool_call"`, `"sql_query"`)
   * @param data Optional metadata payload describing the activity
   * 
   * @example
   * stream.activity("web_search", { query: "Quantum computing 2026", results: 5 });
   */
  activity: (type: string, data?: Record<string, unknown>) => void;

  /**
   * Emit a progress step message. Convenience alias for `stream.progress(0, label)`.
   * 
   * @param label Short description of the step currently being executed
   * 
   * @example
   * stream.step("Initializing OpenAI client...");
   */
  step: (label: string) => void;

  /**
   * Emit a custom raw SSE event with arbitrary name and JSON-serializable data.
   * 
   * @param event The SSE event name (e.g. `"custom_metric"`)
   * @param data Payload data object
   * 
   * @example
   * stream.emit("custom_event", { timestamp: Date.now(), alert: "high_load" });
   */
  emit: (event: string, data: unknown) => void;

  /**
   * Check whether the SSE connection was aborted or closed by the client.
   * Use this to break early out of long-running loops or background jobs.
   * 
   * @returns `true` if client disconnected, `false` otherwise
   * 
   * @example
   * if (stream.isClosed()) {
   *   console.log("Client cancelled request, terminating workflow...");
   *   return;
   * }
   */
  isClosed: () => boolean;
}

// ─────────────────────────────────────────────────
//  Logger & Metric helpers
// ─────────────────────────────────────────────────

export interface AgentLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

export interface AgentMetric {
  count: (name: string, value?: number) => void;
  gauge: (name: string, value: number) => void;
  timing: (name: string, durationMs: number) => void;
}

// ─────────────────────────────────────────────────
//  NeedInput result (for conversational agents)
// ─────────────────────────────────────────────────

export const NEED_INPUT_SYMBOL = Symbol.for("catelog.needInput");

export interface NeedInputResult {
  [NEED_INPUT_SYMBOL]: true;
  prompt: string;
  schema?: Record<string, unknown>;
  continuation?: boolean;
}

// ─────────────────────────────────────────────────
//  Execution Context
// ─────────────────────────────────────────────────

/**
 * Execution context supplied to the agent's `execute({ input, stream, ... })` handler.
 * Provides all operational handles for streaming, logging, metrics, multi-turn sessions, and abort signals.
 */
export interface AgentExecutionContext<TInput = Record<string, unknown>> {
  /**
   * Unique execution ID generated for this task run.
   * Useful for correlation with external logs, database records, and Temporal workflows.
   */
  runId: string;

  /**
   * Validated input payload parsed against `inputSchema` (if provided), or raw parsed JSON body.
   */
  input: TInput;

  /**
   * Real-time SSE streaming interface. Use this to stream deltas, progress, activities, and custom events.
   * 
   * @example
   * stream.progress(50, "Synthesizing answer...");
   * stream.delta("Thinking complete. Result is: ...");
   */
  stream: AgentStream;

  /**
   * Standard `AbortSignal` triggered if the client disconnects or if the request times out.
   * Listen to this or pass it to `fetch` / OpenAI SDK calls to cancel operations immediately.
   * 
   * @example
   * signal.addEventListener("abort", () => {
   *   console.log("Task aborted");
   * });
   */
  signal: AbortSignal;

  /**
   * Structured contextual logger. Logs are tagged with `runId` and sent to stderr/stdout or marketplace telemetry.
   * 
   * @example
   * log.info("Research initiated", { topic: input.prompt });
   * log.error("Failed to fetch page", { url });
   */
  log: AgentLogger;

  /**
   * Telemetry metrics collector for counters, gauges, and latency timings.
   * Automatically batched and reported with task completion.
   * 
   * @example
   * metric.count("cache_hits", 1);
   * metric.timing("llm_duration", 1450);
   */
  metric: AgentMetric;

  /**
   * Optional metadata passed by the marketplace caller (e.g., caller user ID, organization, request trace IDs).
   */
  metadata?: Record<string, unknown>;

  /**
   * Absolute deadline in epoch milliseconds when this execution will time out.
   */
  deadlineMs?: number;

  /**
   * Continuation/resume token when continuing an existing conversational multi-turn session.
   */
  resumeToken?: string;

  /**
   * Suspend task execution and request input from the human user or calling system.
   * Yields a `task.input_required` SSE event.
   * 
   * @param opts Configuration containing prompt message and optional schema for expected input
   * 
   * @example
   * if (!input.confirmation) {
   *   return needInput({
   *     prompt: "Do you want to proceed with executing the trade?",
   *     schema: { type: "object", properties: { confirmation: { type: "boolean" } } }
   *   });
   * }
   */
  needInput: (opts: { prompt: string; schema?: Record<string, unknown>; continuation?: boolean }) => NeedInputResult;

  /**
   * State management store for multi-turn conversational agents across `needInput` rounds.
   * 
   * @example
   * session.set("stage", "confirmed");
   * const stage = session.get<string>("stage");
   */
  session: {
    /** Get a value from session store */
    get: <T = unknown>(key: string) => T | undefined;
    /** Set a value in session store */
    set: (key: string, value: unknown) => void;
    /** Retrieve all key-value pairs stored in this session */
    getAll: () => Record<string, unknown>;
  };
}

export interface AgentExecutionResult<TOutput = Record<string, unknown>> {
  output: TOutput;
  telemetry?: TelemetryData;
}
