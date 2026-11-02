import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";

serve({ fetch: app.fetch, port: config.port }, (i) =>
  console.log(`Catelog MCP listening on http://localhost:${i.port}${new URL(config.publicUrl).pathname}`),
);
