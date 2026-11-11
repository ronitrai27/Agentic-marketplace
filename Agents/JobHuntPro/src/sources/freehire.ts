import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Job } from "../types.js";

let client: Client | undefined;
async function conn() {
  if (!client) {
    client = new Client({ name: "jobhuntpro", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://freehire.me/api/v1/mcp")));
  }
  return client;
}
export async function closeFreehire() {
  await client?.close().catch(() => {});
  client = undefined;
}

export async function searchFreehire(query: string, opts: { remote?: boolean; limit?: number; signal?: AbortSignal } = {}): Promise<Job[]> {
  const c = await conn();
  const args: Record<string, unknown> = { query, limit: opts.limit ?? 20, posted_within_days: 45 };
  if (opts.remote) args.work_mode = ["remote"];
  const res: any = await c.callTool({ name: "search_jobs", arguments: args }, undefined, { signal: opts.signal });
  const text = res.content?.find((x: any) => x.type === "text")?.text;
  if (!text || res.isError) throw new Error(`freehire: ${String(text).slice(0, 200)}`);
  const jobs: any[] = JSON.parse(text).jobs ?? [];
  return jobs.map((j) => ({
    key: "",
    title: j.title,
    company: j.company,
    location: [j.location, j.work_mode].filter(Boolean).join(" · "),
    url: j.url,
    source: "freehire" as const,
    description: String(j.summary ?? ""),
    skills: j.skills ?? [],
  }));
}
