export const PROTOCOL_VERSION = "1.0.0";

/**
 * Standard error codes defined by Marketplace Agent Protocol Specification (MAPS)
 */
export type ErrorCode =
  | "AUTH_INVALID_SIGNATURE"
  | "AUTH_TIMESTAMP_OUT_OF_BOUNDS"
  | "AUTH_REPLAY_DETECTED"
  | "INVALID_INPUT"
  | "MODEL_RATE_LIMIT"
  | "UPSTREAM_TIMEOUT"
  | "EXECUTION_TIMEOUT"
  | "INTERNAL_CRASH"
  | "TOOL_FAILURE";

export interface StructuredError {
  code: ErrorCode | string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface TelemetryData {
  llm_tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  model_used?: string;
  cost_usd?: number;
}

export interface AgentCapabilities {
  streaming: boolean;
  delta_stream?: boolean;
  max_timeout_seconds?: number;
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

export interface HealthCheckResponse {
  status: "ready" | "degraded" | "not_ready";
  protocol_version: string;
  uptime_seconds: number;
  environment_ready: boolean;
  details?: Record<string, unknown>;
}

export interface ExecuteRequest<TInput = Record<string, unknown>> {
  run_id: string;
  input: TInput;
  deadline_ms?: number;
  metadata?: {
    buyer_id?: string;
    session_id?: string;
    [key: string]: unknown;
  };
}

export interface ExecuteSuccessResponse<TOutput = Record<string, unknown>> {
  run_id: string;
  status: "succeeded";
  duration_ms: number;
  output: TOutput;
  error?: false;
  telemetry?: TelemetryData;
}

export interface ExecuteFailureResponse {
  run_id: string;
  status: "failed" | "cancelled";
  duration_ms: number;
  error: StructuredError;
  output?: false;
  telemetry?: TelemetryData;
}

export type ExecuteResponse<TOutput = Record<string, unknown>> =
  | ExecuteSuccessResponse<TOutput>
  | ExecuteFailureResponse;

// SSE Protocol Events
export interface RunStartedEvent {
  event: "run.started";
  run_id: string;
  timestamp: number;
}

export interface StepStartedEvent {
  event: "step.started";
  run_id: string;
  step_index: number;
  label: string;
  timestamp: number;
}

export interface OutputDeltaEvent {
  event: "output.delta";
  run_id: string;
  index: number;
  delta_type: "text" | "json_patch";
  content: string;
}

export interface HeartbeatEvent {
  event: "heartbeat";
  timestamp: number;
}

export interface RunSucceededEvent<TOutput = Record<string, unknown>> {
  event: "run.succeeded";
  run_id: string;
  duration_ms: number;
  output: TOutput;
  telemetry?: TelemetryData;
}

export interface RunFailedEvent {
  event: "run.failed";
  run_id: string;
  duration_ms: number;
  error: StructuredError;
}

export type SSEProtocolEvent =
  | RunStartedEvent
  | StepStartedEvent
  | OutputDeltaEvent
  | HeartbeatEvent
  | RunSucceededEvent
  | RunFailedEvent;

/**
 * Stream controller passed to agent execute handlers
 */
export interface AgentStream {
  step: (label: string) => void;
  delta: (content: string, type?: "text" | "json_patch") => void;
  emit: (event: string, data: unknown) => void;
  isClosed: () => boolean;
}

export interface AgentExecutionContext<TInput = Record<string, unknown>> {
  runId: string;
  input: TInput;
  stream: AgentStream;
  signal: AbortSignal;
  metadata?: Record<string, unknown>;
  deadlineMs?: number;
}

export interface AgentExecutionResult<TOutput = Record<string, unknown>> {
  output: TOutput;
  telemetry?: TelemetryData;
}
