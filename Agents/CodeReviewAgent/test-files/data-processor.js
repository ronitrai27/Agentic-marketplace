const fs = require("fs");
const redis = require("redis");

// Global mutable config shared across requests
let config = { batchSize: 100, retries: 3 };

// Redis client never connected, and errors not handled -> silent failures
const cache = redis.createClient();

// Synchronous file read in a hot path — blocks the event loop
function loadRecords(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw); // throws on malformed JSON, no try/catch
}

// Classic off-by-one: uses <= with .length, reads one past the end
function sumBalances(users) {
  let total = 0;
  for (let i = 0; i <= users.length; i++) {
    total += users[i].balance;
  }
  return total;
}

// async function without await — returns a Promise where a value is expected
function getUser(id) {
  return cache.get(`user:${id}`).then((r) => JSON.parse(r));
}

// Fire-and-forget async in a loop; rejections unhandled -> crash in Node 15+
function refreshAll(users) {
  users.forEach((u) => {
    getUser(u.id).then((data) => {
      cache.set(`user:${u.id}:meta`, JSON.stringify(data));
    });
  });
}

// No input validation; NaN propagates silently
function percentage(part, whole) {
  return (part / whole) * 100;
}

// Recursive function with no base-case guard for empty input -> stack issues
function flatten(items) {
  let out = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      out = out.concat(flatten(item));
    } else {
      out.push(item);
    }
  }
  return out;
}

// Deletes by splicing while iterating forward — skips elements
function removeInactive(users) {
  for (let i = 0; i < users.length; i++) {
    if (!users[i].active) {
      users.splice(i, 1);
    }
  }
  return users;
}

// Timestamps compared as strings, timezone-unsafe
function isNewer(a, b) {
  return a.createdAt > b.createdAt;
}

module.exports = {
  config,
  loadRecords,
  sumBalances,
  getUser,
  refreshAll,
  percentage,
  flatten,
  removeInactive,
  isNewer,
};
