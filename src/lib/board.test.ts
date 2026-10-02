import { test } from "node:test";
import assert from "node:assert/strict";
import { boardCard, statusByUrl, withIssueStatus } from "./board.ts";

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
