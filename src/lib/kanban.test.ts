import { test } from "node:test";
import assert from "node:assert/strict";
import { kanbanColumns, weekLabel } from "./kanban.ts";
import type { RoadmapItem } from "./types.ts";

const item = (id: string, url: string | null, createdAt = "2026-10-01T10:00:00Z"): RoadmapItem => ({
  id,
  title: `Item ${id}`,
  produto: "GeoCloud",
  prioridade: "Medium",
  effort: "Medium",
  desc: "",
  url,
  createdAt,
  notes: [],
});
const issue = (n: number, statusAt?: string) => ({ title: `Issue ${n}`, ref: `#${n}`, url: `u${n}`, ...(statusAt ? { statusAt } : {}) });

// Two weeks with an item each, two type lanes with the rest: issues open on the Project, in Development, blocked, and
// items with no issue on the board (drafts, and one whose issue the last sync did not see yet).
const board = () => ({
  lanes: [
    { id: "sprint-19-10-2026", title: "Sprint 19–23/10", start: "2026-10-19", items: [item("planned", "u12")] },
    { id: "zz-test-sprint", title: "Sprint 07–11/12", start: "2026-12-07", items: [item("draft-planned", null, "2026-10-10T10:00:00Z")] },
  ],
  groups: [
    {
      items: [
        item("unplanned", "u11"),
        item("draft", null, "2026-10-14T10:00:00Z"),
        item("draft-old", null, "2026-10-01T10:00:00Z"),
        item("unsynced", "u99", "2026-10-15T10:00:00Z"),
      ],
    },
    { items: [item("in-dev", "u13"), item("blocked", "u14")] },
  ],
});
const columns = (done: ReturnType<typeof issue>[] = []) => [
  { key: "open", items: [issue(11), issue(12), issue(15)] },
  { key: "dev", items: [issue(13)] },
  { key: "blocker", items: [issue(14)] },
  { key: "done", items: done },
];
const NOW = Date.parse("2026-10-16T12:00:00Z");
const view = (cards: ReturnType<typeof kanbanColumns>["open"]) =>
  cards.map((c) => [c.item?.id ?? null, c.issue?.ref ?? null, c.week?.label ?? null]);

test("weekLabel names a week by its first day, the label of a Kanban card planned in it", () => {
  assert.equal(weekLabel("2026-10-19"), "▸ Sprint 19/10");
  assert.equal(weekLabel("2026-12-07"), "▸ Sprint 07/12");
});

test("Open: the items with no issue on the board first, newest first, then every Open card of the Project in its order, each with its item and the week it is planned in", () => {
  assert.deepEqual(view(kanbanColumns(columns(), board(), NOW).open), [
    ["unsynced", null, null],
    ["draft", null, null],
    ["draft-planned", null, "▸ Sprint 07/12"],
    ["draft-old", null, null],
    ["unplanned", "#11", null],
    ["planned", "#12", "▸ Sprint 19/10"],
    [null, "#15", null],
  ]);
});

test("Open: an issue in Development or blocked on the Project is not in it, whatever lane its item is in", () => {
  const ids = kanbanColumns(columns(), board(), NOW).open.map((c) => c.item?.id);
  assert.ok(ids.includes("unplanned") && !ids.includes("in-dev") && !ids.includes("blocked"), JSON.stringify(ids));
});

test("Open: a card dragged to another week carries that week's label, and the card of the week it is planned in names the lane", () => {
  const b = board();
  const moved = b.lanes[0].items.pop()!;
  b.lanes[1].items.push(moved);
  const planned = kanbanColumns(columns(), b, NOW).open.find((c) => c.item?.id === "planned")!;
  assert.deepEqual(planned.week, { laneId: "zz-test-sprint", label: "▸ Sprint 07/12" });
});

test("Open: a sprint lane with no dates labels its cards by its title", () => {
  const b = { lanes: [{ id: "x", title: "[TESTE] sprint", items: [item("a", null)] }], groups: [] };
  assert.deepEqual(view(kanbanColumns([], b, NOW).open), [["a", null, "▸ [TESTE] sprint"]]);
});

test("Open with no snapshot yet: every item is in it, newest first", () => {
  const ids = kanbanColumns([], board(), NOW).open.map((c) => c.item?.id);
  assert.deepEqual(ids, ["unsynced", "draft", "draft-planned", "planned", "unplanned", "draft-old", "in-dev", "blocked"]);
});

test("Done: the cards that went to Done in the last 14 days, latest first, counted from when the Status changed; all of them, the same way, for 'Show all'", () => {
  const done = [
    issue(5, "2026-09-01T00:00:00Z"),
    issue(1, "2026-10-02T12:00:00Z"),
    issue(4),
    issue(3, "2026-10-15T09:00:00Z"),
    issue(2, "2026-10-02T11:59:59Z"),
  ];
  const { recent, all } = kanbanColumns(columns(done), board(), NOW).done;
  assert.deepEqual(recent.map((c) => c.ref), ["#3", "#1"]);
  assert.deepEqual(all.map((c) => c.ref), ["#3", "#1", "#2", "#5", "#4"]);
});
