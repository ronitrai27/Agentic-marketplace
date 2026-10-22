import { Connection, Client } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import { env } from "../config/env.js";

/**
 * Determines whether TLS is required based on endpoint or presence of API key.
 * Temporal Cloud endpoints (*.tmprl.cloud) mandate TLS with API keys.
 */
function isTlsRequired(): boolean {
  return Boolean(env.TEMPORAL_API_KEY) || env.TEMPORAL_ADDRESS.includes(".tmprl.cloud");
}

/**
 * Creates a client-side Connection (gRPC channel).
 */
export async function createClientConnection(): Promise<Connection> {
  const tls = isTlsRequired();

  return await Connection.connect({
    address: env.TEMPORAL_ADDRESS,
    apiKey: env.TEMPORAL_API_KEY,
    tls: tls ? {} : undefined,
  });
}

/**
 * Creates a high-performance native C++ core connection for Workers.
 */
export async function createNativeConnection(): Promise<NativeConnection> {
  const tls = isTlsRequired();

  return await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
    apiKey: env.TEMPORAL_API_KEY,
    tls: tls ? {} : undefined,
  });
}

/**
 * Creates a configured Temporal Client bound to the environment namespace.
 */
export async function createTemporalClient(): Promise<Client> {
  const connection = await createClientConnection();
  return new Client({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  });
}
