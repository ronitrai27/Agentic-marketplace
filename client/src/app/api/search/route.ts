import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { searchClient } from "@/lib/typesense";
import { searchAgents } from "@/lib/agent-search";

export type { SearchHit, SearchResponse } from "@/lib/agent-search";

export async function GET(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json({ exact: [], related: [], similar: [] });

  const client = searchClient();
  if (!client) {
    return NextResponse.json({ error: "Search is not configured." }, { status: 503 });
  }

  try {
    return NextResponse.json(await searchAgents(client, q));
  } catch {
    return NextResponse.json({ error: "Search failed." }, { status: 502 });
  }
}
