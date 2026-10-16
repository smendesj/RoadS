import { test } from "node:test";
import assert from "node:assert/strict";
import { boardCard, kanbanSort, otherRepoCounts, projectCard, sortCards, statusByUrl, withIssueStatus, withStatusWrites } from "./board.ts";

const node = (repo: string, status: string | null, number = 1) => ({
  content: { number, title: `Issue ${number}`, url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } },
  fieldValueByName: status ? { name: status } : null,
});

test("a GeoCloud issue with a status becomes a card in that column", () => {
  assert.deepEqual(boardCard(node("Essencis-Labs/GeoCloudAI", "Open", 7)), {
    status: "Open",
    card: { title: "Issue 7", ref: "#7", url: "https://github.com/Essencis-Labs/GeoCloudAI/issues/7" },
  });
});

test("a card keeps when its Status last changed on the Project, the moment the Roadmap's Done counts its 14 days from", () => {
  const moved = { ...node("Essencis-Labs/GeoCloudAI", "Done", 7), fieldValueByName: { name: "Done", updatedAt: "2026-10-09T14:30:00Z" } };
  assert.deepEqual(boardCard(moved), {
    status: "Done",
    card: { title: "Issue 7", ref: "#7", url: "https://github.com/Essencis-Labs/GeoCloudAI/issues/7", statusAt: "2026-10-09T14:30:00Z" },
  });
});

test("ELIMS issues on Project #7 never reach the RoadS board, whatever their status", () => {
  for (const status of ["Open", "Development", "Blocker", "Done"]) {
    assert.equal(boardCard(node("Essencis-Labs/ELIMS", status)), null);
  }
});

test("items without a known status or without an issue are skipped", () => {
  assert.equal(boardCard(node("Essencis-Labs/GeoCloudAI", null)), null);
  assert.equal(boardCard(node("Essencis-Labs/GeoCloudAI", "Someday")), null);
  assert.equal(boardCard({ content: {}, fieldValueByName: { name: "Open" } }), null);
});

test("statusByUrl maps every issue URL of the snapshot to its column's key", () => {
  const byUrl = statusByUrl([
    { key: "open", items: [{ url: "u1" }, { url: "u2" }] },
    { key: "done", items: [{ url: "u3" }] },
  ]);
  assert.equal(byUrl.get("u1"), "open");
  assert.equal(byUrl.get("u2"), "open");
  assert.equal(byUrl.get("u3"), "done");
  assert.equal(byUrl.get("nope"), undefined);
});

test("withIssueStatus marks sprint items with their snapshot status and leaves the rest untouched", () => {
  const columns = [
    { key: "done", items: [{ url: "u1" }] },
    { key: "dev", items: [{ url: "u2" }] },
  ];
  const lanes = [
    {
      id: "atual",
      items: [
        { url: "u1", title: "feito" },
        { url: "u2", title: "andando" },
        { url: "u3", title: "fora do board" },
        { url: null, title: "sem issue" },
      ],
    },
  ];
  const [lane] = withIssueStatus(lanes, columns);
  assert.deepEqual(lane.items.map((i) => (i as { status?: string }).status), ["done", "dev", undefined, undefined]);
  assert.equal(lanes[0].items[0].hasOwnProperty("status"), false, "the input is not mutated");
});

test("withIssueStatus with no snapshot marks nothing", () => {
  const [lane] = withIssueStatus([{ id: "atual", items: [{ url: "u1" }] }], []);
  assert.equal("status" in lane.items[0], false);
});


const cardNode = (over: { id?: string | null; repo?: string; number?: number | null; status?: string | null; at?: string | null } = {}) => {
  const { id = "PVTI_1", repo = "Essencis-Labs/GeoCloudAI", number = 7, status = "Development", at = "2026-10-06T20:49:07Z" } = over;
  return {
    ...(id ? { id } : {}),
    content: number ? { number, title: "Issue", url: `https://github.com/${repo}/issues/${number}`, repository: { nameWithOwner: repo } } : {},
    fieldValueByName: status ? { name: status, ...(at ? { updatedAt: at } : {}) } : null,
  };
};

test("projectCard keeps what the sprint sync needs of a GeoCloud card: its item on the Project, the issue, the status and since when", () => {
  assert.deepEqual(projectCard(cardNode()), { itemId: "PVTI_1", number: 7, status: "Development", statusAt: "2026-10-06T20:49:07Z" });
});

test("projectCard leaves out ELIMS, cards with no status or no time for it, and cards it could not write to", () => {
  assert.equal(projectCard(cardNode({ repo: "Essencis-Labs/ELIMS" })), null);
  assert.equal(projectCard(cardNode({ status: null })), null);
  assert.equal(projectCard(cardNode({ status: "Someday" })), null);
  assert.equal(projectCard(cardNode({ at: null })), null);
  assert.equal(projectCard(cardNode({ id: null })), null);
  assert.equal(projectCard(cardNode({ number: null })), null);
});

