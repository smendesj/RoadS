import { test } from "node:test";
import assert from "node:assert/strict";
import { orderGroups } from "./group-order.ts";

const group = (id: string, ...numbers: number[]) => ({ id, items: numbers.map((number) => ({ number })) });

test("the group with the highest issue number comes first, whatever lower numbers it also has", () => {
  const ordered = orderGroups([group("features", 913, 12, 880), group("bugs", 936, 10), group("produto", 916, 915, 914), group("chores", 929)]);
  assert.deepEqual(ordered.map((g) => g.id), ["bugs", "chores", "produto", "features"]);
});

test("an empty group goes last and groups that tie keep their order", () => {
  const ordered = orderGroups([group("vazio"), group("a", 5), group("b", 5), group("c", 7)]);
  assert.deepEqual(ordered.map((g) => g.id), ["c", "a", "b", "vazio"]);
});

test("items with no issue number count as zero", () => {
  const ordered = orderGroups([{ id: "sem-numero", items: [{ number: null }, {}] }, group("com-numero", 3)]);
  assert.deepEqual(ordered.map((g) => g.id), ["com-numero", "sem-numero"]);
});
