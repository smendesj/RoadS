import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoadmapState, type ItemRow, type LaneRow, type PendingRow } from "./roadmap-state.ts";

const NOW = new Date("2026-01-01T12:00:00Z");
const url = (n: number) => `https://github.com/org/repo/issues/${n}`;

const lane = (id: string, kind: string, order: number, start: string | null = null, end: string | null = null): LaneRow => ({
  id,
  title: `Lane ${id}`,
  kind,
  start_date: start,
  end_date: end,
  sort_order: order,
});
const item = (id: string, laneId: string, order: number, issue: number | null = null, extra: Partial<ItemRow> = {}): ItemRow => ({
  id,
  lane_id: laneId,
  sort_order: order,
  title: `Item ${id}`,
  description: "Texto",
  produto: "GeoCloud",
  prioridade: "Medium",
  effort: "Medium",
  github_issue_url: issue ? url(issue) : null,
  github_issue_number: issue,
  updated_at: "2026-01-01T10:00:00Z",
  ...extra,
});
const base = (over: Partial<Parameters<typeof buildRoadmapState>[0]> = {}) =>
  buildRoadmapState({ lanes: [], items: [], columns: [], snapshotSyncedAt: null, pending: [], now: NOW, ...over });

test("the answer carries the contract's header", () => {
  const state = base({ snapshotSyncedAt: "2026-01-01T11:55:00Z" });
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.asOf, "2026-01-01T12:00:00.000Z");
  assert.equal(state.snapshotSyncedAt, "2026-01-01T11:55:00Z");
  assert.equal(state.maxSprintItems, 4);
  assert.equal(state.timezone, "America/Sao_Paulo");
});

test("sprints carry ISO dates and a stable id built from the start date, groups carry none", () => {
  const state = base({
    lanes: [lane("proxima", "sprint", 2, "2026-01-05", "2026-01-09"), lane("g1", "group", 4)],
  });
  assert.deepEqual(
    state.sprints.map((s) => ({ sprintId: s.sprintId, laneId: s.laneId, startDate: s.startDate, endDate: s.endDate })),
    [{ sprintId: "sprint-2026-01-05", laneId: "proxima", startDate: "2026-01-05", endDate: "2026-01-09" }]
  );
  assert.deepEqual(state.groups.map((g) => g.laneId), ["g1"]);
});

test("a sprint lane without both dates is left out, since it cannot be named", () => {
  const state = base({ lanes: [lane("a", "sprint", 1, "2026-01-05", null), lane("b", "sprint", 2, null, null)] });
  assert.deepEqual(state.sprints, []);
});

test("items come in the lane's order, with positions counted from 1 whatever the stored sort_order", () => {
  const state = base({
    lanes: [lane("atual", "sprint", 1, "2026-01-05", "2026-01-09")],
    items: [item("c", "atual", 30), item("a", "atual", 10), item("b", "atual", 20)],
  });
  assert.deepEqual(state.sprints[0].items.map((i) => [i.id, i.position]), [["a", 1], ["b", 2], ["c", 3]]);
});

test("only the fifth item of a sprint onward is overLimit, and only sprints carry the flag", () => {
  const items = ["1", "2", "3", "4", "5", "6"].map((id, i) => item(id, "atual", i));
  const state = base({
    lanes: [lane("atual", "sprint", 1, "2026-01-05", "2026-01-09"), lane("g1", "group", 2)],
    items: [...items, ...items.map((it) => ({ ...it, id: `g${it.id}`, lane_id: "g1" }))],
  });
  assert.deepEqual(state.sprints[0].items.map((i) => i.overLimit), [false, false, false, false, true, true]);
  assert.equal(state.groups[0].items.length, 6);
  assert.ok(state.groups[0].items.every((i) => !("overLimit" in i)));
});

test("done and status come from the Project #7 snapshot, matched by issue URL", () => {
  const columns = [
    { key: "open", items: [{ url: url(1) }] },
    { key: "dev", items: [{ url: url(2) }] },
    { key: "blocker", items: [{ url: url(3) }] },
    { key: "done", items: [{ url: url(4) }] },
  ];
  const state = base({
    columns,
    lanes: [lane("atual", "sprint", 1, "2026-01-05", "2026-01-09")],
    items: [item("a", "atual", 1, 1), item("b", "atual", 2, 2), item("c", "atual", 3, 3), item("d", "atual", 4, 4)],
  });
  assert.deepEqual(state.sprints[0].items.map((i) => [i.status, i.done]), [
    ["open", false],
    ["development", false],
    ["blocker", false],
    ["done", true],
  ]);
});

test("an item with no issue, or an issue outside the snapshot, is status none and never done", () => {
  const state = base({
    columns: [{ key: "done", items: [{ url: url(9) }] }],
    lanes: [lane("g1", "group", 1)],
    items: [item("a", "g1", 1, null), item("b", "g1", 2, 5)],
  });
  const [a, b] = state.groups[0].items;
  assert.deepEqual([a.status, a.done, a.githubIssueUrl, a.issueNumber], ["none", false, null, null]);
  assert.deepEqual([b.status, b.done, b.issueNumber], ["none", false, 5]);
});

test("a closed issue is not done unless the board says Done", () => {
  const state = base({
    columns: [],
    lanes: [lane("atual", "sprint", 1, "2026-01-05", "2026-01-09")],
    items: [item("a", "atual", 1, 7)],
  });
  assert.equal(state.sprints[0].items[0].done, false);
});

test("the issue number falls back to the URL when the column is empty", () => {
  const state = base({
    lanes: [lane("g1", "group", 1)],
    items: [item("a", "g1", 1, 42, { github_issue_number: null })],
  });
  assert.equal(state.groups[0].items[0].issueNumber, 42);
});

test("pending changes attach to their item, and a pending removal is listed apart", () => {
  const pending: PendingRow[] = [
    { id: "q1", item_id: "a", action: "modify", payload: {} },
    { id: "q2", item_id: "a", action: "move_lane", payload: {} },
    { id: "q3", item_id: null, action: "remove", payload: { title: "Removido", lane_id: "g1" } },
    { id: "q4", item_id: null, action: "remove", payload: null },
  ];
  const state = base({ lanes: [lane("g1", "group", 1)], items: [item("a", "g1", 1), item("b", "g1", 2)], pending });
  assert.deepEqual(state.groups[0].items.map((i) => i.pendingChangeIds), [["q1", "q2"], []]);
  assert.deepEqual(state.removedPending, [
    { changeId: "q3", itemId: null, title: "Removido", laneId: "g1" },
    { changeId: "q4", itemId: null, title: "", laneId: null },
  ]);
});

test("the answer never carries anything marker-shaped", () => {
  const state = base({
    lanes: [lane("g1", "group", 1)],
    items: [item("a", "g1", 1, 1)],
    pending: [{ id: "q1", item_id: "a", action: "add", payload: { reason: "x" } }],
  });
  assert.ok(!JSON.stringify(state).includes("<!--"));
});
