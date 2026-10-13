import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_SYNC_MS, cooldownFor, retryDelay, touchesCurrentSprint } from "./auto-sync.ts";
import { SYNC_COOLDOWN_MS } from "./sync-cooldown.ts";

test("a sync the page starts by itself goes to GitHub at most every 5 minutes; the button keeps its 30 seconds", () => {
  assert.equal(AUTO_SYNC_MS, 5 * 60_000);
  assert.equal(cooldownFor({ auto: true }), 5 * 60_000);
  assert.equal(cooldownFor({ auto: false }), 30_000);
  assert.equal(cooldownFor({}), SYNC_COOLDOWN_MS);
});

test("only a move into or out of the current sprint changes the Project, so only that one syncs right away", () => {
  assert.equal(touchesCurrentSprint("atual", "proxima"), true);
  assert.equal(touchesCurrentSprint("tipo-feature", "atual"), true);
  assert.equal(touchesCurrentSprint("proxima", "terceira"), false);
  assert.equal(touchesCurrentSprint("atual", "atual"), false);
});

test("a move the 30-second brake held back is synced again the moment the brake lets go", () => {
  const now = Date.parse("2026-10-13T12:00:00.000Z");
  assert.equal(retryDelay("2026-10-13T11:59:50.000Z", now), 20_000);
  assert.equal(retryDelay("2026-10-13T11:59:00.000Z", now), 0, "the brake is already over");
  assert.equal(retryDelay("not a date", now), 0);
});
