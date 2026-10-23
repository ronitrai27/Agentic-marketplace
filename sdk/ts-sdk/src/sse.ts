import type { ServerResponse } from "node:http";
import type {
  AgentStream,
  TaskStatusEvent,
  TaskProgressEvent,
  TaskDeltaEvent,
  TaskActivityEvent,
  TaskInputRequiredEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  StructuredError,
  TelemetryData,
  TaskState,
} from "./types.js";

// ─────────────────────────────────────────────────
//  SSEWriter Options
// ─────────────────────────────────────────────────

export interface SSEWriterOptions {
  /** Heartbeat interval in ms (default: 15s) */
  heartbeatIntervalMs?: number;
  /** Callback on client disconnect */
  onClientDisconnect?: () => void;
}

// ─────────────────────────────────────────────────
//  SSEWriter — streams canonical task lifecycle events
// ─────────────────────────────────────────────────

export class SSEWriter implements AgentStream {
  private runId: string;
  private res: ServerResponse;
  private heartbeatTimer?: NodeJS.Timeout;
  private stepIndex = 0;
  private deltaIndex = 0;
  private closed = false;
  private abortController: AbortController;
  public chunksStreamed = 0;

  constructor(runId: string, res: ServerResponse, options: SSEWriterOptions = {}) {
    this.runId = runId;
    this.res = res;
    this.abortController = new AbortController();

    // Set standard SSE headers
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (typeof this.res.flushHeaders === "function") {
      this.res.flushHeaders();
    }

    // Client disconnect detection
    this.res.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.clearHeartbeat();
        this.abortController.abort();
        options.onClientDisconnect?.();
      }
    });

    // 15-second heartbeat
    const interval = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed) {
        this.sendEvent("heartbeat", { event: "heartbeat", timestamp: Date.now() });
      }
    }, interval);
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  // ── Raw SSE sender ──

  public sendEvent(eventType: string, data: unknown): void {
    if (this.closed) return;
    try {
      this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.closed = true;
      this.clearHeartbeat();
    }
  }

  // ── Task Lifecycle Events ──

  /** Emit task.status = "working" on execution start */
  public sendTaskStatus(status: TaskState): void {
    const payload: TaskStatusEvent = {
      event: "task.status",
      run_id: this.runId,
      status,
      timestamp: Date.now(),
    };
    this.sendEvent("task.status", payload);
  }

  /** Progress tick (0-100). Does NOT complete the task. */
  public progress(percent: number, message?: string): void {
    this.stepIndex += 1;
    const payload: TaskProgressEvent = {
      event: "task.progress",
      run_id: this.runId,
      percent: Math.min(100, Math.max(0, percent)),
      message,
      step: this.stepIndex,
      timestamp: Date.now(),
    };
    this.sendEvent("task.progress", payload);
  }

  /** Stream a text/token delta. Does NOT complete the task. */
  public delta(content: string, delta_type: "text" | "json_patch" = "text"): void {
    this.chunksStreamed++;
    const payload: TaskDeltaEvent = {
      event: "task.delta",
      run_id: this.runId,
      index: this.deltaIndex++,
      delta_type,
      content,
    };
    this.sendEvent("task.delta", payload);
  }

  /** Named activity event (tool_call, search, etc.) */
  public activity(type: string, data?: Record<string, unknown>): void {
    const payload: TaskActivityEvent = {
      event: "task.activity",
      run_id: this.runId,
      activity_type: type,
      data,
      timestamp: Date.now(),
    };
    this.sendEvent("task.activity", payload);
  }

  /** Legacy step (maps to progress internally) */
  public step(label: string): void {
    this.progress(0, label);
  }

  /** Convenience alias for delta */
  public write(text: string): void {
    this.delta(text, "text");
  }

  /** Convenience alias for delta / streaming chunks of text */
  public chunk(chunk: string): void {
    this.delta(chunk, "text");
  }

  /** Raw event emitter */
  public emit(event: string, data: unknown): void {
    this.sendEvent(event, data);
  }

  // ── Terminal Events ──

  public sendTaskCompleted<TOutput>(output: TOutput, durationMs: number, telemetry?: TelemetryData): void {
    if (this.closed) return;
    const payload: TaskCompletedEvent<TOutput> = {
      event: "task.completed",
      run_id: this.runId,
      duration_ms: durationMs,
      output,
      telemetry,
    };
    this.sendEvent("task.completed", payload);
    this.close();
  }

  public sendTaskFailed(error: StructuredError, durationMs: number): void {
    if (this.closed) return;
    const payload: TaskFailedEvent = {
      event: "task.failed",
      run_id: this.runId,
      duration_ms: durationMs,
      error,
    };
    this.sendEvent("task.failed", payload);
    this.close();
  }

  public sendTaskInputRequired(prompt: string, resumeToken: string, inputSchema?: Record<string, unknown>): void {
    if (this.closed) return;
    const payload: TaskInputRequiredEvent = {
      event: "task.input_required",
      run_id: this.runId,
      prompt,
      input_schema: inputSchema,
      resume_token: resumeToken,
      timestamp: Date.now(),
    };
    this.sendEvent("task.input_required", payload);
    this.close();
  }

  public sendTaskCanceled(durationMs: number): void {
    this.sendTaskFailed(
      { code: "TASK_CANCELED", message: "Execution was canceled", retryable: false },
      durationMs
    );
  }

  // ── Backward compat wrappers ──

  public sendRunStarted(): void {
    this.sendTaskStatus("working");
  }

  public sendRunSucceeded<TOutput>(output: TOutput, durationMs: number, telemetry?: TelemetryData): void {
    this.sendTaskCompleted(output, durationMs, telemetry);
  }

  public sendRunFailed(error: StructuredError, durationMs: number): void {
    this.sendTaskFailed(error, durationMs);
  }

  // ── Lifecycle ──

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearHeartbeat();
    try {
      this.res.end();
    } catch {
      // Ignore write errors on close
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

// ─────────────────────────────────────────────────
//  NoopStream — for batch JSON (non-SSE) mode
// ─────────────────────────────────────────────────

export class NoopStream implements AgentStream {
  public chunksStreamed = 0;

  progress(_percent: number, _message?: string): void {}
  delta(_content: string, _type?: "text" | "json_patch"): void {
    this.chunksStreamed++;
  }
  activity(_type: string, _data?: Record<string, unknown>): void {}
  step(_label: string): void {}
  emit(_event: string, _data: unknown): void {}
  write(text: string): void { this.delta(text); }
  chunk(chunk: string): void { this.delta(chunk); }
  isClosed(): boolean { return false; }
}
