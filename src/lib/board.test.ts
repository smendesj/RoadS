import { test } from "node:test";
import assert from "node:assert/strict";
import { boardCard, projectCard, statusByUrl, withIssueStatus, withStatusWrites } from "./board.ts";

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
