import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { callBackend } from "../backend.js";
import { config } from "../config.js";

type RunState =
  | "pending_approval"
  | "denied"
  | "expired"
  | "failed"
  | "queued"
  | "running"
  | "succeeded"
  | "cancelled";

type RunStatus =
  | { found: false }
  | {
      found: true;
      state: RunState;
      requestId?: string | null;
      runId?: string;
      agentName: string;
      holdCredits: number | null;
      chargedCredits?: number | null;
      progressPct?: number | null;
      lastEvent?: { type: string; data: string } | null;
      error?: { code: string; message: string } | null;
      message?: string | null;
      expiresAt?: number;
      done?: boolean;
      outputJson?: string | null;
      outputTruncated?: boolean;
    };

type RunAgentResult =
  | { ok: false; code: string; message: string }
  | { ok: true; state: "started"; runId: string; agentName: string; holdCredits: number }
  | { ok: true; state: "pending_approval"; requestId: string; agentName: string; holdCredits: number; expiresAt: number };

const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FINAL = new Set<RunState>(["denied", "expired", "failed", "succeeded", "cancelled"]);

type Auth = { error: CallToolResult; userId?: undefined; clientId?: undefined } | { error?: undefined; userId: string; clientId?: string };

function auth(ctx: ServerContext): Auth {
  const info = ctx.http?.authInfo;
  const userId = info?.extra?.userId;
  if (typeof userId !== "string") return { error: fail("Not authenticated.") };
  if (!info?.scopes?.includes("runs:execute")) {
    return {
      error: fail(
        "This connection was not granted permission to run agents. Ask the user to disconnect and reconnect the Catelog MCP server and allow 'Ask to run agents'.",
      ),
    };
  }
  return { userId, clientId: info.clientId };
}

const approvalUrl = (id: string) => `${config.webUrl}/space/approvals?id=${encodeURIComponent(id)}`;
const credits = (n: number | null | undefined) => (n == null ? "?" : `${n} credits ($${(n / 100).toFixed(2)})`);

function describe(s: Extract<RunStatus, { found: true }>): string {
  switch (s.state) {
    case "pending_approval":
      return (
        `WAITING FOR THE USER'S APPROVAL: ${s.agentName} (up to ${credits(s.holdCredits)}).\n` +
        `Tell the user to open ${approvalUrl(s.requestId ?? "")} and click Approve. ` +
        `You cannot approve it yourself. Do not send the request again. Check back with get_run (id: ${s.requestId}).`
      );
    case "denied":
      return `The user DENIED this run. Do not retry it unless they ask you to.${s.message ? ` (${s.message})` : ""}`;
    case "expired":
      return "The approval request EXPIRED before the user answered. Call run_agent again if they still want it.";
    case "queued":
    case "running":
      return (
        `${s.agentName} is ${s.state}${s.progressPct != null ? ` (${Math.round(s.progressPct)}%)` : ""}. ` +
        `Held: ${credits(s.holdCredits)}. Call get_run again (id: ${s.runId}) with wait_seconds to wait for the result.` +
        (s.lastEvent ? `\nLatest event: ${s.lastEvent.type} ${s.lastEvent.data}` : "")
      );
    case "succeeded":
      return (
        `${s.agentName} SUCCEEDED. Charged ${credits(s.chargedCredits)}.\n` +
        `Output${s.outputTruncated ? " (truncated)" : ""}:\n${s.outputJson ?? "(no output)"}`
      );
    case "failed":
    case "cancelled":
      return `${s.agentName} ${s.state.toUpperCase()}: ${s.error?.message ?? s.message ?? "no details"}. Nothing was charged.`;
  }
}

export function registerRunTools(server: McpServer) {
  server.registerTool(
    "run_agent",
    {
      description:
        "Run a Catelog marketplace agent for the user. Workflow: discover_agents -> get_agents_schema -> run_agent -> get_run. " +
        "`input` MUST follow the agent's input JSON Schema from get_agents_schema (never guess fields; ask the user for missing values). " +
        "HUMAN APPROVAL: the user approves every run (and its maximum cost) themselves in Catelog, unless they set an auto-approve limit. " +
        "Usually this returns `pending_approval` with a link: show the link to the user, ask them to approve, then poll get_run. " +
        "You cannot approve for them. Never call run_agent twice for the same task: use get_run with the returned id. " +
        "Costs credits (100 credits = $1) only after approval, and only for runs that finish successfully.",
      inputSchema: z.object({
        slug: z.string().min(1).max(100).describe("Agent slug from discover_agents."),
        input: z.record(z.string(), z.unknown()).describe("The agent's input object, matching its input JSON Schema."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ slug, input }, ctx): Promise<CallToolResult> => {
      const a = auth(ctx);
      if (a.error) return a.error;
      try {
        const r = await callBackend<RunAgentResult>("/mcp/run-agent", {
          userId: a.userId,
          slug,
          input,
          clientName: a.clientId,
        });
        if (!r.ok) return fail(`Could not start the run: ${r.message}`);
        if (r.state === "started") {
          return {
            content: [
              {
                type: "text",
                text: `Started ${r.agentName} (auto-approved by the user's limit, up to ${credits(r.holdCredits)} held). Run id: ${r.runId}. Call get_run with wait_seconds to get the result.`,
              },
            ],
            structuredContent: r,
          };
        }
        const text = describe({
          found: true,
          state: "pending_approval",
          requestId: r.requestId,
          agentName: r.agentName,
          holdCredits: r.holdCredits,
          expiresAt: r.expiresAt,
        });
        return {
          content: [{ type: "text", text }],
          structuredContent: { ...r, approvalUrl: approvalUrl(r.requestId) },
        };
      } catch (e) {
        console.error("run_agent failed:", e);
        return fail("Could not request the run right now.");
      }
    },
  );

  server.registerTool(
    "get_run",
    {
      description:
        "Check a run requested with run_agent: waiting for approval, queued, running, or finished (with the agent's output). " +
        "Pass the `requestId` or `runId` returned by run_agent. Set `wait_seconds` (up to 30) to wait for a change before answering, " +
        "so you do not need to poll in a tight loop. Read-only and free.",
      inputSchema: z.object({
        id: z.string().min(1).max(64).describe("requestId or runId from run_agent."),
        wait_seconds: z.number().int().min(0).max(30).optional().describe("Wait up to this long for the run to finish or be decided. Default 0."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, wait_seconds }, ctx): Promise<CallToolResult> => {
      const a = auth(ctx);
      if (a.error) return a.error;
      try {
        const deadline = Date.now() + (wait_seconds ?? 0) * 1000;
        let s: RunStatus = await callBackend<RunStatus>("/mcp/run-status", { userId: a.userId, id });
        const first = s.found ? s.state : null;
        // Wait while nothing has changed and the run is not finished
        while (s.found && !FINAL.has(s.state) && Date.now() < deadline) {
          await sleep(2000);
          s = await callBackend<RunStatus>("/mcp/run-status", { userId: a.userId, id });
          if (s.found && s.state !== first && s.state !== "running") break;
        }
        if (!s.found) return fail("No run or request with that id for this user.");
        return { content: [{ type: "text", text: describe(s) }], structuredContent: s };
      } catch (e) {
        console.error("get_run failed:", e);
        return fail("Could not load the run right now.");
      }
    },
  );
}
