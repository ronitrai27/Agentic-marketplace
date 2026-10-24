import { EventEmitter } from "node:events";

class ResearchProgressEmitter extends EventEmitter {}

export const progressEmitter = new ResearchProgressEmitter();

// Increase max listeners for concurrent SSE streams
progressEmitter.setMaxListeners(50);

/**
 * Emits a real-time progress event across the system.
 * Picked up immediately by SSE streams, Catelog streams, and Temporal heartbeats.
 */
export function notifyProgress(step: string, details?: any) {
  progressEmitter.emit("step", {
    step,
    details,
    timestamp: Date.now(),
  });
}
