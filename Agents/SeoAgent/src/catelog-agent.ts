import { z } from "zod";
import { createAgent, type AgentExecutionContext } from "catelog";
import type { Client } from "@temporalio/client";
import { createTemporalClient } from "./temporal/connection.js";
import { awaitWorkflow, rootCauseMessage, WorkflowRunError, type WorkflowSnapshot } from "./temporal/await-workflow.js";
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Whole-audit ceiling enforced by Temporal itself (shows up as TIMED_OUT, never a silent hang). */
const WORKFLOW_EXECUTION_TIMEOUT = "10 minutes";
/** A cold worker (big bundle, small CPU) can need more than Temporal's 10s default for a workflow task. */
const WORKFLOW_TASK_TIMEOUT = "30 seconds";

/** Coded error: the Catelog SDK forwards `code` / `retryable` to the buyer as-is. */
function agentError(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

let temporalClient: Promise<Client> | undefined;

/** One shared connection instead of a new gRPC channel per run. Reconnects after a failure. */
function getTemporalClient(): Promise<Client> {
  temporalClient ??= createTemporalClient().catch((err) => {
    temporalClient = undefined;
    throw err;
  });
  return temporalClient;
}

/** Which audit phase a running activity belongs to (drives an honest progress bar). */
const ACTIVITY_PHASES: Record<string, { pct: number; label: string }> = {
  staticCrawlActivity: { pct: 30, label: "Crawling page (static ingestion)..." },
  firecrawlScrapeActivity: { pct: 35, label: "Deep-scraping page with Firecrawl..." },
  escalationGateActivity: { pct: 45, label: "Running JEV hydration gate..." },
  collectBrowserEvidenceActivity: { pct: 55, label: "Collecting cloud-browser evidence..." },
  groundTruthActivity: { pct: 65, label: "Fetching PageSpeed CWV & SERP rank..." },
  geoSemanticActivity: { pct: 68, label: "Checking AI-engine citations..." },
  linkGraphActivity: { pct: 70, label: "Analysing internal link graph..." },
};

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
    max_timeout_seconds: 600,
    execution_modes: ["async"],
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
      throw agentError("INVALID_INPUT", "Either 'url' or 'prompt' must be provided.");
    }

    let resolved: Awaited<ReturnType<typeof resolveAuditTarget>>;
    try {
      resolved = await resolveAuditTarget(rawQuery);
    } catch (err) {
      throw agentError("INVALID_INPUT", `Could not work out which site to audit: ${rootCauseMessage(err)}`);
    }
    const targetUrl = resolved.targetUrl || (rawQuery.startsWith("http") ? rawQuery : `https://${rawQuery}`);
    try {
      new URL(targetUrl);
    } catch {
      throw agentError("INVALID_INPUT", `"${rawQuery}" is not a valid website URL.`);
    }
    const companyName = resolved.companyName;

    stream.activity("target_resolved", {
      targetUrl,
      companyName,
      isAuditIntent: resolved.isAuditIntent,
    });
    metric.count("audit_targets_resolved", 1);

    if (signal.aborted) {
      throw agentError("TASK_CANCELED", "The audit was cancelled before it started.");
    }

    // Step 2: Dispatch Temporal Cloud Workflow
    stream.step(`Dispatching durable full-audit workflow to Temporal Cloud queue: ${env.TEMPORAL_TASK_QUEUE}...`);
    stream.progress(25, "Dispatching to Temporal Cloud...");

    let client: Client;
    try {
      client = await getTemporalClient();
    } catch (err) {
      throw agentError("TEMPORAL_UNAVAILABLE", `Cannot reach Temporal: ${rootCauseMessage(err)}`, true);
    }

    const safeHost = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, "-");
    const workflowId = `maps-audit-${safeHost}-${Date.now()}`;

    stream.activity("temporal_workflow_dispatched", {
      workflowId,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      namespace: env.TEMPORAL_NAMESPACE,
      forceBrowser: input.forceBrowser ?? false,
    });

    let handle;
    try {
      handle = await client.workflow.start(fullAuditWorkflow, {
        args: [{ url: targetUrl, companyName, forceBrowser: input.forceBrowser }],
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId,
        workflowExecutionTimeout: WORKFLOW_EXECUTION_TIMEOUT,
        workflowTaskTimeout: WORKFLOW_TASK_TIMEOUT,
      });
    } catch (err) {
      throw agentError("TEMPORAL_UNAVAILABLE", `Could not start the audit workflow: ${rootCauseMessage(err)}`, true);
    }

    log.info("Temporal Cloud workflow active", { workflowId, targetUrl });

    // Step 3: Watch the workflow for real. Every few seconds we ask Temporal what it is doing,
    // stream that to the buyer, and fail immediately if it is terminated / cancelled / timed out / stuck.
    stream.step("Executing parallel activities: Static Ingestion, Firecrawl Deep Scrape & JEV Hydration Gate...");
    stream.progress(30, "Audit workflow running on Temporal...");

    let highestPct = 30;
    let lastLabel = "";
    const retryAlerted = new Set<string>();
    let workerSlowAlerted = false;

    const onSnapshot = (snap: WorkflowSnapshot) => {
      stream.activity("workflow_heartbeat", {
        workflowId,
        status: snap.status,
        elapsedSeconds: snap.elapsedSeconds,
        historyLength: snap.historyLength,
        running: snap.pendingActivities.map((a) => a.name),
      });

      for (const act of snap.pendingActivities) {
        const phase = ACTIVITY_PHASES[act.name];
        if (phase && phase.pct >= highestPct && phase.label !== lastLabel) {
          highestPct = phase.pct;
          lastLabel = phase.label;
          stream.progress(phase.pct, phase.label);
        }

        // Surface activity retries together with their error so failures are never invisible
        const retryKey = `${act.name}#${act.attempt}`;
        if (act.attempt > 1 && act.lastError && !retryAlerted.has(retryKey)) {
          retryAlerted.add(retryKey);
          log.warn("Temporal activity retrying", { activity: act.name, attempt: act.attempt, error: act.lastError });
          stream.activity("activity_retrying", { activity: act.name, attempt: act.attempt, error: act.lastError });
        }
      }

      if (snap.workflowTaskAttempt > 1 && !workerSlowAlerted) {
        workerSlowAlerted = true;
        log.warn("Temporal worker is slow to answer", { workflowId, attempt: snap.workflowTaskAttempt });
        stream.activity("worker_not_responding", { workflowId, attempt: snap.workflowTaskAttempt });
      }
    };

    let verifiedResult: FullAuditWorkflowResult;
    try {
      verifiedResult = await awaitWorkflow<FullAuditWorkflowResult>(handle, { signal, onSnapshot });
    } catch (err) {
      const code = err instanceof WorkflowRunError ? err.code : "TOOL_FAILURE";
      log.error("Audit workflow did not complete", { workflowId, code, error: rootCauseMessage(err) });
      metric.count("audit_workflow_failures", 1);
      stream.activity("workflow_failed", { workflowId, code, message: rootCauseMessage(err) });
      if (err instanceof WorkflowRunError) throw err;
      throw agentError("TOOL_FAILURE", `Audit workflow failed: ${rootCauseMessage(err)}`);
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

    let report: string;
    try {
      report = await generateVerifiedExecutiveReport(verifiedResult);
    } catch (err) {
      throw agentError(
        "REPORT_FAILED",
        `Audit data was collected but the report could not be written: ${rootCauseMessage(err)}`,
        true,
      );
    }

    // Stream the final report in chunks via SSE deltas
    const CHUNK_SIZE = 500;
    for (let i = 0; i < report.length; i += CHUNK_SIZE) {
      stream.delta(report.slice(i, i + CHUNK_SIZE), "text");
    }
    stream.progress(100, "SEO & GEO Audit completed successfully");

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
