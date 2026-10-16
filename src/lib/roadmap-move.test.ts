import { test } from "node:test";
import assert from "node:assert/strict";
import { dropOrder, moveItem } from "./roadmap-move.ts";
import type { Lane, RoadmapGroup, RoadmapItem } from "./types.ts";

const item = (id: string): RoadmapItem => ({
  id,
  title: `Item ${id}`,
  produto: "GeoCloud",
  prioridade: "Medium",
  effort: "Medium",
  desc: "",
  url: null,
  notes: [],
});

const board = () => ({
  lanes: [
    { id: "atual", title: "Sprint atual", dates: "", items: [item("a1"), item("a2")] },
    { id: "proxima", title: "Próxima sprint", dates: "", items: [item("p1")] },
  ] as Lane[],
  groups: [
    { id: "g1", title: "Grupo 1", items: [item("g1a")] },
    { id: "g2", title: "Grupo 2", items: [] },
  ] as RoadmapGroup[],
});

const ids = (l: { items: RoadmapItem[] }) => l.items.map((i) => i.id);

test("sprint to sprint: the item leaves one lane and joins the other, last", () => {
  const next = moveItem(board(), "a1", "proxima")!;
  assert.deepEqual(ids(next.lanes[0]), ["a2"]);
  assert.deepEqual(ids(next.lanes[1]), ["p1", "a1"]);
});

test("sprint to a Roadmap group: the item shows up in the group instead of vanishing", () => {
  const next = moveItem(board(), "a1", "g2")!;
  assert.deepEqual(ids(next.lanes[0]), ["a2"]);
  assert.deepEqual(ids(next.groups[1]), ["a1"]);
});

test("group to sprint", () => {
  const next = moveItem(board(), "g1a", "atual")!;
  assert.deepEqual(ids(next.groups[0]), []);
  assert.deepEqual(ids(next.lanes[0]), ["a1", "a2", "g1a"]);
});

test("group to another group", () => {
  const next = moveItem(board(), "g1a", "g2")!;
  assert.deepEqual(ids(next.groups[0]), []);
  assert.deepEqual(ids(next.groups[1]), ["g1a"]);
});

test("every item survives every move: nothing is ever lost or duplicated", () => {
  const all = (b: ReturnType<typeof board>) => [...b.lanes, ...b.groups].flatMap(ids).sort();
  const before = all(board());
  for (const itemId of before) {
    for (const target of ["atual", "proxima", "g1", "g2"]) {
      for (const beforeId of [null, ...before]) {
        const next = moveItem(board(), itemId, target, beforeId);
        if (next) assert.deepEqual(all(next), before, `${itemId} -> ${target} before ${beforeId}`);
      }
    }
  }
});

test("dropping on the group it is already in changes nothing (a group keeps its own order)", () => {
  assert.equal(moveItem(board(), "g1a", "g1"), null);
});

test("dropped on a card of a week, the item goes right before it: from another lane and within the same week", () => {
  const into = moveItem(board(), "g1a", "atual", "a2")!;
  assert.deepEqual(ids(into.lanes[0]), ["a1", "g1a", "a2"]);
  assert.deepEqual(ids(into.groups[0]), []);
  const onTop = moveItem(board(), "p1", "atual", "a1")!;
  assert.deepEqual(ids(onTop.lanes[0]), ["p1", "a1", "a2"]);
  assert.deepEqual(ids(onTop.lanes[1]), []);
  const reorder = moveItem(board(), "a2", "atual", "a1")!;
  assert.deepEqual(ids(reorder.lanes[0]), ["a2", "a1"]);
});

test("dropped on the empty part of its own week, the item goes last; already last, or already right before that card, nothing changes", () => {
  assert.deepEqual(ids(moveItem(board(), "a1", "atual")!.lanes[0]), ["a2", "a1"]);
  assert.equal(moveItem(board(), "a2", "atual"), null);
  assert.equal(moveItem(board(), "a1", "atual", "a2"), null);
});

test("dropped on itself, or on a card that is not in the target, nothing changes", () => {
  assert.equal(moveItem(board(), "a1", "atual", "a1"), null);
  assert.equal(moveItem(board(), "g1a", "atual", "p1"), null);
  assert.equal(moveItem(board(), "g1a", "atual", "nope"), null);
});

test("an unknown item or an unknown lane changes nothing (the item is not dropped from the board)", () => {
  assert.equal(moveItem(board(), "nope", "atual"), null);
  assert.equal(moveItem(board(), "a1", "nope"), null);
});

test("the input board is not mutated", () => {
  const original = board();
  moveItem(original, "a1", "g2");
  assert.deepEqual(original, board());
});

// The server's side of a drop on a week: the sort_order each item of the week gets, 0, 1, 2… in the new order.
const stored = (...pairs: [string, number][]) => pairs.map(([id, sortOrder]) => ({ id, sortOrder }));

test("dropOrder: the item dropped before a card takes its place, and only the neighbours whose number changes are written", () => {
  assert.deepEqual(dropOrder(stored(["a1", 0], ["a2", 1]), "g1a", "a2"), { sortOrder: 1, neighbors: [{ id: "a2", sortOrder: 2 }] });
  assert.deepEqual(dropOrder(stored(["a1", 0], ["a2", 1]), "g1a", "a1"), { sortOrder: 0, neighbors: [{ id: "a1", sortOrder: 1 }, { id: "a2", sortOrder: 2 }] });
});

test("dropOrder: with no card to go before, the item goes last (\"Mover para\", a drop on the empty part of a week, a new week)", () => {
  assert.deepEqual(dropOrder(stored(["a1", 0], ["a2", 1]), "g1a", null), { sortOrder: 2, neighbors: [] });
  assert.deepEqual(dropOrder([], "g1a", null), { sortOrder: 0, neighbors: [] });
});

test("dropOrder: within the same week the item leaves its old place, and ties or gaps left by older writers are evened out", () => {
  assert.deepEqual(dropOrder(stored(["a1", 0], ["a2", 1], ["a3", 2]), "a3", "a1"), {
    sortOrder: 0,
    neighbors: [{ id: "a1", sortOrder: 1 }, { id: "a2", sortOrder: 2 }],
  });
  assert.deepEqual(dropOrder(stored(["a1", 3], ["a2", 3], ["a3", 7]), "g1a", null), {
    sortOrder: 3,
    neighbors: [{ id: "a1", sortOrder: 0 }, { id: "a2", sortOrder: 1 }, { id: "a3", sortOrder: 2 }],
  });
});

test("dropOrder: a card that is not in the week, or the item itself, is no place to go before", () => {
  assert.equal(dropOrder(stored(["a1", 0]), "g1a", "p1"), null);
  assert.equal(dropOrder(stored(["a1", 0], ["a2", 1]), "a1", "a1"), null);
});
