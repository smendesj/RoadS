import { test } from "node:test";
import assert from "node:assert/strict";
import { newestIssueFirst } from "./issue-order.ts";

const item = (title: string, number: number | null) => ({ title, number });

test("every block lists its issues from the highest number to the lowest", () => {
  const items = [item("b", 959), item("a", 976), item("c", 974), item("d", 975)];
  assert.deepEqual(newestIssueFirst(items, (i) => i.number).map((i) => i.number), [976, 975, 974, 959]);
});

test("items with no issue go last, in the order they had", () => {
  const items = [item("sem issue 1", null), item("x", 10), item("sem issue 2", null), item("y", 12)];
  assert.deepEqual(newestIssueFirst(items, (i) => i.number).map((i) => i.title), ["y", "x", "sem issue 1", "sem issue 2"]);
});

test("the list it was given is left as it was", () => {
  const items = [item("x", 1), item("y", 2)];
  newestIssueFirst(items, (i) => i.number);
  assert.deepEqual(items.map((i) => i.number), [1, 2]);
});
