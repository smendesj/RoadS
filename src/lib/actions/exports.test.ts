import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Every function exported from a "use server" file becomes an HTTP endpoint that any signed-in user can
// call directly with the action id, whether or not a screen uses it. So the list below is the app's whole
// public write/read surface: each entry checks who is calling inside its own body. Adding an export here
// is a decision, not a side effect; logic that must not be callable (the cron sync, helpers) lives in
// plain modules under src/lib.
const PUBLIC_ACTIONS: Record<string, string[]> = {
  "account.ts": ["completePasswordReset"],
  "admin.ts": ["listUsersForConfig", "resetUserPassword", "updateUserRole"],
  "dashboard.ts": ["getDashboard", "syncDashboard"],
  "profile.ts": ["updateMyAvatar"],
  "roadmap.ts": ["createRoadmapItem", "deleteRoadmapItem", "getRoadmapBoard", "moveRoadmapItemLane", "saveRoadmapItemEdit"],
  "sync.ts": ["getLatestBoardSnapshot", "syncBoardAsViewer"],
};

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

test("every actions file is a use-server file and is on the list", () => {
  assert.deepEqual([...files].sort(), Object.keys(PUBLIC_ACTIONS).sort());
  for (const f of files) assert.match(readFileSync(new URL(f, dir), "utf8"), /^\s*"use server";/, f);
});

test("each file exports exactly the actions it is listed with, nothing more", () => {
  for (const f of files) {
    const source = readFileSync(new URL(f, dir), "utf8");
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(exported, PUBLIC_ACTIONS[f], f);
  }
});

test("the cron-only sync is not among the endpoints", () => {
  const all = Object.values(PUBLIC_ACTIONS).flat();
  assert.ok(!all.includes("syncBoard"));
});
