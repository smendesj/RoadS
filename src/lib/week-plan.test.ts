import { test } from "node:test";
import assert from "node:assert/strict";
import { mayDeleteEmptyWeek, weekFate, weekRow, weekToCreate } from "./week-plan.ts";

test("a week dropped on is created with its id, title and dates derived from its Monday", () => {
  assert.deepEqual(weekToCreate("sprint-19-10-2026", "2026-10-16"), {
    ok: true,
    lane: { id: "sprint-19-10-2026", title: "Sprint 19–23/10", kind: "sprint", start_date: "2026-10-19", end_date: "2026-10-23" },
  });
  assert.deepEqual(weekToCreate("sprint-30-11-2026", "2026-10-16"), {
    ok: true,
    lane: { id: "sprint-30-11-2026", title: "Sprint 30/11–04/12", kind: "sprint", start_date: "2026-11-30", end_date: "2026-12-04" },
  });
  // The current week may be created too (an item dropped on it when it has no lane yet).
  assert.deepEqual(weekToCreate("sprint-12-10-2026", "2026-10-16"), {
    ok: true,
    lane: { id: "sprint-12-10-2026", title: "Sprint 12–16/10", kind: "sprint", start_date: "2026-10-12", end_date: "2026-10-16" },
  });
});

test("a week id that is not a real Monday's is refused", () => {
  for (const id of ["sprint-31-02-2027", "sprint-1-10-2026", "sprint-19-10-2026 ", "zz-test-sprint", "atual", "tipo-bug", "sprint-19-13-2026", ""]) {
    assert.deepEqual(weekToCreate(id, "2026-10-16"), { ok: false, reason: "invalid" }, id);
  }
  assert.deepEqual(weekToCreate("sprint-20-10-2026", "2026-10-16"), { ok: false, reason: "not_monday" });
  assert.deepEqual(weekToCreate("sprint-25-10-2026", "2026-10-16"), { ok: false, reason: "not_monday" });
});

test("a week before the current one is refused, and on a weekend the week that ended is already past", () => {
  assert.deepEqual(weekToCreate("sprint-05-10-2026", "2026-10-16"), { ok: false, reason: "past" });
  assert.deepEqual(weekToCreate("sprint-12-10-2026", "2026-10-17"), { ok: false, reason: "past" });
  assert.equal(weekToCreate("sprint-19-10-2026", "2026-10-17").ok, true);
});

test("a week at most 52 weeks after the current one may be created, not later", () => {
  assert.equal(weekToCreate("sprint-11-10-2027", "2026-10-16").ok, true);
  assert.deepEqual(weekToCreate("sprint-18-10-2027", "2026-10-16"), { ok: false, reason: "too_far" });
});

test("a sprint lane is future, current or ended by its first day against the current week's Monday", () => {
  assert.equal(weekFate("2026-10-19", "2026-10-16"), "future");
  assert.equal(weekFate("2026-10-12", "2026-10-16"), "current");
  assert.equal(weekFate("2026-10-05", "2026-10-16"), "ended");
  // Saturday: the week that ended is over, the next Monday's is the current one.
  assert.equal(weekFate("2026-10-12", "2026-10-17"), "ended");
  assert.equal(weekFate("2026-10-19", "2026-10-17"), "current");
  assert.equal(weekFate("2026-10-26", "2026-10-17"), "future");
});

const lane = (id: string, start_date: string, end_date: string) => ({ id, start_date, end_date });
const shape = (row: ReturnType<typeof weekRow>) => row.map((w) => [w.id, w.virtual, w.current]);

test("the row goes from the current week to the last stored one, a gap shown but not stored, and one empty week at the end", () => {
  const row = weekRow([lane("sprint-26-10-2026", "2026-10-26", "2026-10-30"), lane("sprint-12-10-2026", "2026-10-12", "2026-10-16")], "2026-10-16");
  assert.deepEqual(shape(row), [
    ["sprint-12-10-2026", false, true],
    ["sprint-19-10-2026", true, false],
    ["sprint-26-10-2026", false, false],
    ["sprint-02-11-2026", true, false],
  ]);
  assert.deepEqual(
    row.map((w) => [w.start, w.end]),
    [["2026-10-12", "2026-10-16"], ["2026-10-19", "2026-10-23"], ["2026-10-26", "2026-10-30"], ["2026-11-02", "2026-11-06"]]
  );
});

test("a past week still in the database stays at the front, and with nothing stored the current week shows with one after it", () => {
  assert.deepEqual(shape(weekRow([lane("sprint-05-10-2026", "2026-10-05", "2026-10-09")], "2026-10-16")), [
    ["sprint-05-10-2026", false, false],
    ["sprint-12-10-2026", true, true],
    ["sprint-19-10-2026", true, false],
  ]);
  // Saturday: the current week is the next Monday's.
  assert.deepEqual(shape(weekRow([], "2026-10-17")), [
    ["sprint-19-10-2026", true, true],
    ["sprint-26-10-2026", true, false],
  ]);
});

test("a stored lane holding a week, whatever its id, is that week: no copy of it is added", () => {
  assert.deepEqual(shape(weekRow([lane("atual", "2026-10-12", "2026-10-16"), lane("proxima", "2026-10-19", "2026-10-23")], "2026-10-16")), [
    ["atual", false, true],
    ["proxima", false, false],
    ["sprint-26-10-2026", true, false],
  ]);
});

test("no week is added past the 52-week horizon, though a stored one beyond it still shows", () => {
  const row = weekRow([lane("sprint-12-10-2026", "2026-10-12", "2026-10-16"), lane("sprint-25-10-2027", "2027-10-25", "2027-10-29")], "2026-10-16");
  assert.equal(row.length, 54);
  assert.deepEqual(shape(row.slice(-2)), [
    ["sprint-11-10-2027", true, false],
    ["sprint-25-10-2027", false, false],
  ]);
});

test("a positional lane is never deleted for being empty: it stays until migration 0031 renames it, a lane named by its date may go", () => {
  for (const id of ["atual", "proxima", "terceira"]) assert.equal(mayDeleteEmptyWeek(id), false, id);
  assert.equal(mayDeleteEmptyWeek("sprint-19-10-2026"), true);
});
