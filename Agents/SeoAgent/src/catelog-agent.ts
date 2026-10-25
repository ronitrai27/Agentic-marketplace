import { z } from "zod";
import { createAgent, type AgentExecutionContext } from "catelog";
import { createTemporalClient } from "./temporal/connection.js";
import { fullAuditWorkflow, type FullAuditWorkflowResult } from "./temporal/workflows/full-audit.workflow.js";
import { resolveAuditTarget } from "./core/target-resolver.js";
import { generateVerifiedExecutiveReport } from "./report.js";
import { env } from "./config/env.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Zod Schemas for Catelog Marketplace Protocol (MAPS)
// ─────────────────────────────────────────────────────────────────────────────

export const SeoAgentInputSchema = z.object({
  url: z
    .string()
    .optional()
    .describe("Website URL to audit (e.g. 'https://stripe.com' or 'stripe.com')"),
  prompt: z
    .string()
    .optional()
    .describe("Natural language query or command (e.g. 'Audit https://stripe.com for technical SEO')"),
  forceBrowser: z
    .boolean()
    .default(false)
    .optional()
    .describe("Force headless browser execution via Browserbase / Playwright regardless of JEV hydration check"),
});

export const SeoAgentOutputSchema = z.object({
  status: z.string().default("COMPLETED").describe("Execution status"),
  report: z.string().describe("Comprehensive Technical SEO & GEO Audit Report in Markdown"),
  targetUrl: z.string().optional().describe("Audited website URL"),
  metrics: z
    .record(z.string(), z.any())
    .optional()
    .describe("Key verified metrics (PageSpeed, SERP rank, citations)"),
});

export type SeoAgentInput = z.infer<typeof SeoAgentInputSchema>;
export type SeoAgentOutput = z.infer<typeof SeoAgentOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Catelog Agent Definition (Async Mode + Full SSE Event Streams)
// ─────────────────────────────────────────────────────────────────────────────

export const seoCatelogAgent = createAgent<SeoAgentInput, SeoAgentOutput>({
  id: "seo-geo-intelligence-agent",
  name: "Technical SEO & GEO Intelligence Agent",
  version: "1.0.0",
  mode: "async", // Returns 202 Accepted, executes via Temporal Cloud, exposes live events on /tasks/:id
  description:
    "Enterprise Technical SEO & GEO Intelligence agent powered by Temporal Cloud durable execution, JEV Hydration Gate, Browserbase cloud browser proof, Google PageSpeed CWV, and AI Search Engine citation analysis.",

  // Authentication keys auto-read from CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY env vars
  secretKey: env.CATELOG_SECRET_KEY,
  publicKey: env.CATELOG_PUBLIC_KEY,

  capabilities: {
    streaming: true,
    delta_stream: true,
    max_timeout_seconds: 300,
    execution_modes: ["async", "sync"],
  },

  inputSchema: SeoAgentInputSchema as any,
  outputSchema: SeoAgentOutputSchema as any,

  async execute({ input, stream, signal, runId, log, metric }: AgentExecutionContext<SeoAgentInput>) {
    const startTime = Date.now();
    log.info("Catelog task execution initiated", { runId, input });

    // Step 1: Resolve target URL
    stream.step("Inspecting target URL and resolving domain...");
    stream.progress(10, "Resolving target domain...");

    const rawQuery = input.url || input.prompt || "";
    if (!rawQuery.trim()) {
      throw new Error("INVALID_INPUT: Either 'url' or 'prompt' must be provided.");
    }

    const resolved = await resolveAuditTarget(rawQuery);
    const targetUrl = resolved.targetUrl || (rawQuery.startsWith("http") ? rawQuery : `https://${rawQuery}`);
    const companyName = resolved.companyName;

    stream.activity("target_resolved", {
      targetUrl,
      companyName,
      isAuditIntent: resolved.isAuditIntent,
    });
    metric.count("audit_targets_resolved", 1);

    if (signal.aborted) {
      throw new Error("EXECUTION_TIMEOUT");
    }

    // Step 2: Dispatch Temporal Cloud Workflow
    stream.step(`Dispatching durable full-audit workflow to Temporal Cloud queue: ${env.TEMPORAL_TASK_QUEUE}...`);
    stream.progress(25, "Dispatching to Temporal Cloud...");

    const client = await createTemporalClient();
    const safeHost = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, "-");
    const workflowId = `maps-audit-${safeHost}-${Date.now()}`;

    stream.activity("temporal_workflow_dispatched", {
      workflowId,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      namespace: env.TEMPORAL_NAMESPACE,
      forceBrowser: input.forceBrowser ?? false,
    });

    const handle = await client.workflow.start(fullAuditWorkflow, {
      args: [{ url: targetUrl, companyName, forceBrowser: input.forceBrowser }],
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
    });

    log.info("Temporal Cloud workflow active", { workflowId, targetUrl });

    // Step 3: Stream progress while waiting for Temporal durable activities
    stream.step("Executing parallel activities: Static Ingestion, Firecrawl Deep Scrape & JEV Hydration Gate...");
    stream.progress(45, "Crawling page & evaluating DOM discrepancies...");

    // Periodically update progress until completion
    const progressInterval = setInterval(() => {
      if (!stream.isClosed()) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        stream.activity("workflow_heartbeat", {
          workflowId,
          elapsedSeconds: elapsed,
          status: "RUNNING",
        });
      }
    }, 5000);

    let verifiedResult: FullAuditWorkflowResult;
    try {
      verifiedResult = await handle.result();
    } finally {
      clearInterval(progressInterval);
    }

    stream.step("Evaluating Google PageSpeed CWV, SerpApi rank & GEO AI citations...");
    stream.progress(75, "Assembling ground truth evidence...");

    stream.activity("audit_evidence_verified", {
      statusCode: verifiedResult.staticResult.statusCode,
      pageTitle: verifiedResult.staticResult.metadata.title,
      firecrawlSuccess: verifiedResult.firecrawlResult.success,
      jevEscalated: verifiedResult.escalationDecision.requiresBrowser,
      pageSpeedScore: verifiedResult.groundTruth.pageSpeed?.performanceScore ?? null,
      serpRank: verifiedResult.groundTruth.serp?.position ?? null,
      aiCited: verifiedResult.geoSemantic.geoCitation?.isDomainCited ?? false,
    });

    // Step 4: Synthesize Senior Director Executive Report
    stream.step("Synthesizing Executive Technical SEO & GEO Report...");
    stream.progress(90, "Synthesizing executive markdown report...");

    const report = await generateVerifiedExecutiveReport(verifiedResult);

    // Stream the final report tokens via SSE delta
    stream.delta(report, "text");
    stream.progress(100, "SEO & GEO Audit completed successfully");

    const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(1));
    metric.timing("audit_total_duration_ms", Date.now() - startTime);

    const output: SeoAgentOutput = {
      status: "COMPLETED",
      report,
      targetUrl,
      metrics: {
        pageSpeedScore: verifiedResult.groundTruth.pageSpeed?.performanceScore ?? "N/A",
        serpRank: verifiedResult.groundTruth.serp?.position ?? "Unranked",
        aiCited: verifiedResult.geoSemantic.geoCitation?.isDomainCited ?? false,
      },
    };

    return {
      output,
      telemetry: {
        temporal_workflow_id: workflowId,
        temporal_task_queue: env.TEMPORAL_TASK_QUEUE,
        duration_ms: Date.now() - startTime,
        target_url: targetUrl,
        jev_escalated: verifiedResult.escalationDecision.requiresBrowser,
        model_used: env.JEV_MODEL,
      },
    };
  },
});
