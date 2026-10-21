import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SYNC_MAX_DURATION_S } from "./sync-cooldown.ts";

// Next reads maxDuration only as a literal in each file, so the routes and pages that sync can drift from the limit
// the sync's claim uses to call a run stuck: they must all say the same.
const SYNCING = [
  "src/app/api/cron/sync-board/route.ts",
  "src/app/api/frontlights/sync-board/route.ts",
  "src/app/dashboard/page.tsx",
  "src/app/roadmap/page.tsx",
];

test("every route and page that syncs may run as long as a sync may", () => {
  for (const file of SYNCING) {
    const said = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").match(/^export const maxDuration = (\d+);$/m)?.[1];
    assert.equal(Number(said), SYNC_MAX_DURATION_S, file);
  }
});
