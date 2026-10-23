// ─────────────────────────────────────────────────
//  Catelog TypeScript SDK — Clean Root Exports
// ─────────────────────────────────────────────────

// Core types & protocol
export * from "./types.js";

// Agent class & factory functions
export {
  CatelogAgent,
  createAgent,
  // Backward compatibility aliases
  MarketplaceAgent,
  createMarketplaceAgent,
  type CatelogAgentConfig,
  type MarketplaceAgentConfig,
} from "./agent.js";

// Security (dual-mode auth)
export {
  SecurityManager,
  SecurityVerificationError,
  type SecurityOptions,
  type AuthMode,
} from "./security.js";

// SSE streaming
export { SSEWriter, NoopStream, type SSEWriterOptions } from "./sse.js";

// Schema (Zod + JSON Schema)
export { toJsonSchema, validateSchemaData, isZodSchema, type SchemaLike } from "./schema.js";

// Context (session, needInput)
export { buildExecutionContext, type BuildContextOptions, type BuiltContext } from "./context.js";

// Telemetry (logger, metrics, reporter)
export {
  createTelemetryCollector,
  createLogger,
  TelemetryReporter,
  type TelemetryCollector,
  type TelemetryReporterOptions,
} from "./telemetry.js";

// Framework Adapters
export {
  pipeAiSdkStream,
  pipeOpenAiStream,
  pipeOpenAiResponsesStream,
  pipeLangGraphStream,
  pipeAsyncIterableStream,
} from "./adapters.js";

// Server
export { startAgentServer, type ServerOptions } from "./server.js";

// Banner
export { renderBanner, type BannerDetails } from "./banner.js";
