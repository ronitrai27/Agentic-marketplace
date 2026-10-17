import { Langfuse } from "langfuse";
import { CallbackHandler } from "langfuse-langchain";
import { ENV } from "../config/env.js";

export const langfuse = new Langfuse({
  secretKey: ENV.LANGFUSE_SECRET_KEY,
  publicKey: ENV.LANGFUSE_PUBLIC_KEY,
  baseUrl: ENV.LANGFUSE_BASE_URL,
});

/**
 * Creates a Langfuse callback handler for tracing LangGraph executions
 */
export function createLangfuseHandler(options?: {
  sessionId?: string;
  userId?: string;
  tags?: string[];
}) {
  return new CallbackHandler({
    secretKey: ENV.LANGFUSE_SECRET_KEY,
    publicKey: ENV.LANGFUSE_PUBLIC_KEY,
    baseUrl: ENV.LANGFUSE_BASE_URL,
    sessionId: options?.sessionId,
    userId: options?.userId,
    tags: ["research-agent", ...(options?.tags || [])],
  });
}
