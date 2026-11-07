import { z } from "zod";
import { createAgent, type AgentExecutionContext } from "catelog";
import type { Client } from "@temporalio/client";
import { createTemporalClient } from "./temporal/connection.js";
import {
  awaitWorkflow,
  rootCauseMessage,
  WorkflowRunError,
  type ActivityEvent,
  type WorkflowSnapshot,
} from "./temporal/await-workflow.js";
import {
  fullAuditWorkflow,
  type FullAuditWorkflowResult,
} from "./temporal/workflows/full-audit.workflow.js";
import { resolveAuditTarget } from "./core/target-resolver.js";
import {
  generateVerifiedExecutiveReport,
  generateChatReply,
} from "./report.js";
import { UsageTracker } from "./core/usage.js";
import { env } from "./config/env.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Zod Schemas for Catelog Marketplace Protocol (MAPS)
// ─────────────────────────────────────────────────────────────────────────────

export const SeoAgentInputSchema = z.object({
  url: z
    .string()
    .optional()
    .describe(
      "Website URL to audit (e.g. 'https://stripe.com' or 'stripe.com')",
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      "Natural language query or command (e.g. 'Audit https://stripe.com for technical SEO')",
    ),
  forceBrowser: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      "Force headless browser execution via Browserbase / Playwright regardless of JEV hydration check",
    ),
});

