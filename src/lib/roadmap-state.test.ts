import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoadmapState, type ItemRow, type LaneRow, type PendingRow } from "./roadmap-state.ts";

// A Tuesday: the current week is 05–09/01/2026, the week most fixtures below are in.
const NOW = new Date("2026-01-06T12:00:00Z");
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
  assert.equal(state.asOf, "2026-01-06T12:00:00.000Z");
  assert.equal(state.snapshotSyncedAt, "2026-01-01T11:55:00Z");
  assert.equal(state.maxSprintItems, 4);
  assert.equal(state.timezone, "America/Sao_Paulo");
});

test("a sprint is a week: its id is sprint- and its Monday as DD-MM-AAAA, and laneId is the lane's own id", () => {
  const state = base({
    lanes: [lane("sprint-05-01-2026", "sprint", 2, "2026-01-05", "2026-01-09"), lane("g1", "group", 4)],
  });
  assert.deepEqual(
    state.sprints.map((s) => ({ sprintId: s.sprintId, laneId: s.laneId, startDate: s.startDate, endDate: s.endDate })),
    [{ sprintId: "sprint-05-01-2026", laneId: "sprint-05-01-2026", startDate: "2026-01-05", endDate: "2026-01-09" }]
  );
  assert.deepEqual(state.groups.map((g) => g.laneId), ["g1"]);
});

test("a positional lane still in the database (before migration 0031) is a week too: the sprintId comes from its date", () => {
  const state = base({ lanes: [lane("proxima", "sprint", 2, "2026-01-05", "2026-01-09")] });
  assert.deepEqual(state.sprints.map((s) => [s.sprintId, s.laneId]), [["sprint-05-01-2026", "proxima"]]);
});

test("a sprint is titled by its dates only, never by its position", () => {
  const state = base({
    now: new Date("2026-09-29T12:00:00Z"),
    lanes: [{ ...lane("atual", "sprint", 1, "2026-09-28", "2026-10-02"), title: "Sprint atual" }, lane("sprint-05-10-2026", "sprint", 2, "2026-10-05", "2026-10-09")],
    items: [item("a", "sprint-05-10-2026", 0)],
  });
  assert.deepEqual(state.sprints.map((s) => s.title), ["Sprint 28/09–02/10", "Sprint 05–09/10"]);
});

test("the weeks come in the order of their start date, whatever their stored order or id", () => {
  const state = base({
    lanes: [
      lane("sprint-19-01-2026", "sprint", 1, "2026-01-19", "2026-01-23"),
      lane("sprint-05-01-2026", "sprint", 3, "2026-01-05", "2026-01-09"),
      lane("sprint-12-01-2026", "sprint", 2, "2026-01-12", "2026-01-16"),
    ],
    items: [item("a", "sprint-19-01-2026", 0), item("b", "sprint-12-01-2026", 0)],
  });
  assert.deepEqual(state.sprints.map((s) => s.sprintId), ["sprint-05-01-2026", "sprint-12-01-2026", "sprint-19-01-2026"]);
});

test("the e2e fixture lanes (zz-test-*) and what is in them never reach Frontlights", () => {
  const state = base({
    lanes: [lane("zz-test-sprint", "sprint", 98, "2026-12-07", "2026-12-11"), lane("zz-test-a", "group", 990), lane("g1", "group", 4)],
    items: [item("t1", "zz-test-sprint", 0), item("t2", "zz-test-a", 0), item("a", "g1", 1)],
    pending: [{ id: "q1", item_id: null, action: "remove", payload: { title: "[TESTE] x", lane_id: "zz-test-sprint" } }],
  });
  assert.deepEqual(state.sprints.map((s) => s.laneId), ["sprint-05-01-2026"]);
  assert.deepEqual(state.groups.map((g) => g.laneId), ["g1"]);
  assert.deepEqual(state.removedPending, []);
});

test("a pending removal from a sprint names the week by its date id, a removal from a group names the group", () => {
  const state = base({
    lanes: [lane("atual", "sprint", 1, "2026-01-05", "2026-01-09"), lane("g1", "group", 4)],
    pending: [
      { id: "q1", item_id: null, action: "remove", payload: { title: "Da sprint", lane_id: "atual" } },
      { id: "q2", item_id: null, action: "remove", payload: { title: "Do grupo", lane_id: "g1" } },
      { id: "q3", item_id: null, action: "remove", payload: { title: "Já por data", lane_id: "sprint-12-01-2026" } },
    ],
  });
  assert.deepEqual(state.removedPending.map((r) => r.laneId), ["sprint-05-01-2026", "g1", "sprint-12-01-2026"]);
});

