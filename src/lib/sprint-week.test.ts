import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentWeekLane,
  newWeekLane,
  sprintIdFor,
  sprintLanesByDate,
  todayInSaoPaulo,
  weekLanes,
  weekTitle,
} from "./sprint-week.ts";

const week = (id: string, start: string | null, end: string | null, kind = "sprint") => ({ id, kind, start_date: start, end_date: end });

test("a week's id is sprint- and its Monday as DD-MM-AAAA", () => {
  assert.equal(sprintIdFor("2026-10-12"), "sprint-12-10-2026");
  assert.equal(sprintIdFor("2027-01-04"), "sprint-04-01-2027");
});

test("a week is titled by its dates only, with an en dash, and the month on both ends when it changes", () => {
  assert.equal(weekTitle("2026-10-12", "2026-10-16"), "Sprint 12–16/10");
  assert.equal(weekTitle("2026-09-28", "2026-10-02"), "Sprint 28/09–02/10");
});

test("today is the calendar day in São Paulo, not in UTC", () => {
  assert.equal(todayInSaoPaulo(new Date("2026-10-17T02:30:00Z")), "2026-10-16");
  assert.equal(todayInSaoPaulo(new Date("2026-10-17T03:30:00Z")), "2026-10-17");
});

test("the current week is the sprint lane whose dates hold today, whatever its id", () => {
  const lanes = [
    week("terceira", "2026-10-26", "2026-10-30"),
    week("atual", "2026-10-12", "2026-10-16"),
    week("proxima", "2026-10-19", "2026-10-23"),
  ];
  assert.equal(currentWeekLane(lanes, "2026-10-14")?.id, "atual");
  assert.equal(currentWeekLane(lanes, "2026-10-12")?.id, "atual", "its Monday");
  assert.equal(currentWeekLane(lanes, "2026-10-16")?.id, "atual", "its Friday");
  assert.equal(currentWeekLane([week("sprint-19-10-2026", "2026-10-19", "2026-10-23")], "2026-10-21")?.id, "sprint-19-10-2026");
});

test("on a weekend the week that ended is over: the current week is the one that starts on the next Monday", () => {
  const lanes = [week("sprint-12-10-2026", "2026-10-12", "2026-10-16"), week("sprint-19-10-2026", "2026-10-19", "2026-10-23")];
  assert.equal(currentWeekLane(lanes, "2026-10-17")?.id, "sprint-19-10-2026");
  assert.equal(currentWeekLane(lanes, "2026-10-18")?.id, "sprint-19-10-2026");
});

test("no current week when no sprint lane holds today: a past or a later week is never taken for it", () => {
  const lanes = [week("sprint-05-10-2026", "2026-10-05", "2026-10-09"), week("sprint-26-10-2026", "2026-10-26", "2026-10-30")];
  assert.equal(currentWeekLane(lanes, "2026-10-14"), null);
});

test("the e2e fixture, a group, and a sprint lane with no dates are never the current week", () => {
  const lanes = [
    week("zz-test-sprint", "2026-10-12", "2026-10-16"),
    week("g1", "2026-10-12", "2026-10-16", "group"),
    week("sem-datas", null, null),
  ];
  assert.equal(currentWeekLane(lanes, "2026-10-14"), null);
  assert.deepEqual(weekLanes(lanes), []);
});

test("a week that has to be created for today is named and dated by its Monday, Monday to Friday", () => {
  assert.deepEqual(newWeekLane("2026-10-14"), {
    id: "sprint-12-10-2026",
    title: "Sprint 12–16/10",
    kind: "sprint",
    start_date: "2026-10-12",
    end_date: "2026-10-16",
  });
  assert.equal(newWeekLane("2026-10-12").id, "sprint-12-10-2026", "a Monday is its own week");
  assert.equal(newWeekLane("2026-10-18").id, "sprint-19-10-2026", "a Sunday belongs to the week ahead");
  assert.equal(newWeekLane("2026-12-30").end_date, "2027-01-01", "across the turn of the year");
});

test("sprint lanes go in the order of their start date, never of their id or stored order", () => {
  const lanes = [
    { ...week("sprint-02-11-2026", "2026-11-02", "2026-11-06"), sort_order: 1 },
    { ...week("sprint-26-10-2026", "2026-10-26", "2026-10-30"), sort_order: 2 },
    { ...week("sprint-19-10-2026", "2026-10-19", "2026-10-23"), sort_order: 3 },
    { ...week("sem-datas", null, null), sort_order: 0 },
  ];
  assert.deepEqual(sprintLanesByDate(lanes).map((l) => l.id), ["sprint-19-10-2026", "sprint-26-10-2026", "sprint-02-11-2026", "sem-datas"]);
});
