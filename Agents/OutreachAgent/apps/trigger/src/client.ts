export type OutreachTaskPayload = {
  workflowRunId: string;
  nodeRunId: string;
  tenantId: string;
  agentInstanceId: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
};

const apiBaseUrl = process.env.OUTREACH_API_URL ?? 'http://localhost:8010';

export async function executeOutreach(payload: OutreachTaskPayload): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}/internal/agents/universal-outreach-agent/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.INTERNAL_API_TOKEN
        ? { Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      ...payload.input,
      tenant_id: payload.tenantId,
      workflow_run_id: payload.workflowRunId,
      agent_instance_id: payload.agentInstanceId,
      idempotency_key: payload.idempotencyKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Outreach API returned ${response.status}.`);
  }
  return response.json();
}
