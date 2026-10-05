import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNC_COOLDOWN_MS } from "../sync-cooldown.ts";
import { fakeClient } from "./fake-client.ts";
import { supabaseSnapshotReader, syncBoardAnswer } from "./sync.ts";
import type { SyncDeps } from "./sync.ts";

const NOW = Date.parse("2026-03-05T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const RAN = { ok: true as const, syncedAt: "2026-03-05T12:00:00.000Z", columns: [{ title: "Segredo" }], roadmap: { added: 2, removed: 1, issuesCreated: 0 } };

function deps(snapshot: { syncedAt: string; columns: unknown[] } | null, result: Awaited<ReturnType<SyncDeps["run"]>> = RAN) {
  const calls = { ran: 0 };
  const port: SyncDeps = {
    latestSnapshot: async () => snapshot,
    run: async () => {
      calls.ran++;
      return result;
    },
    now: () => NOW,
  };
  return { port, calls };
}

test("with no sync before, it runs and says what the Roadmap took in", async () => {
  const { port, calls } = deps(null);
  assert.deepEqual(await syncBoardAnswer(port), { ok: true, ran: true, syncedAt: "2026-03-05T12:00:00.000Z", roadmap: { added: 2, removed: 1, issuesCreated: 0 } });
  assert.equal(calls.ran, 1);
});

test("a second call right after a sync answers from the last snapshot and says it did not run", async () => {
  const { port, calls } = deps({ syncedAt: ago(5_000), columns: [] });
  assert.deepEqual(await syncBoardAnswer(port), { ok: true, ran: false, syncedAt: ago(5_000), roadmap: { added: 0, removed: 0, issuesCreated: 0 } });
  assert.equal(calls.ran, 0);
});

test("the cooldown is 30 seconds: just inside it does not run, at 30 seconds it does", async () => {
  assert.equal(SYNC_COOLDOWN_MS, 30_000);
  const inside = deps({ syncedAt: ago(SYNC_COOLDOWN_MS - 1), columns: [] });
  const skipped = await syncBoardAnswer(inside.port);
  assert.equal(skipped.ok && skipped.ran, false);
  assert.equal(inside.calls.ran, 0);
  const edge = deps({ syncedAt: ago(SYNC_COOLDOWN_MS), columns: [] });
  await syncBoardAnswer(edge.port);
  assert.equal(edge.calls.ran, 1);
});

test("a snapshot from the future never counts as recent", async () => {
  const { port, calls } = deps({ syncedAt: new Date(NOW + 60_000).toISOString(), columns: [] });
  await syncBoardAnswer(port);
  assert.equal(calls.ran, 1);
});

test("a sync that fails says why, in the user's language, and never the board's cards", async () => {
  const { port } = deps(null, { ok: false, reason: "not_configured" });
  const answer = await syncBoardAnswer(port);
  assert.deepEqual(answer, { ok: false, reason: "not_configured", message: "Sincronização do GitHub ainda não configurada (falta GITHUB_TOKEN no servidor)." });
});

test("the answer never carries the titles of the board's cards", async () => {
  const { port } = deps(null);
  assert.ok(!JSON.stringify(await syncBoardAnswer(port)).includes("Segredo"));
});

test("the last snapshot is read from the single row of board_sync_state", async () => {
  const { client, asked } = fakeClient({ board_sync_state: { data: { columns: [{ key: "open" }], synced_at: "2026-03-05T11:59:00.000Z" } } });
  assert.deepEqual(await supabaseSnapshotReader(client)(), { syncedAt: "2026-03-05T11:59:00.000Z", columns: [{ key: "open" }] });
  assert.deepEqual(asked[0].steps.slice(1), [["eq", "id", true], ["maybeSingle"]]);
});

test("a snapshot that is missing or cannot be read does not stand in the way of a sync", async () => {
  assert.equal(await supabaseSnapshotReader(fakeClient({ board_sync_state: { data: null } }).client)(), null);
  assert.equal(await supabaseSnapshotReader(fakeClient({ board_sync_state: { error: { message: "boom" } } }).client)(), null);
});
