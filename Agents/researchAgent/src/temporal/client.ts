import { Connection, Client, type WorkflowHandle } from "@temporalio/client";
import { ENV } from "../config/env.js";
import {
  deepResearchWorkflow,
  getEventsQuery,
  getStateQuery,
} from "./workflows.js";
import type {
  ResearchWorkflowInput,
  WorkflowEvent,
  WorkflowState,
} from "./types.js";
import type { AgentExecutionResult } from "../index.js";

let cachedClient: Client | null = null;

/**
 * Initializes and caches a Temporal Client connection.
 * Seamlessly handles Temporal Cloud (with TLS & API Key) or local Temporal dev-server.
 */
export async function getTemporalClient(): Promise<Client> {
  if (cachedClient) {
    return cachedClient;
  }

  const address = ENV.TEMPORAL_ADDRESS;
  const namespace = ENV.TEMPORAL_NAMESPACE;
  const apiKey = ENV.TEMPORAL_API_KEY;

  console.log(`🔌 [Temporal Client] Connecting to ${address} (Namespace: ${namespace})...`);

  const connection = await Connection.connect({
    address,
    apiKey: apiKey || undefined,
    tls: apiKey ? true : false,
  });

  cachedClient = new Client({
    connection,
    namespace,
  });

  console.log(`✅ [Temporal Client] Connected successfully!`);
  return cachedClient;
}

/**
 * Dispatches a Deep Research Workflow run to Temporal.
 * Returns the workflow ID and handle immediately so caller can track/query progress.
 */
export async function startResearchWorkflow(input: ResearchWorkflowInput): Promise<{
  workflowId: string;
  handle: WorkflowHandle<typeof deepResearchWorkflow>;
}> {
  const client = await getTemporalClient();
  const workflowId =
    input.runId || `deep-research-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  console.log(`🚀 [Temporal Dispatch] Starting workflowId: ${workflowId}`);
  console.log(`   - Task Queue: ${ENV.TEMPORAL_TASK_QUEUE}`);
  console.log(`   - Prompt: "${input.prompt}"`);

  const handle = await client.workflow.start(deepResearchWorkflow, {
    taskQueue: ENV.TEMPORAL_TASK_QUEUE,
    workflowId,
    args: [input],
  });

  console.log(`✅ [Temporal Dispatch] Workflow started! RunId: ${handle.firstExecutionRunId}`);
  return { workflowId, handle };
}

/**
 * Queries the live emitted events of a running or completed workflow.
 */
export async function getWorkflowEvents(workflowId: string): Promise<WorkflowEvent[]> {
  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query(getEventsQuery);
  } catch (err: any) {
    console.warn(`[Temporal Query Warning] Failed to query events for ${workflowId}:`, err?.message);
    return [];
  }
}

/**
 * Queries the overall workflow state.
 */
export async function getWorkflowState(workflowId: string): Promise<WorkflowState | null> {
  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query(getStateQuery);
  } catch (err: any) {
    console.warn(`[Temporal Query Warning] Failed to query state for ${workflowId}:`, err?.message);
    return null;
  }
}
