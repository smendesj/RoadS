import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED_BEFORE_WEEK, closedBeforeTheirWeek } from "./closed-before-week.ts";

// Friday 16/10/2026: the current week is 12–16/10; 19–23/10 and 26–30/10 are to come; 05–09/10 ended.
const TODAY = "2026-10-16";
const lane = (id: string, start: string | null, end: string | null, kind = "sprint") => ({ id, kind, start_date: start, end_date: end });
const LANES = [
  lane("sprint-05-10-2026", "2026-10-05", "2026-10-09"),
  lane("sprint-12-10-2026", "2026-10-12", "2026-10-16"),
  lane("sprint-19-10-2026", "2026-10-19", "2026-10-23"),
  lane("sprint-26-10-2026", "2026-10-26", "2026-10-30"),
  lane("zz-test-sprint", "2026-12-07", "2026-12-11"),
  lane("sem-datas", null, null),
  lane("tipo-bug", null, null, "group"),
];
// Issues 900001… are on the Project; only 900002 and 900005 are still open.
const ON_PROJECT = new Set([900001, 900002, 900003, 900004, 900005, 900006, 900007]);
const OPEN = new Set([900002, 900005]);

test("the reason the remove is queued with", () => {
  assert.equal(CLOSED_BEFORE_WEEK, "issue closed before its sprint");
});

test("an item of a week to come whose issue was closed leaves that week; one whose issue is open stays", () => {
  const items = [
    { id: "a", laneId: "sprint-19-10-2026", number: 900001 },
    { id: "b", laneId: "sprint-19-10-2026", number: 900002 },
    { id: "c", laneId: "sprint-26-10-2026", number: 900003 },
  ];
  assert.deepEqual(closedBeforeTheirWeek({ today: TODAY, lanes: LANES, items, open: OPEN, onProject: ON_PROJECT }), [
    { id: "a", laneId: "sprint-19-10-2026" },
    { id: "c", laneId: "sprint-26-10-2026" },
  ]);
});

test("the current week and a week that ended keep their closed issues: the turn of the week takes them out as done", () => {
  const items = [
    { id: "now", laneId: "sprint-12-10-2026", number: 900004 },
    { id: "past", laneId: "sprint-05-10-2026", number: 900006 },
  ];
  assert.deepEqual(closedBeforeTheirWeek({ today: TODAY, lanes: LANES, items, open: OPEN, onProject: ON_PROJECT }), []);
});

test("on a weekend the week of the next Monday is the current one, so it keeps its closed issues too", () => {
  const items = [
    { id: "next", laneId: "sprint-19-10-2026", number: 900001 },
    { id: "after", laneId: "sprint-26-10-2026", number: 900003 },
  ];
  assert.deepEqual(closedBeforeTheirWeek({ today: "2026-10-17", lanes: LANES, items, open: OPEN, onProject: ON_PROJECT }), [
    { id: "after", laneId: "sprint-26-10-2026" },
  ]);
});

test("an item with no issue, an issue no longer on the Project, the e2e week, a lane with no dates and a type lane are left alone", () => {
  const items = [
    { id: "draft", laneId: "sprint-19-10-2026", number: null },
    { id: "off", laneId: "sprint-19-10-2026", number: 900099 },
    { id: "fixture", laneId: "zz-test-sprint", number: 900007 },
    { id: "undated", laneId: "sem-datas", number: 900007 },
    { id: "backlog", laneId: "tipo-bug", number: 900007 },
  ];
  assert.deepEqual(closedBeforeTheirWeek({ today: TODAY, lanes: LANES, items, open: OPEN, onProject: ON_PROJECT }), []);
});
