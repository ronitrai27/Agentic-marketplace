import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { agents, search } from "./agents.mjs";

for (const [id, agent] of Object.entries(agents)) {
  test(id + " HTTP flow, citations and protected polling", async t => {
    const port = id === "contradictor" ? 18721 : 18722;
    const child = spawn(process.execPath, ["--import", "./test-provider.mjs", "server.mjs"], {
      cwd: import.meta.dirname, env: { ...process.env, PORT: String(port), JOB_DB: ":memory:",
        AGENT_KIND: id, GOOGLE_API_KEY: "fixture", GEMINI_MODEL: "fixture", CATELOG_SECRET_KEY: "cat_sec_fixture", CATELOG_TELEMETRY_DISABLED: "true" }
    });
    t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } });
    const call = (path, options) => fetch("http://127.0.0.1:" + port + path, options);
    let health;
    for (let i = 0; i < 50 && !health; i++) {
      try { health = await call("/health"); } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal((await health.json()).status, "ok");
    const manifest = await (await call("/schema")).json();
    assert.deepEqual(manifest.input_schema.required, [agent.field]);
    const headers = { authorization: "Bearer cat_sec_fixture" };
    const execute = input => call("/execute", { method: "POST", headers, body: JSON.stringify({ input }) });
    assert.equal((await execute({})).status, 400);
    const response = await execute({ [agent.field]: "A valid search query" });
    assert.equal(response.status, 202);
    const path = (await response.json()).poll_url;
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await (await call(path, { headers })).json();
      if (result.status !== "working") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(result.status, "completed");
    assert.equal(result.output.citations[0].sources[0].url, "https://example.com/evidence");
    assert.ok(result.events.length >= 2);
    assert.equal((await call(path)).status, 401);
  });
}
test("uncited provider result fails closed", async () => {
  await assert.rejects(search(agents.contradictor, "A valid claim", {
    GOOGLE_API_KEY: "fixture", GEMINI_MODEL: "fixture"
  }, async () => Response.json({ candidates: [] })), /no cited answer/);
});

