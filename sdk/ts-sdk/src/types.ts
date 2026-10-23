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
//  Stream Interface
// ─────────────────────────────────────────────────

export interface AgentStream {
  /** Emit a progress tick (0-100). Does NOT complete the task. */
  progress: (percent: number, message?: string) => void;
  /** Stream a text/token delta. Does NOT complete the task. */
  delta: (content: string, type?: "text" | "json_patch") => void;
  /** Emit a named activity event (tool_call, search, etc.) */
  activity: (type: string, data?: Record<string, unknown>) => void;
  /** Legacy step label (maps to progress internally) */
  step: (label: string) => void;
  /** Raw event emitter */
  emit: (event: string, data: unknown) => void;
  /** Write arbitrary text to the stream (convenience alias for delta) */
  write: (text: string) => void;
  /** Is the connection still open? */
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

export interface AgentExecutionContext<TInput = Record<string, unknown>> {
  runId: string;
  input: TInput;
  stream: AgentStream;
  signal: AbortSignal;
  log: AgentLogger;
  metric: AgentMetric;
  metadata?: Record<string, unknown>;
  deadlineMs?: number;
  /** Resume token when continuing a conversation */
  resumeToken?: string;
  /** Suspend execution and ask for human/caller input */
  needInput: (opts: { prompt: string; schema?: Record<string, unknown>; continuation?: boolean }) => NeedInputResult;
  /** Session state for multi-turn conversations */
  session: {
    get: <T = unknown>(key: string) => T | undefined;
    set: (key: string, value: unknown) => void;
    getAll: () => Record<string, unknown>;
  };
}

export interface AgentExecutionResult<TOutput = Record<string, unknown>> {
  output: TOutput;
  telemetry?: TelemetryData;
}
