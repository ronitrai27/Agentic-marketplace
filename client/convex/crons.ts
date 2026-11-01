import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Purge expired rate-limit sliding windows every 5 minutes
crons.interval(
  "cleanup-rate-windows",
  { minutes: 5 },
  internal.apiKeys.cleanupRateWindows,
);

// Fix any drift between Convex and the Typesense search index
crons.daily("resync-search-index", { hourUTC: 3, minuteUTC: 0 }, internal.search.backfill);

export default crons;
