import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { searchClient } from "@/lib/typesense";

export type SearchHit = {
  id: string;
  name: string;
  description: string;
  logoUrl?: string;
  tags: string[];
  models: string[];
  ratingAvg: number;
  /** Highlighted name (<mark>…</mark>) when the query matched it. */
  nameHtml?: string;
};
export type SearchResponse = {
  exact: SearchHit[];
  related: SearchHit[];
  similar: SearchHit[];
};

const COLLECTION = "agents";
const FILTER = "status:=active";
const FIELDS = "name,description,logoUrl,tags,models,ratingAvg";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toHit(h: any): SearchHit {
  const d = h.document;
  const name = h.highlight?.name?.snippet as string | undefined;
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    logoUrl: d.logoUrl,
    tags: d.tags ?? [],
    models: d.models ?? [],
    ratingAvg: d.ratingAvg ?? 0,
    nameHtml: name,
  };
}

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
    // 1) exact: name/tag prefix with zero typos. 2) related: typo-tolerant keyword + semantic (hybrid).
    const res: any = await client.multiSearch.perform({
      searches: [
        {
          collection: COLLECTION,
          q,
          query_by: "name,tags",
          prefix: "true,false",
          num_typos: "0,0",
          filter_by: FILTER,
          include_fields: FIELDS,
          highlight_full_fields: "name",
          per_page: 4,
        },
        {
          collection: COLLECTION,
          q,
          query_by: "name,tagText,description,embedding",
          num_typos: "2,1,1,0",
          prefix: "true,true,false,false",
          vector_query: "embedding:([], k:12, alpha:0.5)",
          filter_by: FILTER,
          include_fields: FIELDS,
          highlight_full_fields: "name",
          per_page: 8,
        },
      ],
    });
    const exact = (res.results[0]?.hits ?? []).map(toHit) as SearchHit[];
    const seen = new Set(exact.map((h) => h.id));
    const related = ((res.results[1]?.hits ?? []).map(toHit) as SearchHit[])
      .filter((h) => !seen.has(h.id))
      .slice(0, 4);
    related.forEach((h) => seen.add(h.id));

    // 3) similar: nearest neighbours of the best hit's own embedding
    let similar: SearchHit[] = [];
    const top = exact[0] ?? related[0];
    if (top) {
      const sim: any = await client.multiSearch.perform({
        searches: [
          {
            collection: COLLECTION,
            q: "*",
            vector_query: `embedding:([], id:${top.id}, k:8)`,
            filter_by: FILTER,
            include_fields: FIELDS,
            per_page: 8,
          },
        ],
      });
      similar = ((sim.results[0]?.hits ?? []).map(toHit) as SearchHit[])
        .filter((h) => !seen.has(h.id))
        .slice(0, 3);
    }
    return NextResponse.json({ exact, related, similar } satisfies SearchResponse);
  } catch {
    return NextResponse.json({ error: "Search failed." }, { status: 502 });
  }
}