export const SeoAgentOutputSchema = z.object({
  status: z.string().default("COMPLETED").describe("Execution status"),
  report: z
    .string()
    .describe("Comprehensive Technical SEO & GEO Audit Report in Markdown"),
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

/** The agent's hard limit for one run (see `maxTimeoutMinute`). */
const MAX_RUN_MINUTES = 5;
/**
 * Whole-audit ceiling enforced by Temporal itself (shows up as TIMED_OUT, never a silent hang). It is 30 seconds
 * under the run limit, so there is still time to write the report once the evidence is in.
 */
const WORKFLOW_EXECUTION_TIMEOUT = `${MAX_RUN_MINUTES * 60 - 30} seconds`;
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

/**
 * The audit, one row per Temporal activity. `start` is the progress shown when it begins and `done` when it ends,
 * so the bar moves at each real milestone and never goes backwards (parallel activities finish in any order).
 */
const PHASES: Record<
  string,
  { label: string; start: number; done: number; doneLabel: string }
> = {
  staticCrawlActivity: {
    label: "Crawling the page (static ingestion)",
    start: 25,
    done: 35,
    doneLabel: "Static crawl finished",
  },
  firecrawlScrapeActivity: {
    label: "Deep-scraping the page with Firecrawl",
    start: 25,
    done: 42,
    doneLabel: "Firecrawl scrape finished",
  },
  escalationGateActivity: {
    label: "Checking whether a real browser is needed (JEV)",
    start: 44,
    done: 50,
    doneLabel: "Browser check decided",
  },
  collectBrowserEvidenceActivity: {
    label: "Collecting cloud-browser evidence",
    start: 52,
    done: 62,
    doneLabel: "Browser evidence collected",
  },
  groundTruthActivity: {
    label: "Fetching PageSpeed Core Web Vitals and SERP rank",
    start: 64,
    done: 74,
    doneLabel: "PageSpeed and SERP rank ready",
  },
  geoSemanticActivity: {
    label: "Checking AI-engine citations",
    start: 64,
    done: 80,
    doneLabel: "AI-engine citation check finished",
  },
  linkGraphActivity: {
    label: "Analysing the internal link graph",
    start: 64,
    done: 84,
    doneLabel: "Link graph analysed",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Catelog Agent Definition (Async Mode + Full SSE Event Streams)
// ─────────────────────────────────────────────────────────────────────────────

export const seoCatelogAgent = createAgent<SeoAgentInput, SeoAgentOutput>({
  id: "seo-geo-intelligence-agent",
  name: "Henry",
  version: "1.2.0",
  mode: "async", // Returns 202 Accepted, executes via Temporal Cloud, exposes live events on /tasks/:id

  // Authentication keys auto-read from CATELOG_SECRET_KEY / CATELOG_PUBLIC_KEY env vars
  secretKey: env.CATELOG_SECRET_KEY,
  publicKey: env.CATELOG_PUBLIC_KEY,

  maxTimeoutMinute: MAX_RUN_MINUTES, // the audit workflow stops 30 seconds earlier (WORKFLOW_EXECUTION_TIMEOUT)

  capabilities: {
    streaming: true,
    delta_stream: true,
    execution_modes: ["async"],
  },

  inputSchema: SeoAgentInputSchema as any,
  outputSchema: SeoAgentOutputSchema as any,

  async execute({
    input,
    stream,
    signal,
    runId,
    log,
    metric,
    usage: ctxUsage,
  }: AgentExecutionContext<SeoAgentInput>) {
    const startTime = Date.now();
    log.info("Catelog task execution initiated", { runId, input });

    // Progress only ever moves forward. (`stream.step` is not used: on a live SSE connection it sends 0%.)
    let pct = 0;
    const bump = (to: number, label: string) => {
      pct = Math.max(pct, to);
      stream.progress(pct, label);
    };

    // Step 1: Resolve target URL
    bump(5, "Resolving the target website...");

    const rawQuery = input.url || input.prompt || "";
    if (!rawQuery.trim()) {
      throw agentError(
        "INVALID_INPUT",
        "Either 'url' or 'prompt' must be provided.",
      );
    }

    const usage = new UsageTracker(ctxUsage);
    let resolved: Awaited<ReturnType<typeof resolveAuditTarget>>;
    try {
      resolved = await resolveAuditTarget(rawQuery, usage);
    } catch (err) {
      throw agentError(
        "INVALID_INPUT",
        `Could not work out which site to audit: ${rootCauseMessage(err)}`,
      );
    }

    // JEV said this is not an audit request (e.g. "hello") → chat back, no audit, no report prefix.
    // An explicit `url` input is always treated as an audit request.
    if (!input.url && !resolved.isAuditIntent) {
      bump(40, "Not an audit request, replying conversationally...");
      let reply: string;
      try {
        reply = await generateChatReply(rawQuery, usage);
      } catch (err) {
        throw agentError(
          "REPORT_FAILED",
          `Could not generate a reply: ${rootCauseMessage(err)}`,
          true,
        );
      }
      stream.delta(reply, "text");
      stream.progress(100, "Replied");
      metric.timing("audit_total_duration_ms", Date.now() - startTime);
      return {
        output: { status: "COMPLETED", report: reply },
        telemetry: {
          duration_ms: Date.now() - startTime,
          intent: "chat",
          ...usage.telemetry(),
        },
      };
    }

    const targetUrl =
      resolved.targetUrl ||
      (rawQuery.startsWith("http") ? rawQuery : `https://${rawQuery}`);
    try {
      new URL(targetUrl);
    } catch {
      throw agentError(
        "INVALID_INPUT",
        `"${rawQuery}" is not a valid website URL.`,
      );
    }
    const companyName = resolved.companyName;

    stream.activity("target_resolved", {
      targetUrl,
      companyName,
      isAuditIntent: resolved.isAuditIntent,
    });
    bump(12, `Target resolved: ${new URL(targetUrl).hostname}`);
    metric.count("audit_targets_resolved", 1);

    if (signal.aborted) {
      throw agentError(
        "TASK_CANCELED",
        "The audit was cancelled before it started.",
      );
    }

    // Step 2: Dispatch Temporal Cloud Workflow
    bump(18, "Dispatching the audit to Temporal Cloud...");

    let client: Client;
    try {
      client = await getTemporalClient();
    } catch (err) {
      throw agentError(
        "TEMPORAL_UNAVAILABLE",
        `Cannot reach Temporal: ${rootCauseMessage(err)}`,
        true,
      );
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
        args: [
          { url: targetUrl, companyName, forceBrowser: input.forceBrowser },
        ],
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId,
        workflowExecutionTimeout: WORKFLOW_EXECUTION_TIMEOUT,
        workflowTaskTimeout: WORKFLOW_TASK_TIMEOUT,
      });
    } catch (err) {
      throw agentError(
        "TEMPORAL_UNAVAILABLE",
        `Could not start the audit workflow: ${rootCauseMessage(err)}`,
        true,
      );
    }

    log.info("Temporal Cloud workflow active", { workflowId, targetUrl });
    bump(22, "Audit workflow started");

    // Step 3: Watch the workflow for real. Temporal's history tells us when every activity starts, finishes or
    // fails (one event each, in order), and a periodic check reports retries and a stuck worker. We fail at once
    // if the workflow is terminated / cancelled / timed out / stuck.
    const onActivity = (e: ActivityEvent) => {
      const phase = PHASES[e.name];
      const label = phase?.label ?? e.name;
      if (e.kind === "started") {
        if (phase) bump(phase.start, `${label}...`);
        stream.activity("activity_started", { activity: e.name, label });
      } else if (e.kind === "completed") {
        const secs =
          e.durationMs !== undefined
            ? ` (${(e.durationMs / 1000).toFixed(1)}s)`
            : "";
        if (phase) bump(phase.done, `${phase.doneLabel}${secs}`);
        stream.activity("activity_completed", {
          activity: e.name,
          label,
          durationMs: e.durationMs ?? null,
        });
        if (e.durationMs !== undefined)
          metric.timing(`activity_${e.name}_ms`, e.durationMs);
      } else {
        log.error("Temporal activity failed", {
          activity: e.name,
          error: e.error,
        });
        stream.activity("activity_failed", {
          activity: e.name,
          label,
          durationMs: e.durationMs ?? null,
          error: e.error ?? "Activity failed",
        });
      }
    };

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
        // Surface activity retries together with their error so failures are never invisible
        const retryKey = `${act.name}#${act.attempt}`;
        if (act.attempt > 1 && act.lastError && !retryAlerted.has(retryKey)) {
          retryAlerted.add(retryKey);
          log.warn("Temporal activity retrying", {
            activity: act.name,
            attempt: act.attempt,
            error: act.lastError,
          });
          stream.activity("activity_retrying", {
            activity: act.name,
            attempt: act.attempt,
            error: act.lastError,
          });
        }
      }

      if (snap.workflowTaskAttempt > 1 && !workerSlowAlerted) {
        workerSlowAlerted = true;
        log.warn("Temporal worker is slow to answer", {
          workflowId,
          attempt: snap.workflowTaskAttempt,
        });
        stream.activity("worker_not_responding", {
          workflowId,
          attempt: snap.workflowTaskAttempt,
        });
      }
    };

    let verifiedResult: FullAuditWorkflowResult;
    try {
      verifiedResult = await awaitWorkflow<FullAuditWorkflowResult>(handle, {
        signal,
        onSnapshot,
        onActivity,
      });
    } catch (err) {
      const code = err instanceof WorkflowRunError ? err.code : "TOOL_FAILURE";
      log.error("Audit workflow did not complete", {
        workflowId,
        code,
        error: rootCauseMessage(err),
      });
      metric.count("audit_workflow_failures", 1);
      stream.activity("workflow_failed", {
        workflowId,
        code,
        message: rootCauseMessage(err),
      });
      if (err instanceof WorkflowRunError) throw err;
      throw agentError(
        "TOOL_FAILURE",
        `Audit workflow failed: ${rootCauseMessage(err)}`,
      );
    }

    bump(86, "All evidence collected, checking it...");

    // What each pillar found, as separate events a buyer's screen can show as it goes
    const ev = verifiedResult;
    stream.activity("pillar_result", {
      pillar: "static_crawl",
      statusCode: ev.staticResult.statusCode,
      title: ev.staticResult.metadata.title ?? null,
      fetchMs: ev.staticResult.timing.totalDurationMs,
    });
    stream.activity("pillar_result", {
      pillar: "firecrawl",
      success: ev.firecrawlResult.success,
      title: ev.firecrawlResult.title ?? null,
    });
    stream.activity("pillar_result", {
      pillar: "browser_check",
      browserRequired: ev.escalationDecision.requiresBrowser,
      reasons: ev.escalationDecision.reasons,
      domDiscrepancies: ev.browserEvidence?.domDiff.discrepancies.length ?? 0,
    });
    stream.activity("pillar_result", {
      pillar: "pagespeed",
      performanceScore: ev.groundTruth.pageSpeed?.performanceScore ?? null,
      lcpMs: ev.groundTruth.pageSpeed?.coreWebVitals?.lcpMs ?? null,
      cls: ev.groundTruth.pageSpeed?.coreWebVitals?.cls ?? null,
    });
    stream.activity("pillar_result", {
      pillar: "serp",
      position: ev.groundTruth.serp?.position ?? null,
    });
    stream.activity("pillar_result", {
      pillar: "ai_citations",
      isDomainCited: ev.geoSemantic.geoCitation?.isDomainCited ?? false,
      engine: ev.geoSemantic.geoCitation?.aiEngine ?? null,
      cannibalizationIssues: ev.geoSemantic.cannibalizationIssues.length,
    });
    stream.activity("pillar_result", {
      pillar: "link_graph",
      orphanPages: ev.linkGraph.orphanPages.length,
      deepPages: ev.linkGraph.deepPages.length,
    });

    stream.activity("audit_evidence_verified", {
      statusCode: verifiedResult.staticResult.statusCode,
      pageTitle: verifiedResult.staticResult.metadata.title,
      firecrawlSuccess: verifiedResult.firecrawlResult.success,
      jevEscalated: verifiedResult.escalationDecision.requiresBrowser,
      pageSpeedScore:
        verifiedResult.groundTruth.pageSpeed?.performanceScore ?? null,
      serpRank: verifiedResult.groundTruth.serp?.position ?? null,
      aiCited: verifiedResult.geoSemantic.geoCitation?.isDomainCited ?? false,
    });

    // Step 4: Synthesize Senior Director Executive Report
    bump(88, "Writing the executive SEO & GEO report...");
    stream.activity("report_started", { model: "gpt-4.1-mini" });
    const reportStarted = Date.now();

    let report: string;
    try {
      report = await generateVerifiedExecutiveReport(verifiedResult, usage);
    } catch (err) {
      throw agentError(
        "REPORT_FAILED",
        `Audit data was collected but the report could not be written: ${rootCauseMessage(err)}`,
        true,
      );
    }

    bump(97, "Report written");
    stream.activity("report_completed", {
      durationMs: Date.now() - reportStarted,
      characters: report.length,
    });

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
        pageSpeedScore:
          verifiedResult.groundTruth.pageSpeed?.performanceScore ?? "N/A",
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
        ...usage.telemetry(),
      },
    };
  },
});