test("a sprint lane without both dates is left out, since it cannot be named", () => {
  const state = base({ lanes: [lane("a", "sprint", 1, "2026-01-05", null), lane("b", "sprint", 2, null, null)] });
  assert.deepEqual(state.sprints.map((s) => s.laneId), ["sprint-05-01-2026"]);
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

// ---- N weeks (#15 S5): the weeks sprints[] carries besides the stored ones.

test("a deleted week still named by an unacked change comes back empty, with its ids and dates from the id", () => {
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [lane("sprint-12-10-2026", "sprint", 1, "2026-10-12", "2026-10-16"), lane("tipo-bug", "group", 20)],
    items: [item("x", "sprint-12-10-2026", 0)],
    pending: [
      // the future week x left, deleted when it emptied
      { id: "q1", item_id: "x", action: "move_lane", payload: { lane_id: "sprint-12-10-2026", from_lane_id: "sprint-26-10-2026" } },
      // the week the rotation ended and deleted
      { id: "q2", item_id: null, action: "remove", payload: { lane_id: "sprint-05-10-2026", title: "Feito" } },
      // a week an add named, deleted since
      { id: "q3", item_id: "y", action: "add", payload: { lane_id: "sprint-02-11-2026" } },
    ],
  });
  assert.deepEqual(
    state.sprints.map((s) => [s.sprintId, s.laneId, s.title, s.startDate, s.endDate, s.items.map((i) => i.id)]),
    [
      ["sprint-05-10-2026", "sprint-05-10-2026", "Sprint 05–09/10", "2026-10-05", "2026-10-09", []],
      ["sprint-12-10-2026", "sprint-12-10-2026", "Sprint 12–16/10", "2026-10-12", "2026-10-16", ["x"]],
      ["sprint-26-10-2026", "sprint-26-10-2026", "Sprint 26–30/10", "2026-10-26", "2026-10-30", []],
      ["sprint-02-11-2026", "sprint-02-11-2026", "Sprint 02–06/11", "2026-11-02", "2026-11-06", []],
    ]
  );
});

test("once the change is acked the deleted week is gone", () => {
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [lane("sprint-12-10-2026", "sprint", 1, "2026-10-12", "2026-10-16")],
    items: [item("x", "sprint-12-10-2026", 0)],
    pending: [],
  });
  assert.deepEqual(state.sprints.map((s) => s.sprintId), ["sprint-12-10-2026"]);
});

test("only sprint-DD-MM-AAAA ids of a real Monday are weeks: positional, type, group and fixture ids stay out", () => {
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [lane("sprint-12-10-2026", "sprint", 1, "2026-10-12", "2026-10-16"), lane("tipo-bug", "group", 20)],
    pending: [
      { id: "q1", item_id: "y", action: "move_lane", payload: { lane_id: "tipo-bug", from_lane_id: "proxima" } },
      { id: "q2", item_id: "z", action: "add", payload: { lane_id: "zz-test-sprint" } },
      { id: "q3", item_id: "z", action: "move_lane", payload: { lane_id: "g1", from_lane_id: "zz-test-a" } },
      { id: "q4", item_id: null, action: "remove", payload: { lane_id: "sprint-13-10-2026", title: "Não é segunda" } },
      { id: "q5", item_id: null, action: "remove", payload: { lane_id: "sprint-31-02-2027", title: "Não existe" } },
      { id: "q6", item_id: null, action: "remove", payload: { lane_id: "sprint-2026-10-19", title: "Forma antiga" } },
      { id: "q7", item_id: null, action: "remove", payload: null },
    ],
  });
  assert.deepEqual(state.sprints.map((s) => s.sprintId), ["sprint-12-10-2026"]);
});

test("a cited week whose lane exists comes once, with its items, also when the lane is still positional", () => {
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [lane("atual", "sprint", 1, "2026-10-12", "2026-10-16"), lane("sprint-19-10-2026", "sprint", 2, "2026-10-19", "2026-10-23")],
    items: [item("a", "atual", 0), item("b", "sprint-19-10-2026", 0)],
    pending: [
      { id: "q1", item_id: "a", action: "move_lane", payload: { lane_id: "sprint-12-10-2026", from_lane_id: "sprint-19-10-2026" } },
      { id: "q2", item_id: "b", action: "add", payload: { lane_id: "sprint-19-10-2026" } },
    ],
  });
  assert.deepEqual(state.sprints.map((s) => [s.sprintId, s.laneId, s.items.map((i) => i.id)]), [
    ["sprint-12-10-2026", "atual", ["a"]],
    ["sprint-19-10-2026", "sprint-19-10-2026", ["b"]],
  ]);
});

test("the current week is always there, empty when its lane is missing, the next Monday's on a weekend", () => {
  const midweek = base({ now: new Date("2026-10-14T12:00:00Z") });
  assert.deepEqual(
    midweek.sprints.map((s) => [s.sprintId, s.laneId, s.title, s.startDate, s.endDate, s.items.length]),
    [["sprint-12-10-2026", "sprint-12-10-2026", "Sprint 12–16/10", "2026-10-12", "2026-10-16", 0]]
  );
  // Saturday 17/10 in São Paulo: the current week is the one that starts on Monday 19/10.
  const saturday = base({
    now: new Date("2026-10-17T15:00:00Z"),
    lanes: [lane("sprint-26-10-2026", "sprint", 1, "2026-10-26", "2026-10-30")],
    items: [item("c", "sprint-26-10-2026", 0)],
  });
  assert.deepEqual(saturday.sprints.map((s) => [s.sprintId, s.items.length]), [["sprint-19-10-2026", 0], ["sprint-26-10-2026", 1]]);
});

