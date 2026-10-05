import { test } from "node:test";
import assert from "node:assert/strict";
import { ackUpTo, pendingChanges } from "./queue.ts";
import type { QueueRow, QueueStore } from "./queue.ts";

// Everything below is made-up data: invented titles and ids.

const item = (extra: Record<string, unknown> = {}) => ({
  title: "Item de exemplo",
  description: "Descrição de exemplo",
  produto: "GeoCloud",
  prioridade: "Alta",
  effort: "M",
  github_issue_url: "https://example.test/issues/1",
  lane_id: "lane-1",
  lanes: { title: "Sprint de exemplo" },
  ...extra,
});

const row = (n: number, extra: Partial<QueueRow> = {}): QueueRow => ({
  id: `q-${n}`,
  item_id: `i-${n}`,
  action: "modify",
  payload: { field: "title" },
  created_at: `2026-03-0${n}T10:00:00.000Z`,
  roadmap_items: item(),
  ...extra,
});

function store(rows: QueueRow[], acked = 0) {
  const calls = { listed: [] as (string | null)[], acked: [] as [string, string][] };
  const port: QueueStore = {
    async listPending(since) {
      calls.listed.push(since);
      return rows;
    },
    async ackThrough(asOf, ackedAt) {
      calls.acked.push([asOf, ackedAt]);
      return acked;
    },
  };
  return { port, calls };
}

test("nothing pending: no changes and no asOf", async () => {
  const { port } = store([]);
  assert.deepEqual(await pendingChanges(port, null), { status: 200, body: { asOf: null, changes: [] } });
});

test("a change comes with enough of the item to write the files without a second round trip", async () => {
  const { port } = store([row(1, { action: "add", payload: { source: "form" } })]);
  const answer = await pendingChanges(port, null);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, {
    asOf: "2026-03-01T10:00:00.000Z",
    changes: [
      {
        id: "q-1",
        itemId: "i-1",
        action: "add",
        payload: { source: "form" },
        createdAt: "2026-03-01T10:00:00.000Z",
        item: {
          title: "Item de exemplo",
          description: "Descrição de exemplo",
          produto: "GeoCloud",
          prioridade: "Alta",
          effort: "M",
          githubIssueUrl: "https://example.test/issues/1",
          lane: "Sprint de exemplo",
          laneId: "lane-1",
        },
      },
    ],
  });
});

test("the item and its lane may each come as an object or as a one-element list", async () => {
  const { port } = store([row(1, { roadmap_items: [item({ lanes: [{ title: "Lane em lista" }] })] })]);
  const body = (await pendingChanges(port, null)).body as { changes: { item: { lane: string } }[] };
  assert.equal(body.changes[0].item.lane, "Lane em lista");
});

test("an item with no lane has lane null", async () => {
  const { port } = store([row(1, { roadmap_items: item({ lanes: null }) })]);
  const body = (await pendingChanges(port, null)).body as { changes: { item: { lane: string | null } }[] };
  assert.equal(body.changes[0].item.lane, null);
});

test("a removal arrives with no item and keeps its payload", async () => {
  const { port } = store([row(1, { action: "remove", item_id: null, roadmap_items: null, payload: { item_id: "i-9", lane_id: "lane-1", title: "Item removido" } })]);
  const body = (await pendingChanges(port, null)).body as { changes: { itemId: null; item: null; payload: unknown }[] };
  assert.equal(body.changes.length, 1);
  assert.equal(body.changes[0].itemId, null);
  assert.equal(body.changes[0].item, null);
  assert.deepEqual(body.changes[0].payload, { item_id: "i-9", lane_id: "lane-1", title: "Item removido" });
});

test("a change of an item deleted since has nothing left to write and is left out, but asOf still covers it", async () => {
  const orphan = row(2, { action: "move_lane", item_id: null, roadmap_items: null });
  const { port } = store([row(1), orphan]);
  const body = (await pendingChanges(port, null)).body as { asOf: string; changes: { id: string }[] };
  assert.deepEqual(body.changes.map((c) => c.id), ["q-1"]);
  assert.equal(body.asOf, "2026-03-02T10:00:00.000Z");
});

