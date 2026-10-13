import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_SYNC_MIN_GAP_MS, AUTO_SYNC_MS, cooldownFor, retryDelay, touchesCurrentSprint } from "./auto-sync.ts";
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

test("a move the 30-second brake held back is synced again when the server says the brake lets go", () => {
  assert.equal(retryDelay(20_000), 20_500, "the server's own count, plus half a second");
  assert.equal(retryDelay(0), 1_000, "never a tight loop, even when the brake is already over");
  assert.equal(retryDelay(undefined), 1_000);
  assert.equal(retryDelay(10 * 60_000), 35_000, "never longer than the button's brake and a margin");
});

test("switching tabs back and forth asks at most once a minute", () => {
  assert.equal(AUTO_SYNC_MIN_GAP_MS, 60_000);
});
