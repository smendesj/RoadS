import { test } from "node:test";
import assert from "node:assert/strict";
import { boardCard } from "./board.ts";

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
