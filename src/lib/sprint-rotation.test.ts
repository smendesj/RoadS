import { test } from "node:test";
import assert from "node:assert/strict";
import { planPositionalRotation, planRotation, type SprintDates, type SprintId } from "./sprint-rotation.ts";

const DATES: Record<SprintId, SprintDates> = {
  atual: { start: "2026-03-02", end: "2026-03-06" },
  proxima: { start: "2026-03-09", end: "2026-03-13" },
  terceira: { start: "2026-03-16", end: "2026-03-20" },
};
const item = (id: string, laneId: string, url: string | null = `https://example.test/issues/${id}`) => ({ id, laneId, url });
const ITEMS = [item("a1", "atual"), item("a2", "atual"), item("a3", "atual", null), item("p1", "proxima"), item("t1", "terceira")];

test("nothing rotates until the current sprint's last day has passed", () => {
  for (const today of ["2026-03-04", "2026-03-06"]) {
    const plan = planPositionalRotation({ today, dates: DATES, items: ITEMS, doneUrls: new Set() });
    assert.equal(plan.rotations, 0);
    assert.deepEqual(plan.placements, []);
    assert.deepEqual(plan.finished, []);
    assert.deepEqual(plan.dates, DATES);
  }
});

test("the week after, the sprints move up one step and a new third one opens a week later", () => {
  const plan = planPositionalRotation({ today: "2026-03-07", dates: DATES, items: ITEMS, doneUrls: new Set() });
  assert.equal(plan.rotations, 1);
  assert.deepEqual(plan.dates, {
    atual: DATES.proxima,
    proxima: DATES.terceira,
    terceira: { start: "2026-03-23", end: "2026-03-27" },
  });
});

test("finished items leave; the rest carry over ahead of the planned ones", () => {
  const plan = planPositionalRotation({ today: "2026-03-09", dates: DATES, items: ITEMS, doneUrls: new Set(["https://example.test/issues/a1"]) });
  assert.deepEqual(plan.finished, ["a1"]);
  assert.deepEqual(plan.placements, [
    { id: "a2", from: "atual", to: "atual", sortOrder: 0 },
    { id: "a3", from: "atual", to: "atual", sortOrder: 1 },
    { id: "p1", from: "proxima", to: "atual", sortOrder: 2 },
    { id: "t1", from: "terceira", to: "proxima", sortOrder: 0 },
  ]);
});

test("weeks nobody synced in are all rotated through", () => {
  const plan = planPositionalRotation({ today: "2026-03-17", dates: DATES, items: ITEMS, doneUrls: new Set() });
  assert.equal(plan.rotations, 2);
  assert.deepEqual(plan.dates.atual, DATES.terceira);
  assert.deepEqual(
    plan.placements.map((p) => [p.id, p.to]),
    [["a1", "atual"], ["a2", "atual"], ["a3", "atual"], ["p1", "atual"], ["t1", "atual"]]
  );
});

test("items outside the three sprints are ignored", () => {
  const plan = planPositionalRotation({ today: "2026-03-09", dates: DATES, items: [item("g1", "triagem"), item("a1", "atual")], doneUrls: new Set() });
  assert.deepEqual(plan.placements.map((p) => p.id), ["a1"]);
});

// The rotation of the weeks by date: only the week that ended moves.
const week = (id: string, start: string, end: string, kind = "sprint") => ({ id, kind, start_date: start, end_date: end });
const W1 = week("sprint-05-10-2026", "2026-10-05", "2026-10-09");
const W2 = week("sprint-12-10-2026", "2026-10-12", "2026-10-16");
const W3 = week("sprint-19-10-2026", "2026-10-19", "2026-10-23");
const it = (id: string, laneId: string, sortOrder: number, url: string | null = `https://example.test/issues/${id}`) => ({ id, laneId, sortOrder, url });

test("only the week that ended moves: the done leave, the rest go on top of today's week in their order, future weeks untouched", () => {
  const plan = planRotation({
    today: "2026-10-13",
    lanes: [W1, W2, W3],
    items: [it("a2", W1.id, 1), it("a1", W1.id, 0), it("a3", W1.id, 2, null), it("b1", W2.id, 0), it("c1", W3.id, 0)],
    doneUrls: new Set(["https://example.test/issues/a2"]),
  });
  assert.deepEqual(plan.finished, [{ id: "a2", laneId: "sprint-05-10-2026" }]);
  assert.equal(plan.target, "sprint-12-10-2026");
  assert.equal(plan.createTarget, false);
  assert.deepEqual(plan.moves, [
    { id: "a1", from: "sprint-05-10-2026", to: "sprint-12-10-2026", sortOrder: 0 },
    { id: "a3", from: "sprint-05-10-2026", to: "sprint-12-10-2026", sortOrder: 1 },
  ]);
  assert.deepEqual(plan.reorders, [{ id: "b1", sortOrder: 2 }]);
  assert.deepEqual(plan.deleteLanes, ["sprint-05-10-2026"]);
});

