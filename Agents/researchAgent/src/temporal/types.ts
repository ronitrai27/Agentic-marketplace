export interface ResearchWorkflowInput {
  prompt: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
}

export interface WorkflowEvent {
  timestamp: number;
  type: "STARTED" | "PROGRESS" | "HEARTBEAT" | "COMPLETED" | "FAILED";
  message: string;
  details?: Record<string, any>;
}

export interface WorkflowState {
  workflowId: string;
  runId?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: string;
  events: WorkflowEvent[];
  startedAt: number;
  completedAt?: number;
}