test("withStatusWrites moves a card to the column of the Status written and recounts both columns", () => {
  const card = (n: number) => ({ title: `i${n}`, ref: `#${n}`, url: `u${n}` });
  const columns = [
    { key: "open", title: "Open", count: 2, items: [card(1), card(2)] },
    { key: "dev", title: "Development", count: 1, items: [card(3)] },
    { key: "done", title: "Done", count: 1, items: [card(4)] },
  ];
  const next = withStatusWrites(columns, [
    { url: "u1", status: "Development" },
    { url: "u3", status: "Open" },
  ]);
  const view = (cols: typeof columns) => cols.map((c) => [c.key, c.count, c.items.map((i) => i.url)]);
  assert.deepEqual(view(next), [
    ["open", 2, ["u2", "u3"]],
    ["dev", 1, ["u1"]],
    ["done", 1, ["u4"]],
  ]);
  assert.deepEqual(view(columns), [["open", 2, ["u1", "u2"]], ["dev", 1, ["u3"]], ["done", 1, ["u4"]]], "the input is not mutated");
});

test("withStatusWrites ignores a card the snapshot doesn't have", () => {
  const columns = [{ key: "open", title: "Open", count: 1, items: [{ title: "a", ref: "#1", url: "u1" }] }];
  assert.deepEqual(withStatusWrites(columns, [{ url: "nope", status: "Development" }]), columns);
});

// The order of the Kanban view on GitHub, as the views query returns it (13/10/2026: Created, newest first).
const views = (sort: { field: string; direction: string }[], name = "Kanban") => [
  { name: "Tabela", sortByFields: { nodes: [{ direction: "DESC", field: { name: "Closed" } }] } },
  { name, sortByFields: { nodes: sort.map((s) => ({ direction: s.direction, field: { name: s.field } })) } },
];

test("kanbanSort reads the sort of the view named Kanban, field by field", () => {
  assert.deepEqual(kanbanSort(views([{ field: "Created", direction: "DESC" }])), [{ field: "Created", direction: "DESC" }]);
  assert.deepEqual(kanbanSort(views([{ field: "Title", direction: "ASC" }, { field: "Updated", direction: "DESC" }])), [
    { field: "Title", direction: "ASC" },
    { field: "Updated", direction: "DESC" },
  ]);
});

test("kanbanSort with no Kanban view, or one sorted by a field RoadS cannot read, keeps GitHub's manual order", () => {
  assert.deepEqual(kanbanSort(views([{ field: "Created", direction: "DESC" }], "Board")), []);
  assert.deepEqual(kanbanSort(views([{ field: "Priority", direction: "ASC" }])), []);
  assert.deepEqual(kanbanSort(undefined), []);
});

const entry = (n: number, createdAt: string, updatedAt = createdAt, title = `Issue ${n}`) => ({
  card: { title, ref: `#${n}`, url: `u${n}` },
  createdAt,
  updatedAt,
});

test("sortCards puts the newest issue first when the Kanban view sorts by Created, newest first", () => {
  // Read from the Project in its manual order: #951, #8, #979, #185.
  const cards = [entry(951, "2026-09-20T10:00:00Z"), entry(8, "2025-01-02T10:00:00Z"), entry(979, "2026-10-05T12:00:00Z"), entry(185, "2025-03-01T10:00:00Z")];
  assert.deepEqual(sortCards(cards, [{ field: "Created", direction: "DESC" }]).map((c) => c.ref), ["#979", "#951", "#185", "#8"]);
});

test("sortCards applies the next field to break a tie, then GitHub's manual order", () => {
  const cards = [entry(1, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "b"), entry(2, "2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z", "a"), entry(3, "2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z", "a")];
  assert.deepEqual(sortCards(cards, [{ field: "Title", direction: "ASC" }]).map((c) => c.ref), ["#2", "#3", "#1"]);
  assert.deepEqual(sortCards(cards, [{ field: "Created", direction: "ASC" }, { field: "Updated", direction: "DESC" }]).map((c) => c.ref), ["#2", "#3", "#1"]);
  assert.deepEqual(sortCards(cards, []).map((c) => c.ref), ["#1", "#2", "#3"], "no sort: the order read from GitHub");
});

test("otherRepoCounts counts, per Status, the cards of other repositories that the RoadS board leaves out", () => {
  const counts = otherRepoCounts([
    node("Essencis-Labs/ELIMS", "Open", 1),
    node("Essencis-Labs/ELIMS", "Open", 2),
    node("Essencis-Labs/ELIMS", "Done", 3),
    node("Essencis-Labs/GeoCloudAI", "Open", 4),
    node("Essencis-Labs/ELIMS", "Someday", 5),
    node("Essencis-Labs/ELIMS", null, 6),
  ]);
  assert.deepEqual(Object.fromEntries(counts), { Open: 2, Done: 1 });
});

test("kanbanSort follows the views exactly as GitHub returned them for Project #7 on 13/10/2026", () => {
  // Recorded from `gh api graphql` (views { name sortByFields { direction field { ... on ProjectV2FieldCommon { name } } } }).
  const recorded = [
    { name: "Kanban", sortByFields: { nodes: [{ direction: "DESC", field: { name: "Created" } }] } },
    { name: "Tabela", sortByFields: { nodes: [{ direction: "DESC", field: { name: "Closed" } }, { direction: "DESC", field: { name: "Created" } }] } },
    { name: "View 9", sortByFields: { nodes: [] } },
  ];
  assert.deepEqual(kanbanSort(recorded), [{ field: "Created", direction: "DESC" }]);
});
