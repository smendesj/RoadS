import { test } from "node:test";
import assert from "node:assert/strict";
import { brakedSync, type BrakeDeps } from "./sync-claim.ts";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const RAN = { ok: true as const, columns: [], syncedAt: new Date(NOW).toISOString(), roadmap: { added: 1, removed: 0, issuesCreated: 0 } };

// A board_sync_state row held in memory: the claim is the same conditional update the database runs.
function deps(row: { syncedAt: string; claimedAt: string | null } | null) {
  const calls = { run: 0, claims: [] as number[] };
  const port: BrakeDeps = {
    now: () => NOW,
    configured: () => true,
    latestSnapshot: async () => (row ? { columns: [{ key: "open" }], syncedAt: row.syncedAt, slices: [] } : null),
    claim: async (brakeMs) => {
      calls.claims.push(brakeMs);
      if (!row) return { claimed: false, claimedAt: null };
      if (row.claimedAt && NOW - Date.parse(row.claimedAt) < brakeMs) return { claimed: false, claimedAt: row.claimedAt };
      row.claimedAt = new Date(NOW).toISOString();
      return { claimed: true, claimedAt: row.claimedAt };
    },
    run: async () => {
      calls.run++;
      return RAN;
    },
  };
  return { port, calls, row };
}

test("a sync the page starts by itself runs when the snapshot is over 5 minutes old and nobody else is syncing", async () => {
  const { port, calls } = deps({ syncedAt: ago(6 * 60_000), claimedAt: ago(6 * 60_000) });
  assert.deepEqual(await brakedSync(port, { auto: true }), RAN);
  assert.equal(calls.run, 1);
});

test("inside the brake the last snapshot comes back, with how long until the brake lets go by the server's clock", async () => {
  const { port, calls } = deps({ syncedAt: ago(60_000), claimedAt: ago(60_000) });
  const auto = await brakedSync(port, { auto: true });
  assert.equal(calls.run, 0);
  assert.ok(auto.ok && auto.cached);
  assert.equal(auto.ok && auto.retryInMs, 4 * 60_000);

  const button = await brakedSync(deps({ syncedAt: ago(10_000), claimedAt: ago(10_000) }).port, {});
  assert.ok(button.ok && button.cached);
  assert.equal(button.ok && button.retryInMs, 20_000);
});

test("two syncs never run at once: while one is under way (claimed, snapshot not yet written) the other gets the snapshot", async () => {
  // The snapshot is old, but someone claimed a sync 5 seconds ago and it hasn't finished.
  const { port, calls } = deps({ syncedAt: ago(10 * 60_000), claimedAt: ago(5_000) });
  const second = await brakedSync(port, {});
  assert.equal(calls.run, 0);
  assert.ok(second.ok && second.cached);
  assert.equal(second.ok && second.retryInMs, 25_000);
});

test("a sync that failed still holds the brake, so a broken GitHub is not asked again by every tab", async () => {
  // Last good snapshot an hour ago; a failed attempt claimed 1 minute ago.
  const { port, calls } = deps({ syncedAt: ago(60 * 60_000), claimedAt: ago(60_000) });
  const answer = await brakedSync(port, { auto: true });
  assert.equal(calls.run, 0);
  assert.ok(answer.ok && answer.cached);
});

test("the very first sync, with no snapshot row yet, runs", async () => {
  const { port, calls } = deps(null);
  assert.deepEqual(await brakedSync(port, { auto: true }), RAN);
  assert.equal(calls.run, 1);
});

test("the button claims with its 30 seconds and a page's own sync with 5 minutes", async () => {
  const button = deps({ syncedAt: ago(40_000), claimedAt: ago(40_000) });
  await brakedSync(button.port, {});
  assert.deepEqual(button.calls.claims, [30_000]);
  const auto = deps({ syncedAt: ago(6 * 60_000), claimedAt: ago(6 * 60_000) });
  await brakedSync(auto.port, { auto: true });
  assert.deepEqual(auto.calls.claims, [5 * 60_000]);
});

test("without a GitHub token nothing is claimed: inside the brake the snapshot comes back, past it 'not configured'", async () => {
  const fresh = deps({ syncedAt: ago(10_000), claimedAt: null });
  fresh.port.configured = () => false;
  const inside = await brakedSync(fresh.port, {});
  assert.ok(inside.ok && inside.cached);

  const stale = deps({ syncedAt: ago(10 * 60_000), claimedAt: null });
  stale.port.configured = () => false;
  assert.deepEqual(await brakedSync(stale.port, { auto: true }), { ok: false, reason: "not_configured" });
  assert.deepEqual(stale.calls.claims, [], "production's brake is never held by a server without a token");
  assert.equal(stale.calls.run, 0);
});