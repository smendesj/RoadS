import { test } from "node:test";
import assert from "node:assert/strict";
import { orderGroups } from "./group-order.ts";

const group = (id: string, ...numbers: number[]) => ({ id, items: numbers.map((number) => ({ number })) });

test("the type block with the highest issue number comes first", () => {
  const ordered = orderGroups([group("tipo-feature", 120, 880), group("tipo-bug", 935, 10), group("tipo-chore", 929)]);
  assert.deepEqual(ordered.map((g) => g.id), ["tipo-bug", "tipo-chore", "tipo-feature"]);
});

test("an empty type block goes last among the type blocks and curated groups stay after, in order", () => {
  const ordered = orderGroups([group("g1", 999), group("tipo-spike"), group("g2", 5), group("triagem", 300), group("tipo-epic", 718)]);
  assert.deepEqual(ordered.map((g) => g.id), ["tipo-epic", "triagem", "tipo-spike", "g1", "g2"]);
});

test("items with no issue number count as zero", () => {
  const ordered = orderGroups([{ id: "tipo-bug", items: [{ number: null }, {}] }, group("tipo-feature", 3)]);
  assert.deepEqual(ordered.map((g) => g.id), ["tipo-feature", "tipo-bug"]);
});