test("asOf is the creation time of the newest pending row, never the time of the call", async () => {
  const { port } = store([row(1), row(2), row(3)]);
  assert.equal(((await pendingChanges(port, null)).body as { asOf: string }).asOf, "2026-03-03T10:00:00.000Z");
});

test("a since that is an ISO timestamp is handed to the store", async () => {
  const { port, calls } = store([]);
  await pendingChanges(port, "2026-03-01T00:00:00Z");
  assert.deepEqual(calls.listed, ["2026-03-01T00:00:00Z"]);
});

test("no since, or an empty one, asks for everything pending", async () => {
  const { port, calls } = store([]);
  await pendingChanges(port, null);
  await pendingChanges(port, "");
  assert.deepEqual(calls.listed, [null, null]);
});

test("a since that is not an ISO timestamp is a 400, and the store is never asked", async () => {
  const { port, calls } = store([row(1)]);
  for (const bad of ["yesterday", "2026-03-01", "2026-03-01T00:00:00", "1700000000"]) {
    assert.deepEqual(await pendingChanges(port, bad), { status: 400, body: { error: "since must be an ISO timestamp string" } });
  }
  assert.deepEqual(calls.listed, []);
});

test("an ack with the asOf of a fetch consumes up to it and says how many rows", async () => {
  const { port, calls } = store([], 4);
  const now = new Date("2026-03-05T12:00:00.000Z");
  assert.deepEqual(await ackUpTo(port, { asOf: "2026-03-03T10:00:00.000Z" }, now), { status: 200, body: { acked: 4 } });
  assert.deepEqual(calls.acked, [["2026-03-03T10:00:00.000Z", "2026-03-05T12:00:00.000Z"]]);
});

test("an ack with nothing to consume says zero", async () => {
  const { port } = store([], 0);
  assert.deepEqual(await ackUpTo(port, { asOf: "2026-03-03T10:00:00.000Z" }, new Date()), { status: 200, body: { acked: 0 } });
});

test("an ack with no asOf, or a bad one, or no object at all is a 400 and consumes nothing", async () => {
  const { port, calls } = store([], 9);
  const expected = { status: 400, body: { error: "asOf must be an ISO timestamp string" } };
  for (const bad of [{}, { asOf: "now" }, { asOf: 17 }, { asOf: "2026-03-03" }, null, "x", [1]]) {
    assert.deepEqual(await ackUpTo(port, bad, new Date()), expected);
  }
  assert.deepEqual(calls.acked, []);
});

test("an ack that names another version of the contract is refused before anything is read, and consumes nothing", async () => {
  const { port, calls } = store([], 9);
  assert.deepEqual(await ackUpTo(port, { schemaVersion: 2, asOf: "2026-03-03T10:00:00.000Z" }, new Date()), {
    status: 400,
    body: { error: "unsupported_schema_version", supported: 1 },
  });
  assert.deepEqual(calls.acked, []);
});

test("an ack that names version 1 works as one that names none", async () => {
  const { port } = store([], 2);
  assert.deepEqual(await ackUpTo(port, { schemaVersion: 1, asOf: "2026-03-03T10:00:00.000Z" }, new Date()), { status: 200, body: { acked: 2 } });
});

test("a store that fails is not hidden: the error reaches the door, which answers a plain 500", async () => {
  const port: QueueStore = {
    async listPending() {
      throw new Error("db down");
    },
    async ackThrough() {
      throw new Error("db down");
    },
  };
  await assert.rejects(() => pendingChanges(port, null), /db down/);
  await assert.rejects(() => ackUpTo(port, { asOf: "2026-03-03T10:00:00.000Z" }, new Date()), /db down/);
});
