import { test } from "node:test";
import assert from "node:assert/strict";
import { columnClass, KANBAN_TABS, shownTab } from "./kanban-tabs.ts";

test("a narrow screen has two tabs, Open first and Done second", () => {
  assert.deepEqual(KANBAN_TABS, [
    { id: "open", label: "Open" },
    { id: "done", label: "Done" },
  ]);
});

test("the tab shown is the one picked while no card of a week is being carried", () => {
  assert.equal(shownTab("open", false), "open");
  assert.equal(shownTab("done", false), "done");
});

test("while a card taken out of a week is carried, Open shows, the place it is dropped to unplan it", () => {
  assert.equal(shownTab("done", true), "open");
  assert.equal(shownTab("open", true), "open");
});

test("below lg only the shown tab's column is on screen; from lg both columns are, side by side", () => {
  assert.equal(columnClass("open", "open"), "flex");
  assert.equal(columnClass("done", "open"), "hidden lg:flex");
  assert.equal(columnClass("open", "done"), "hidden lg:flex");
  assert.equal(columnClass("done", "done"), "flex");
});
