import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { ConvexHttpClient } from "convex/browser";
import { isAuthenticated } from "@/lib/auth-server";
import { searchRanked } from "@/search/query";
import { ensureIndexed, reconcileIndex } from "@/search/sync";
import type { SemanticResponse } from "@/lib/agent-search";

export type { SemanticResponse } from "@/lib/agent-search";

/**
 * The "by meaning" half of search: agent ids ranked by embeddings, words, tags and typos. The browser already
 * answered instantly from its own copy of the catalog, so this returns ids only (no database read, no payload).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json({ exact: [], related: [], similar: [] } satisfies SemanticResponse);

  // Cheap guard first (a session cookie must exist), so strangers cannot spend embeddings; the real check runs
  // alongside the search instead of before it.
  const hasSession = (await cookies()).getAll().some((c) => c.name.includes("session_token"));
  if (!hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!); // listForIndex is public
  try {
    const [authed, ranked] = await Promise.all([
      isAuthenticated(),
      ensureIndexed(convex).then(() => searchRanked(q, { exact: 4, related: 6, similar: 3, names: "light" })),
    ]);
    if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    after(() => reconcileIndex(convex)); // pick up edits made since the last search
    const ids = (g: { id: string }[]) => g.map((r) => r.id);
    return NextResponse.json({
      exact: ids(ranked.exact),
      related: ids(ranked.related),
      similar: ids(ranked.similar),
    } satisfies SemanticResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[search] failed:", msg);
    return NextResponse.json(
      { error: msg === "SEARCH_NOT_CONFIGURED" ? "Search is not configured." : "Search failed." },
      { status: msg === "SEARCH_NOT_CONFIGURED" ? 503 : 502 },
    );
  }
}
