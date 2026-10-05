import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClient } from "./fake-client.ts";
import { readRoadmapState } from "./state.ts";
import type { StateStore } from "./state.ts";
import { supabaseStateStore } from "./state-store.ts";

const lane = { id: "sprint-a", title: "Sprint de exemplo", kind: "sprint", start_date: "2026-03-02", end_date: "2026-03-06", sort_order: 1 };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  lane_id: "sprint-a",
  sort_order: 1,
  title: "Item de exemplo",
  description: "",
  produto: "GeoCloud",
  prioridade: "Alta",
  effort: "M",
  github_issue_url: "https://example.test/o/r/issues/7",
  github_issue_number: 7,
  updated_at: "2026-03-01T10:00:00.000Z",
  ...extra,
});

const NOW = new Date("2026-03-05T12:00:00.000Z");

test("the state of the Roadmap carries the version of the contract and the moment it was read", async () => {
  const store: StateStore = {
    async read() {
      return { lanes: [lane], items: [item("i-1")], columns: null, snapshotSyncedAt: null, pending: [] };
    },
  };
  const state = await readRoadmapState(store, NOW);
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.asOf, "2026-03-05T12:00:00.000Z");
  assert.equal(state.sprints[0].items[0].issueNumber, 7);
  assert.equal(state.sprints[0].items[0].status, "none");
});

test("the board's statuses and the pending changes reach the items", async () => {
  const store: StateStore = {
    async read() {
      return {
        lanes: [lane],
        items: [item("i-1")],
        columns: [{ key: "done", items: [{ url: "https://example.test/o/r/issues/7" }] }],
        snapshotSyncedAt: "2026-03-05T11:00:00.000Z",
        pending: [{ id: "q-1", item_id: "i-1", action: "modify", payload: null }],
      };
    },
  };
  const state = await readRoadmapState(store, NOW);
  assert.equal(state.snapshotSyncedAt, "2026-03-05T11:00:00.000Z");
  assert.equal(state.sprints[0].items[0].status, "done");
  assert.deepEqual(state.sprints[0].items[0].pendingChangeIds, ["q-1"]);
});

test("the store reads the four tables and hands them over in the shape of the state", async () => {
  const { client, asked } = fakeClient({
    lanes: { data: [lane] },
    roadmap_items: { data: [item("i-1")] },
    board_sync_state: { data: { columns: [{ key: "open", items: [] }], synced_at: "2026-03-05T11:00:00.000Z" } },
    roadmap_sync_queue: { data: [{ id: "q-1", item_id: "i-1", action: "add", payload: null }] },
  });
  const rows = await supabaseStateStore(client).read();
  assert.deepEqual(rows.lanes, [lane]);
  assert.equal(rows.items.length, 1);
  assert.deepEqual(rows.columns, [{ key: "open", items: [] }]);
  assert.equal(rows.snapshotSyncedAt, "2026-03-05T11:00:00.000Z");
  assert.equal(rows.pending.length, 1);
  // Only the changes still waiting count as pending.
  const queue = asked.find((q) => q.table === "roadmap_sync_queue");
  assert.deepEqual(queue?.steps.at(-1), ["is", "acked_at", null]);
});

test("a Roadmap that was never synced has no snapshot", async () => {
  const { client } = fakeClient({ lanes: { data: [] }, roadmap_items: { data: [] }, board_sync_state: { data: null }, roadmap_sync_queue: { data: [] } });
  const rows = await supabaseStateStore(client).read();
  assert.equal(rows.columns, null);
  assert.equal(rows.snapshotSyncedAt, null);
  assert.deepEqual(rows.pending, []);
});

test("a table that fails fails the whole read, never a half-empty Roadmap", async () => {
  for (const broken of ["lanes", "roadmap_items", "board_sync_state", "roadmap_sync_queue"]) {
    const answers: Record<string, { data?: unknown; error?: unknown }> = {
      lanes: { data: [] },
      roadmap_items: { data: [] },
      board_sync_state: { data: null },
      roadmap_sync_queue: { data: [] },
    };
    answers[broken] = { error: { message: "boom" } };
    await assert.rejects(() => supabaseStateStore(fakeClient(answers).client).read(), { message: "boom" }, broken);
  }
});
