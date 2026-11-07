// Runs once when the server starts: open the Postgres checkpointer (creates tables on first run) before the first chat,
// so no user waits for it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getChefGraph } = await import("./chef/graph");
  const t = Date.now();
  getChefGraph()
    .then(() => console.log(`[chef] graph ready in ${Date.now() - t}ms`))
    .catch((e) => console.error("[chef] graph warm-up failed:", e instanceof Error ? e.message : e));

  // Same for search: create its tables and open a few connections now, so the first search is not the slow one.
  const { ensureSearchSchema, searchPool } = await import("./search/db");
  ensureSearchSchema()
    .then(() => Promise.all([1, 2, 3].map(() => searchPool().query("select 1"))))
    .then(() => console.log("[search] ready"))
    .catch((e) => console.error("[search] warm-up failed:", e instanceof Error ? e.message : e));
}
