import { test } from "node:test";
import assert from "node:assert/strict";
import { brakedSync, type BrakeDeps } from "./sync-claim.ts";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const RAN = { ok: true as const, columns: [], syncedAt: new Date(NOW).toISOString(), roadmap: { added: 1, removed: 0, issuesCreated: 0 } };
const BUTTON = 30_000;
const AUTO = 5 * 60_000;

// The claim itself (brake passed AND the last run finished, or stuck) is the database's: claim_board_sync in
// migration 0029. Here a fake says whether it was granted, and the tests pin what the brake does around it.
function deps(snapshot: string | null, grant: { claimed: boolean; claimedAt: string | null }, run: () => Promise<typeof RAN> = async () => RAN) {
  const calls = { run: 0, claims: [] as number[], finished: [] as string[] };
  const port: BrakeDeps = {
    now: () => NOW,
    configured: () => true,
    latestSnapshot: async () => (snapshot ? { columns: [{ key: "open" }], syncedAt: snapshot } : null),
    claim: async (brakeMs) => {
      calls.claims.push(brakeMs);
      return grant;
    },
    finish: async (claimedAt) => {
      calls.finished.push(claimedAt);
    },
    run: async () => {
      calls.run++;
      return run();
    },
  };
  return { port, calls };
}

test("past the brake, with the run granted, the sync runs and is marked finished", async () => {
  const { port, calls } = deps(ago(6 * 60_000), { claimed: true, claimedAt: ago(0) });
  assert.deepEqual(await brakedSync(port, { brakeMs: AUTO }), RAN);
  assert.equal(calls.run, 1);
  assert.deepEqual(calls.claims, [AUTO]);
  assert.deepEqual(calls.finished, [ago(0)]);
});

test("a run that fails is still marked finished, so the next one isn't held back as if it were still running", async () => {
  const { port, calls } = deps(ago(6 * 60_000), { claimed: true, claimedAt: ago(0) }, async () => {
    throw new Error("GitHub 502");
  });
  await assert.rejects(brakedSync(port, { brakeMs: BUTTON }), /GitHub 502/);
  assert.deepEqual(calls.finished, [ago(0)]);
});

test("inside the brake the last snapshot comes back, with how long until the brake lets go by the server's clock", async () => {
  const auto = deps(ago(60_000), { claimed: true, claimedAt: ago(0) });
  const answer = await brakedSync(auto.port, { brakeMs: AUTO });
  assert.ok(answer.ok && answer.cached);
  assert.equal(answer.ok && answer.retryInMs, 4 * 60_000);
  assert.equal(auto.calls.run, 0);
  assert.deepEqual(auto.calls.claims, [], "a fresh snapshot is enough: nothing is claimed");
});

test("while another run holds the claim (snapshot not yet written), the snapshot comes back and nothing runs", async () => {
  const { port, calls } = deps(ago(10 * 60_000), { claimed: false, claimedAt: ago(5_000) });
  const answer = await brakedSync(port, { brakeMs: BUTTON });
  assert.equal(calls.run, 0);
  assert.deepEqual(calls.finished, []);
  assert.ok(answer.ok && answer.cached);
  assert.equal(answer.ok && answer.retryInMs, 25_000);
});

test("a run still going past the brake says to come back in 5 seconds, so a waiting move never polls every second", async () => {
  const { port } = deps(ago(10 * 60_000), { claimed: false, claimedAt: ago(50_000) });
  const answer = await brakedSync(port, { brakeMs: BUTTON });
  assert.ok(answer.ok && answer.cached);
  assert.equal(answer.ok && answer.retryInMs, 5_000);
});

test("the very first sync, with no snapshot row yet, runs", async () => {
  const { port, calls } = deps(null, { claimed: false, claimedAt: null });
  assert.deepEqual(await brakedSync(port, { brakeMs: AUTO }), RAN);
  assert.equal(calls.run, 1);
});

test("without a GitHub token nothing is claimed: inside the brake the snapshot comes back, past it 'not configured'", async () => {
  const fresh = deps(ago(10_000), { claimed: true, claimedAt: ago(0) });
  fresh.port.configured = () => false;
  const inside = await brakedSync(fresh.port, { brakeMs: BUTTON });
  assert.ok(inside.ok && inside.cached);

  const stale = deps(ago(10 * 60_000), { claimed: true, claimedAt: ago(0) });
  stale.port.configured = () => false;
  assert.deepEqual(await brakedSync(stale.port, { brakeMs: AUTO }), { ok: false, reason: "not_configured" });
  assert.deepEqual(stale.calls.claims, [], "production's brake is never held by a server without a token");
  assert.equal(stale.calls.run, 0);
});
