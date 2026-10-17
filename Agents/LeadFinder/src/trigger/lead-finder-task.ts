import { task, logger } from "@trigger.dev/sdk";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface LeadFinderPayload {
  query: string;
  targetCount?: number;
  maxRounds?: number;
  skipEnrich?: boolean;
}

export interface LeadFinderResponse {
  search_criteria: string;
  target_count: number;
  total_found: number;
  rounds_executed: number;
  stopped_reason: string;
  leads: Array<{
    title: string;
    primary_url: string;
    phone?: string;
    email?: string;
    contact_name?: string;
    location?: string;
    match_reason: string;
    social_links?: string[];
    attributes?: Record<string, any>;
  }>;
  jev_telemetry?: {
    satisfied?: boolean;
    confidence?: number;
    model?: string;
  };
  csv_content?: string;
}

/**
 * Trigger.dev Durable Long-Running Task: Lead Finder Agent
 * Handles up to 10 minutes of durable execution, immune to HTTP server timeouts.
 */
export const leadFinderTask = task({
  id: "lead-finder-agent",
  maxDuration: 600, // 10 minutes durable execution
  retry: {
    maxAttempts: 2,
    factor: 1.5,
    minTimeoutInMs: 2000,
  },
  run: async (payload: LeadFinderPayload): Promise<LeadFinderResponse> => {
    const target = payload.targetCount || 20;
    const maxRounds = payload.maxRounds || 4;
    const jsonOutput = `leads_${Date.now()}.json`;
    const csvOutput = `leads_${Date.now()}.csv`;

    logger.info("Starting durable LeadFinder background task", {
      query: payload.query,
      targetCount: target,
      maxRounds,
    });

    const scriptPath = resolve(process.cwd(), "main.py");
    const args = [
      "run",
      "python",
      scriptPath,
      "--query",
      payload.query,
      "--target",
      String(target),
      "--max-rounds",
      String(maxRounds),
      "--output-json",
      jsonOutput,
      "--output-csv",
      csvOutput,
    ];

    if (payload.skipEnrich) {
      args.push("--skip-enrich");
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn("uv", args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYDANTIC_AI_NO_BANNER: "1",
        },
      });

      child.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          logger.info(`[LeadFinder Engine] ${text}`);
        }
      });

      child.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          logger.warn(`[LeadFinder Stderr] ${text}`);
        }
      });

      child.on("close", async (code) => {
        if (code !== 0) {
          rejectPromise(new Error(`LeadFinder process exited with code ${code}`));
          return;
        }

        try {
          const jsonPath = resolve(process.cwd(), jsonOutput);
          const csvPath = resolve(process.cwd(), csvOutput);

          const jsonRaw = await readFile(jsonPath, "utf-8");
          const report: LeadFinderResponse = JSON.parse(jsonRaw);

          try {
            report.csv_content = await readFile(csvPath, "utf-8");
          } catch {
            // CSV optional
          }

          logger.info("LeadFinder task completed successfully", {
            totalFound: report.total_found,
            targetCount: report.target_count,
            rounds: report.rounds_executed,
            stoppedReason: report.stopped_reason,
            jevSatisfied: report.jev_telemetry?.satisfied,
          });

          resolvePromise(report);
        } catch (err: any) {
          rejectPromise(new Error(`Failed to parse LeadFinder output: ${err.message}`));
        }
      });

      child.on("error", (err) => {
        rejectPromise(new Error(`Failed to start LeadFinder process: ${err.message}`));
      });
    });
  },
});
