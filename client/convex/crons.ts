import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Purge expired rate-limit sliding windows every 5 minutes
crons.interval(
  "cleanup-rate-windows",
  { minutes: 5 },
  internal.apiKeys.cleanupRateWindows,
);

export default crons;
