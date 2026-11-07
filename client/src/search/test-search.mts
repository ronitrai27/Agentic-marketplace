import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { reconcileIndex } from "./sync";
import { searchRanked } from "./query";
import { searchPool } from "./db";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const rows = await convex.query(api.chefAgents.listForIndex, {});
const name = new Map(rows.map((r) => [r.id, `${r.name} (${r.slug})`]));
console.log("convex live agents:", rows.map((r) => r.slug));

let t = Date.now();
await reconcileIndex(convex, true);
console.log("first reconcile ms:", Date.now() - t);
t = Date.now();
await reconcileIndex(convex, true);
console.log("second reconcile (no changes) ms:", Date.now() - t);
console.log("index rows:", (await searchPool().query("select agent_id, slug from agent_search")).rows.map((r) => r.slug));

for (const q of ["nova research", "nova resea", "reserch", "best report agents", "i need agent for my report and research", "audit my website", "jobs", "xyzzy"]) {
  const t0 = Date.now();
  const r = await searchRanked(q, { exact: 4, related: 6, similar: 3 });
  const f = (g: { id: string; score: number }[]) => g.map((x) => `${name.get(x.id) ?? x.id}:${x.score.toFixed(3)}`);
  console.log(`\n"${q}" ${Date.now() - t0}ms\n  exact  ${f(r.exact)}\n  related ${f(r.related)}\n  similar ${f(r.similar)}`);
}
await searchPool().end();
