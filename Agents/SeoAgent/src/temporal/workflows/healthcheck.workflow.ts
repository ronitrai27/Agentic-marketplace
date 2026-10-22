/**
 * HealthCheck Workflow
 * Used to verify deterministic execution, connection, and ping from Temporal Cloud.
 */
export async function healthCheckWorkflow(input: { pingMessage: string }): Promise<{
  status: "ok";
  echo: string;
  workerConnected: true;
}> {
  return {
    status: "ok",
    echo: input.pingMessage,
    workerConnected: true,
  };
}
