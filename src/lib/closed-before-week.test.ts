import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED_BEFORE_WEEK, closedBeforeTheirWeek, removeClosedBeforeTheirWeek, type ClosedRemovalDeps } from "./closed-before-week.ts";

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

// ---- the sequence in the database: queue the remove, delete the item from its week, withdraw when nothing went,
// ---- delete the week to come it left empty (removeClosedBeforeTheirWeek, behind the ports the sync plugs in)

type Step = [string, ...unknown[]];

/** Ports that log every call in order; each can be told to fail or, for the delete, to find nothing. */
function fakePorts(over: { queueFails?: boolean; deleteFinds?: (id: string) => boolean; deleteFails?: boolean; weekFails?: boolean } = {}) {
  const log: Step[] = [];
  let next = 0;
  const deps: ClosedRemovalDeps = {
    async queue(row) {
      log.push(["queue", row]);
      if (over.queueFails) throw new Error("queue insert failed");
      return `queue-${++next}`;
    },
    async deleteFromWeek(id, laneId) {
      log.push(["deleteFromWeek", id, laneId]);
      if (over.deleteFails) throw new Error("delete failed");
      return over.deleteFinds ? over.deleteFinds(id) : true;
    },
    async unqueue(queueId) {
      log.push(["unqueue", queueId]);
    },
    async deleteFutureWeekIfEmpty(laneId) {
      log.push(["deleteFutureWeekIfEmpty", laneId]);
      if (over.weekFails) throw new Error("week delete failed");
      return true;
    },
  };
  return { deps, log };
}

const planned = (id: string, laneId: string, number: number) => ({ id, laneId, number, title: `Item sintético ${id}`, githubIssueUrl: `https://github.com/example/repo/issues/${number}` });
const removal = (items: ReturnType<typeof planned>[]) => ({ today: TODAY, lanes: LANES, items, open: OPEN, onProject: ON_PROJECT });

test("happy path: the remove is queued first with item_id null and the whole item in its payload, then the item is deleted from its week, then the emptied week goes", async () => {
  const { deps, log } = fakePorts();
  const left = await removeClosedBeforeTheirWeek(removal([planned("a", "sprint-19-10-2026", 900001)]), deps);
  assert.equal(left, 1);
  assert.deepEqual(log, [
    [
      "queue",
      {
        item_id: null,
        action: "remove",
        payload: { item_id: "a", lane_id: "sprint-19-10-2026", title: "Item sintético a", github_issue_url: "https://github.com/example/repo/issues/900001", reason: CLOSED_BEFORE_WEEK },
      },
    ],
    ["deleteFromWeek", "a", "sprint-19-10-2026"],
    ["deleteFutureWeekIfEmpty", "sprint-19-10-2026"],
  ]);
});

test("an item whose issue is still open, or that sits in the current week, is not touched at all", async () => {
  const { deps, log } = fakePorts();
  const left = await removeClosedBeforeTheirWeek(removal([planned("open", "sprint-19-10-2026", 900002), planned("now", "sprint-12-10-2026", 900004)]), deps);
  assert.equal(left, 0);
  assert.deepEqual(log, []);
});

test("a delete that finds the item no longer in that week (another sync took it) withdraws the queued remove and leaves the week alone", async () => {
  const { deps, log } = fakePorts({ deleteFinds: () => false });
  const left = await removeClosedBeforeTheirWeek(removal([planned("a", "sprint-19-10-2026", 900001)]), deps);
  assert.equal(left, 0);
  assert.deepEqual(
    log.map((s) => s[0]),
    ["queue", "deleteFromWeek", "unqueue"]
  );
  assert.deepEqual(log[2], ["unqueue", "queue-1"]);
});

test("a delete that fails withdraws the queued remove and fails the step", async () => {
  const { deps, log } = fakePorts({ deleteFails: true });
  await assert.rejects(removeClosedBeforeTheirWeek(removal([planned("a", "sprint-19-10-2026", 900001)]), deps), /delete failed/);
  assert.deepEqual(
    log.map((s) => s[0]),
    ["queue", "deleteFromWeek", "unqueue"]
  );
});

test("when queueing the remove fails, nothing is deleted: neither the item nor its week", async () => {
  const { deps, log } = fakePorts({ queueFails: true });
  await assert.rejects(removeClosedBeforeTheirWeek(removal([planned("a", "sprint-19-10-2026", 900001), planned("c", "sprint-26-10-2026", 900003)]), deps), /queue insert failed/);
  assert.deepEqual(
    log.map((s) => s[0]),
    ["queue"]
  );
});

test("each week to come that an item left goes once, after its items; a week whose delete found nothing is not asked; a failure there keeps the week and the count", async () => {
  const { deps, log } = fakePorts({ deleteFinds: (id) => id !== "c" });
  const items = [planned("a", "sprint-19-10-2026", 900001), planned("b", "sprint-19-10-2026", 900003), planned("c", "sprint-26-10-2026", 900006)];
  assert.equal(await removeClosedBeforeTheirWeek(removal(items), deps), 2);
  assert.deepEqual(
    log.filter((s) => s[0] === "deleteFutureWeekIfEmpty"),
    [["deleteFutureWeekIfEmpty", "sprint-19-10-2026"]]
  );
  assert.equal(log.findIndex((s) => s[0] === "deleteFutureWeekIfEmpty"), log.length - 1);

  const failing = fakePorts({ weekFails: true });
  assert.equal(await removeClosedBeforeTheirWeek(removal([planned("a", "sprint-19-10-2026", 900001)]), failing.deps), 1);
});