test("a stored week lane with no item comes only when it is the current week or an unacked change names it", () => {
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [
      lane("sprint-05-10-2026", "sprint", 1, "2026-10-05", "2026-10-09"), // ended, empty, not named
      lane("sprint-12-10-2026", "sprint", 2, "2026-10-12", "2026-10-16"), // current, empty
      lane("sprint-19-10-2026", "sprint", 3, "2026-10-19", "2026-10-23"), // future, empty, not named
      lane("sprint-26-10-2026", "sprint", 4, "2026-10-26", "2026-10-30"), // future, empty, named by a move
      lane("proxima", "sprint", 5, "2026-11-02", "2026-11-06"), // positional, empty, named by its own id
      lane("sprint-09-11-2026", "sprint", 6, "2026-11-09", "2026-11-13"), // future, with an item
      lane("sprint-28-09-2026", "sprint", 0, "2026-09-28", "2026-10-02"), // ended, with an item
    ],
    items: [item("a", "sprint-09-11-2026", 0), item("b", "sprint-28-09-2026", 0)],
    pending: [
      { id: "q1", item_id: "a", action: "move_lane", payload: { lane_id: "sprint-09-11-2026", from_lane_id: "sprint-26-10-2026" } },
      { id: "q2", item_id: null, action: "remove", payload: { lane_id: "proxima", title: "Saiu" } },
    ],
  });
  assert.deepEqual(state.sprints.map((s) => [s.sprintId, s.laneId, s.items.length]), [
    ["sprint-28-09-2026", "sprint-28-09-2026", 1],
    ["sprint-12-10-2026", "sprint-12-10-2026", 0],
    ["sprint-26-10-2026", "sprint-26-10-2026", 0],
    ["sprint-02-11-2026", "proxima", 0],
    ["sprint-09-11-2026", "sprint-09-11-2026", 1],
  ]);
});

test("the empty week at the end of the screen's row and the gaps are never in sprints[]", () => {
  // Stored: this week and the one two weeks on. The screen also shows 19/10 (a gap) and 02/11 (the empty one at the end).
  const state = base({
    now: new Date("2026-10-14T12:00:00Z"),
    lanes: [lane("sprint-12-10-2026", "sprint", 1, "2026-10-12", "2026-10-16"), lane("sprint-26-10-2026", "sprint", 2, "2026-10-26", "2026-10-30")],
    items: [item("a", "sprint-12-10-2026", 0), item("b", "sprint-26-10-2026", 0)],
  });
  assert.deepEqual(state.sprints.map((s) => s.sprintId), ["sprint-12-10-2026", "sprint-26-10-2026"]);
});

test("items with the same sort_order go by id, as the Roadmap and the Dashboard read them, whatever their issue number", () => {
  const state = base({
    lanes: [lane("sprint-05-01-2026", "sprint", 1, "2026-01-05", "2026-01-09"), lane("g1", "group", 2)],
    items: [
      item("d", "sprint-05-01-2026", 0, 5),
      item("c", "sprint-05-01-2026", 0, null),
      item("b", "sprint-05-01-2026", 0, 30),
      item("a", "sprint-05-01-2026", 0, 40),
      item("z", "sprint-05-01-2026", -1, 99),
      item("h", "g1", 3, 8),
      item("k", "g1", 3, 7),
    ],
  });
  assert.deepEqual(state.sprints[0].items.map((i) => [i.id, i.position]), [["z", 1], ["a", 2], ["b", 3], ["c", 4], ["d", 5]]);
  assert.deepEqual(state.groups[0].items.map((i) => i.id), ["h", "k"]);
});

test("before migration 0031 the turn leaves 'atual' empty in the database: it comes, empty, while a change names it, then stays out", () => {
  // Saturday 17/10: the week of 12–16/10 ended, its done item left, the other one went to "proxima" (19–23/10).
  const lanes = [lane("atual", "sprint", 1, "2026-10-12", "2026-10-16"), lane("proxima", "sprint", 2, "2026-10-19", "2026-10-23")];
  const items = [item("a2", "proxima", 0), item("p1", "proxima", 1)];
  const now = new Date("2026-10-17T15:00:00Z");
  const turned = base({
    now,
    lanes,
    items,
    pending: [
      { id: "q1", item_id: null, action: "remove", payload: { item_id: "a1", lane_id: "atual", title: "Feito" } },
      { id: "q2", item_id: "a2", action: "move_lane", payload: { lane_id: "proxima", from_lane_id: "atual" } },
    ],
  });
  assert.deepEqual(turned.sprints.map((s) => [s.sprintId, s.laneId, s.items.map((i) => i.id)]), [
    ["sprint-12-10-2026", "atual", []],
    ["sprint-19-10-2026", "proxima", ["a2", "p1"]],
  ]);
  assert.deepEqual(turned.removedPending.map((r) => r.laneId), ["sprint-12-10-2026"]);

  const acked = base({ now, lanes, items });
  assert.deepEqual(acked.sprints.map((s) => s.laneId), ["proxima"]);
});
