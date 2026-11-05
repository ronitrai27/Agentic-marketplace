import { Connection, Client } from "@temporalio/client";
import { NativeConnection } from "@temporalio/worker";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const TEMPORAL_CONFIG = {
  address: process.env.TEMPORAL_ADDRESS || "quickstart-rox-seoagent-1212.odwdl.tmprl.cloud:7233",
  namespace: process.env.TEMPORAL_NAMESPACE || "quickstart-rox-seoagent-1212.odwdl",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE || "seo-agent-queue",
  apiKey: process.env.TEMPORAL_API_KEY || "",
};

function isTlsRequired(): boolean {
  return Boolean(TEMPORAL_CONFIG.apiKey) || TEMPORAL_CONFIG.address.includes(".tmprl.cloud");
}

export async function createClientConnection(): Promise<Connection> {
  const tls = isTlsRequired();
  return await Connection.connect({
    address: TEMPORAL_CONFIG.address,
    apiKey: TEMPORAL_CONFIG.apiKey,
    tls: tls ? {} : undefined,
  });
}

export async function createNativeConnection(): Promise<NativeConnection> {
  const tls = isTlsRequired();
  return await NativeConnection.connect({
    address: TEMPORAL_CONFIG.address,
    apiKey: TEMPORAL_CONFIG.apiKey,
    tls: tls ? {} : undefined,
  });
}

export async function createTemporalClient(): Promise<Client> {
  const connection = await createClientConnection();
  return new Client({
    connection,
    namespace: TEMPORAL_CONFIG.namespace,
  });
}
