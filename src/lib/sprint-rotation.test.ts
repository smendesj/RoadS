import { test } from "node:test";
import assert from "node:assert/strict";
import { planRotation, type SprintDates, type SprintId } from "./sprint-rotation.ts";

const DATES: Record<SprintId, SprintDates> = {
  atual: { start: "2026-03-02", end: "2026-03-06" },
  proxima: { start: "2026-03-09", end: "2026-03-13" },
  terceira: { start: "2026-03-16", end: "2026-03-20" },
};
const item = (id: string, laneId: string, url: string | null = `https://example.test/issues/${id}`) => ({ id, laneId, url });
const ITEMS = [item("a1", "atual"), item("a2", "atual"), item("a3", "atual", null), item("p1", "proxima"), item("t1", "terceira")];

test("nothing rotates until the current sprint's last day has passed", () => {
  for (const today of ["2026-03-04", "2026-03-06"]) {
    const plan = planRotation({ today, dates: DATES, items: ITEMS, doneUrls: new Set() });
    assert.equal(plan.rotations, 0);
    assert.deepEqual(plan.placements, []);
    assert.deepEqual(plan.finished, []);
    assert.deepEqual(plan.dates, DATES);
  }
});

test("the week after, the sprints move up one step and a new third one opens a week later", () => {
  const plan = planRotation({ today: "2026-03-07", dates: DATES, items: ITEMS, doneUrls: new Set() });
  assert.equal(plan.rotations, 1);
  assert.deepEqual(plan.dates, {
    atual: DATES.proxima,
    proxima: DATES.terceira,
    terceira: { start: "2026-03-23", end: "2026-03-27" },
  });
});

test("finished items leave; the rest carry over ahead of the planned ones", () => {
  const plan = planRotation({ today: "2026-03-09", dates: DATES, items: ITEMS, doneUrls: new Set(["https://example.test/issues/a1"]) });
  assert.deepEqual(plan.finished, ["a1"]);
  assert.deepEqual(plan.placements, [
    { id: "a2", from: "atual", to: "atual", sortOrder: 0 },
    { id: "a3", from: "atual", to: "atual", sortOrder: 1 },
    { id: "p1", from: "proxima", to: "atual", sortOrder: 2 },
    { id: "t1", from: "terceira", to: "proxima", sortOrder: 0 },
  ]);
});

test("weeks nobody synced in are all rotated through", () => {
  const plan = planRotation({ today: "2026-03-17", dates: DATES, items: ITEMS, doneUrls: new Set() });
  assert.equal(plan.rotations, 2);
  assert.deepEqual(plan.dates.atual, DATES.terceira);
  assert.deepEqual(
    plan.placements.map((p) => [p.id, p.to]),
    [["a1", "atual"], ["a2", "atual"], ["a3", "atual"], ["p1", "atual"], ["t1", "atual"]]
  );
});

test("items outside the three sprints are ignored", () => {
  const plan = planRotation({ today: "2026-03-09", dates: DATES, items: [item("g1", "triagem"), item("a1", "atual")], doneUrls: new Set() });
  assert.deepEqual(plan.placements.map((p) => p.id), ["a1"]);
});
