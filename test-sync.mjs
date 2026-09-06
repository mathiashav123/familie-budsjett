/**
 * Unit tests for sync-core pure helpers
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Sync = require("./sync-core.js");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    console.log("  ✗", msg);
  }
}

console.log("\n=== Familiebudsjett sync-core tests ===\n");

assert(Sync.normalizeInviteCode(" ab-12 ") === "AB12", "normalize invite");
assert(Sync.generateInviteCode(8).length === 8, "invite length");

assert(!Sync.hasMeaningfulLocalData(null), "null empty");
assert(!Sync.hasMeaningfulLocalData({ categories: [], months: {} }), "empty state");
assert(Sync.hasMeaningfulLocalData({ categories: [{ id: "1" }], months: {} }), "has categories");
assert(
  Sync.hasMeaningfulLocalData({
    categories: [],
    months: { "2026-09": { expenses: [{ amount: 10 }] } }
  }),
  "has expenses"
);

{
  const d1 = Sync.decideSyncAction({
    cloudUpdatedAt: "2026-09-06T10:00:00.000Z",
    localChangeAt: "2026-09-06T09:00:00.000Z",
    lastSyncedCloudAt: "2026-09-06T08:00:00.000Z"
  });
  assert(d1.action === "pull" || d1.prefer === "cloud", "cloud newer => pull/cloud prefer: " + d1.action);
}

{
  const d2 = Sync.decideSyncAction({
    cloudUpdatedAt: "2026-09-06T08:00:00.000Z",
    localChangeAt: "2026-09-06T10:00:00.000Z",
    lastSyncedCloudAt: "2026-09-06T08:00:00.000Z",
    lastPullAt: "2026-09-06T08:00:00.000Z"
  });
  assert(d2.action === "push", "local dirty => push: " + d2.action);
}

{
  const d3 = Sync.decideSyncAction({
    cloudUpdatedAt: "2026-09-06T11:00:00.000Z",
    localChangeAt: "2026-09-06T10:30:00.000Z",
    lastSyncedCloudAt: "2026-09-06T09:00:00.000Z",
    lastPullAt: "2026-09-06T09:00:00.000Z"
  });
  assert(d3.action === "conflict" && d3.prefer === "cloud", "conflict prefers cloud: " + d3.action);
}

{
  const st = Sync.syncStatusLabel({}, false);
  assert(st.label === "Kun lokalt", "unconfigured => Kun lokalt");
}
{
  const st = Sync.syncStatusLabel(
    { userId: "u1", username: "mathias", householdId: "h1", lastSyncAt: "2026-09-06T12:00:00.000Z" },
    true
  );
  assert(st.label === "Synket", "synced label: " + st.label);
}

assert(Sync.payloadsRoughlyEqual({ a: 1 }, { a: 1 }), "equal payloads");
assert(!Sync.payloadsRoughlyEqual({ a: 1 }, { a: 2 }), "unequal payloads");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
