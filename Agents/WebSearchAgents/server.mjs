import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createAgent, SqliteJobStore } from "catelog";
import { z } from "zod";
import { agents, search } from "./agents.mjs";

const id = process.env.AGENT_KIND;
const spec = Object.hasOwn(agents, id) ? agents[id] : null;
if (!spec) throw new Error("Set AGENT_KIND to contradictor or alternative-finder");
const ready = Boolean(process.env.CATELOG_SECRET_KEY && process.env.GOOGLE_API_KEY && process.env.GEMINI_MODEL);
const pricing = { model: "per_run", unit: "one_query", max_queries_per_run: 1 };
const agent = createAgent({
  id, name: spec.name, version: "1.0.0", mode: "async", maxTimeoutMinute: 1,
  jobStore: new SqliteJobStore({ path: process.env.JOB_DB || "jobs.sqlite" }),
  limits: { maxConcurrent: 3, maxBodyBytes: 8192, rateLimit: { max: 30, windowMs: 60000 } },
  inputSchema: z.object({ [spec.field]: z.string().min(5).max(500) }).strict(),
  outputSchema: z.object({
    answer: z.string(),
    citations: z.array(z.object({
      passage: z.string(),
      sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1)
    })).min(1)
  }),
  async execute({ input, stream, signal }) {
    stream.step("Searching for evidence");
    const output = await search(spec, input[spec.field], process.env, fetch, signal);
    stream.step("Collected cited results");
    return { output };
  }
});

const server = createServer((req, res) => {
  const path = req.url?.split("?")[0];
  const send = (status, data) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (path === "/health" && ["GET", "HEAD"].includes(req.method)) {
    return send(200, { status: ready ? "ok" : "degraded", protocol_version: "1.0.0", environment_ready: ready });
  }
  if (path === "/schema" && req.method === "GET") {
    return send(200, { ...agent.getManifest(), description: spec.description, pricing });
  }
  if (path === "/execute" && !ready) return send(503, { error: "Search provider or Catelog credentials are missing" });
  if (path?.startsWith("/tasks/")) {
    const expected = Buffer.from("Bearer " + process.env.CATELOG_SECRET_KEY);
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (!ready || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return send(401, { error: "Gateway authorization required" });
    }
  }
  void agent.handleRequest(req, res);
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0");