test("today's week is created when it is missing, and on a Saturday it is the week of the next Monday", () => {
  const midweek = planRotation({ today: "2026-10-13", lanes: [W1, W3], items: [it("a1", W1.id, 0), it("c1", W3.id, 0)], doneUrls: new Set() });
  assert.equal(midweek.target, "sprint-12-10-2026");
  assert.equal(midweek.createTarget, true);
  assert.deepEqual(midweek.moves, [{ id: "a1", from: "sprint-05-10-2026", to: "sprint-12-10-2026", sortOrder: 0 }]);
  assert.deepEqual(midweek.reorders, []);

  const saturday = planRotation({ today: "2026-10-17", lanes: [W2], items: [it("b1", W2.id, 0)], doneUrls: new Set() });
  assert.equal(saturday.target, "sprint-19-10-2026");
  assert.equal(saturday.createTarget, true);
  assert.deepEqual(saturday.moves, [{ id: "b1", from: "sprint-12-10-2026", to: "sprint-19-10-2026", sortOrder: 0 }]);
  assert.deepEqual(saturday.deleteLanes, ["sprint-12-10-2026"]);
});

const NOTHING = { finished: [], target: null, createTarget: false, moves: [], reorders: [], deleteLanes: [] };

test("nothing turns until the last day of the week is over, Friday included", () => {
  for (const today of ["2026-10-12", "2026-10-16"]) {
    const plan = planRotation({ today, lanes: [W2, W3], items: [it("b1", W2.id, 0), it("c1", W3.id, 0)], doneUrls: new Set(["https://example.test/issues/b1"]) });
    assert.deepEqual(plan, NOTHING, today);
  }
});

test("weeks nobody synced in turn at once: one move per item to today's week, the oldest week's items first", () => {
  const plan = planRotation({
    today: "2026-10-20",
    lanes: [W3, W2, W1],
    items: [it("b1", W2.id, 0), it("b2", W2.id, 1), it("a1", W1.id, 0), it("c1", W3.id, 0), it("c2", W3.id, 1)],
    doneUrls: new Set(["https://example.test/issues/b2"]),
  });
  assert.deepEqual(plan.finished, [{ id: "b2", laneId: "sprint-12-10-2026" }]);
  assert.equal(plan.target, "sprint-19-10-2026");
  assert.deepEqual(plan.moves, [
    { id: "a1", from: "sprint-05-10-2026", to: "sprint-19-10-2026", sortOrder: 0 },
    { id: "b1", from: "sprint-12-10-2026", to: "sprint-19-10-2026", sortOrder: 1 },
  ]);
  assert.deepEqual(plan.reorders, [{ id: "c1", sortOrder: 2 }, { id: "c2", sortOrder: 3 }]);
  assert.deepEqual(plan.deleteLanes, ["sprint-05-10-2026", "sprint-12-10-2026"]);
});

test("until migration 0030 the positional lanes are weeks by their dates: 'atual' ends and goes, 'proxima' gets its items on top", () => {
  const atual = week("atual", "2026-10-12", "2026-10-16");
  const proxima = week("proxima", "2026-10-19", "2026-10-23");
  const terceira = week("terceira", "2026-10-26", "2026-10-30");
  const plan = planRotation({
    today: "2026-10-17",
    lanes: [terceira, atual, proxima],
    items: [it("a1", "atual", 0), it("a2", "atual", 1), it("p1", "proxima", 0), it("t1", "terceira", 0)],
    doneUrls: new Set(["https://example.test/issues/a1"]),
  });
  assert.deepEqual(plan, {
    finished: [{ id: "a1", laneId: "atual" }],
    target: "proxima",
    createTarget: false,
    moves: [{ id: "a2", from: "atual", to: "proxima", sortOrder: 0 }],
    reorders: [{ id: "p1", sortOrder: 1 }],
    deleteLanes: ["atual"],
  });

  const intoADatedWeek = planRotation({ today: "2026-10-20", lanes: [atual, W3], items: [it("a2", "atual", 0)], doneUrls: new Set() });
  assert.equal(intoADatedWeek.target, "sprint-19-10-2026");
  assert.deepEqual(intoADatedWeek.deleteLanes, ["atual"]);
});

test("the e2e fixture, the type lanes and a sprint lane with no dates never turn", () => {
  const plan = planRotation({
    today: "2026-10-13",
    lanes: [week("zz-test-sprint", "2026-10-05", "2026-10-09"), week("tipo-bug", "2026-10-05", "2026-10-09", "group"), { id: "sem-data", kind: "sprint", start_date: null, end_date: null }, W2],
    items: [it("z1", "zz-test-sprint", 0), it("g1", "tipo-bug", 0), it("s1", "sem-data", 0), it("b1", W2.id, 0)],
    doneUrls: new Set(["https://example.test/issues/z1", "https://example.test/issues/g1"]),
  });
  assert.deepEqual(plan, NOTHING);
});

test("a week that ended with nothing left to carry just goes, and no week is created for it", () => {
  const plan = planRotation({ today: "2026-10-13", lanes: [W1, W3], items: [it("a1", W1.id, 0), it("c1", W3.id, 0)], doneUrls: new Set(["https://example.test/issues/a1"]) });
  assert.deepEqual(plan, { ...NOTHING, finished: [{ id: "a1", laneId: "sprint-05-10-2026" }], deleteLanes: ["sprint-05-10-2026"] });
  assert.deepEqual(planRotation({ today: "2026-10-13", lanes: [W1, W2], items: [], doneUrls: new Set() }), { ...NOTHING, deleteLanes: ["sprint-05-10-2026"] });
});
