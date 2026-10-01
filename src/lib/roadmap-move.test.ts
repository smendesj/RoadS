import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem } from "./roadmap-move.ts";
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
      const next = moveItem(board(), itemId, target);
      if (next) assert.deepEqual(all(next), before, `${itemId} -> ${target}`);
    }
  }
});

test("dropping on the lane it is already in changes nothing", () => {
  assert.equal(moveItem(board(), "a1", "atual"), null);
  assert.equal(moveItem(board(), "g1a", "g1"), null);
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
