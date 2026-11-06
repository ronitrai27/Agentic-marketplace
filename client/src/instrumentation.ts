// Runs once when the server starts: open the Postgres checkpointer (creates tables on first run) before the first chat,
// so no user waits for it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getChefGraph } = await import("./chef/graph");
  const t = Date.now();
  getChefGraph()
    .then(() => console.log(`[chef] graph ready in ${Date.now() - t}ms`))
    .catch((e) => console.error("[chef] graph warm-up failed:", e instanceof Error ? e.message : e));
}
