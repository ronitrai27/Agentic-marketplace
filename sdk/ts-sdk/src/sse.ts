import type { ServerResponse } from "node:http";
import type {
  AgentStream,
  OutputDeltaEvent,
  RunFailedEvent,
  RunStartedEvent,
  RunSucceededEvent,
  SSEProtocolEvent,
  StepStartedEvent,
  StructuredError,
  TelemetryData,
} from "./types.js";

export interface SSEWriterOptions {
  heartbeatIntervalMs?: number; // default: 15_000 (15 seconds)
  onClientDisconnect?: () => void;
}

export class SSEWriter implements AgentStream {
  private runId: string;
  private res: ServerResponse;
  private heartbeatTimer?: NodeJS.Timeout;
  private stepIndex = 0;
  private deltaIndex = 0;
  private closed = false;
  private abortController: AbortController;

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

    // Flush headers if supported
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

    // Start 15-second heartbeat
    const interval = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed) {
        this.sendEvent("heartbeat", {
          event: "heartbeat",
          timestamp: Date.now(),
        });
      }
    }, interval);
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  /**
   * Generic raw event sender adhering to SSE framing:
   * event: <EVENT_TYPE>\ndata: <JSON_STRING>\n\n
   */
  public sendEvent(eventType: string, data: unknown): void {
    if (this.closed) return;
    try {
      this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.closed = true;
      this.clearHeartbeat();
    }
  }

  public sendRunStarted(): void {
    const payload: RunStartedEvent = {
      event: "run.started",
      run_id: this.runId,
      timestamp: Date.now(),
    };
    this.sendEvent("run.started", payload);
  }

  public step(label: string): void {
    this.stepIndex += 1;
    const payload: StepStartedEvent = {
      event: "step.started",
      run_id: this.runId,
      step_index: this.stepIndex,
      label,
      timestamp: Date.now(),
    };
    this.sendEvent("step.started", payload);
  }

  public delta(content: string, delta_type: "text" | "json_patch" = "text"): void {
    const payload: OutputDeltaEvent = {
      event: "output.delta",
      run_id: this.runId,
      index: this.deltaIndex++,
      delta_type,
      content,
    };
    this.sendEvent("output.delta", payload);
  }

  public emit(event: string, data: unknown): void {
    this.sendEvent(event, data);
  }

  public sendRunSucceeded<TOutput>(output: TOutput, durationMs: number, telemetry?: TelemetryData): void {
    if (this.closed) return;
    const payload: RunSucceededEvent<TOutput> = {
      event: "run.succeeded",
      run_id: this.runId,
      duration_ms: durationMs,
      output,
      telemetry,
    };
    this.sendEvent("run.succeeded", payload);
    this.close();
  }

  public sendRunFailed(error: StructuredError, durationMs: number): void {
    if (this.closed) return;
    const payload: RunFailedEvent = {
      event: "run.failed",
      run_id: this.runId,
      duration_ms: durationMs,
      error,
    };
    this.sendEvent("run.failed", payload);
    this.close();
  }

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
