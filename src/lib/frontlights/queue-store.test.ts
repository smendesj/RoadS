import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClient } from "./fake-client.ts";
import { supabaseQueueStore } from "./queue-store.ts";

// The filters are the contract: an ack must never reach a row made after the asOf it was given, and must
// never touch what was already acked; a fetch must only see what is still pending, oldest first.

test("an ack closes only the pending rows made at or before asOf", async () => {
  const { client, asked } = fakeClient({ roadmap_sync_queue: { data: [{ id: "a" }, { id: "b" }] } });
  const count = await supabaseQueueStore(client).ackThrough("2026-03-03T10:00:00.000Z", "2026-03-05T12:00:00.000Z");
  assert.equal(count, 2);
  assert.equal(asked[0].table, "roadmap_sync_queue");
  assert.deepEqual(asked[0].steps.filter(([m]) => m !== "select"), [
    ["update", { acked_at: "2026-03-05T12:00:00.000Z" }],
    ["is", "acked_at", null],
    ["lte", "created_at", "2026-03-03T10:00:00.000Z"],
  ]);
});

test("an ack that closes nothing says zero", async () => {
  const { client } = fakeClient({ roadmap_sync_queue: { data: [] } });
  assert.equal(await supabaseQueueStore(client).ackThrough("2026-03-03T10:00:00.000Z", "2026-03-05T12:00:00.000Z"), 0);
});

test("a database error on ack is raised, not turned into a count", async () => {
  const { client } = fakeClient({ roadmap_sync_queue: { error: { message: "boom" } } });
  await assert.rejects(() => supabaseQueueStore(client).ackThrough("2026-03-03T10:00:00.000Z", "2026-03-05T12:00:00.000Z"));
});

test("a fetch asks for the pending rows, oldest first, with their item and its lane", async () => {
  const { client, asked } = fakeClient({ roadmap_sync_queue: { data: [{ id: "a" }] } });
  const rows = await supabaseQueueStore(client).listPending(null);
  assert.deepEqual(rows, [{ id: "a" }]);
  const steps = asked[0].steps;
  assert.match(String(steps[0][1]), /roadmap_items\(.*lanes\(title\)\)/);
  assert.deepEqual(steps.slice(1), [
    ["is", "acked_at", null],
    ["order", "created_at", { ascending: true }],
  ]);
});

test("a fetch with since only asks for rows made after it", async () => {
  const { client, asked } = fakeClient({ roadmap_sync_queue: { data: [] } });
  await supabaseQueueStore(client).listPending("2026-03-01T00:00:00Z");
  assert.deepEqual(asked[0].steps.at(-1), ["gt", "created_at", "2026-03-01T00:00:00Z"]);
});

test("a fetch with no data is an empty list, and a database error is raised", async () => {
  assert.deepEqual(await supabaseQueueStore(fakeClient({ roadmap_sync_queue: { data: null } }).client).listPending(null), []);
  await assert.rejects(() => supabaseQueueStore(fakeClient({ roadmap_sync_queue: { error: { message: "boom" } } }).client).listPending(null));
});
