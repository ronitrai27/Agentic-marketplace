import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID || "proj_leadfinder_marketplace",
  dirs: ["./src/trigger"],
  maxDuration: 600, // 10 minutes maximum durable execution duration
});
