import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Purge expired rate-limit sliding windows every 5 minutes
crons.interval(
  "cleanup-rate-windows",
  { minutes: 5 },
  internal.apiKeys.cleanupRateWindows,
);

// Abort runs past their agent's max timeout (dead worker / lost workflow)
crons.interval("reap-stale-runs", { minutes: 1 }, internal.runs.reapStale);

// Remove agents archived for over 24h (creators can mark them active again before that)
crons.interval("purge-archived-agents", { hours: 24 }, internal.agents.purgeArchived);

export default crons;
