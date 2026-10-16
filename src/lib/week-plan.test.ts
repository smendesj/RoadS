import { test } from "node:test";
import assert from "node:assert/strict";
import { weekFate, weekToCreate } from "./week-plan.ts";

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

test("a week lane is future, current or ended by its Monday against today's; any other lane is none of them", () => {
  assert.equal(weekFate("sprint-19-10-2026", "2026-10-16"), "future");
  assert.equal(weekFate("sprint-12-10-2026", "2026-10-16"), "current");
  assert.equal(weekFate("sprint-05-10-2026", "2026-10-16"), "ended");
  // Saturday: the week that ended is over, the next Monday's is the current one.
  assert.equal(weekFate("sprint-12-10-2026", "2026-10-17"), "ended");
  assert.equal(weekFate("sprint-19-10-2026", "2026-10-17"), "current");
  assert.equal(weekFate("sprint-26-10-2026", "2026-10-17"), "future");
  for (const id of ["zz-test-sprint", "atual", "proxima", "tipo-bug", "sprint-20-10-2026", "sprint-31-02-2027"]) {
    assert.equal(weekFate(id, "2026-10-16"), null, id);
  }
});
