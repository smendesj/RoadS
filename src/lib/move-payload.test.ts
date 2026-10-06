import { test } from "node:test";
import assert from "node:assert/strict";
import { moveLanePayload } from "./move-payload.ts";

test("a move names the lane it went to and the lane it came from", () => {
  assert.deepEqual(moveLanePayload({ from: "sprint-a", to: "sprint-b" }), { lane_id: "sprint-b", from_lane_id: "sprint-a" });
});

test("the title and the reason come along only when there are some", () => {
  assert.deepEqual(moveLanePayload({ from: "a", to: "b", title: "Item de exemplo", reason: "sprints rotated" }), {
    lane_id: "b",
    from_lane_id: "a",
    title: "Item de exemplo",
    reason: "sprints rotated",
  });
  assert.deepEqual(Object.keys(moveLanePayload({ from: "a", to: "b", title: "Só o título" })).sort(), ["from_lane_id", "lane_id", "title"]);
});

test("both lanes are always there, whoever made the move: the contract promises them", () => {
  for (const extra of [{}, { title: "x" }, { reason: "y" }, { title: "x", reason: "y" }]) {
    const payload = moveLanePayload({ from: "origem", to: "destino", ...extra });
    assert.equal(payload.lane_id, "destino");
    assert.equal(payload.from_lane_id, "origem");
  }
});

test("nothing undefined is left in the payload, so the JSON stored is exactly what was meant", () => {
  assert.equal(JSON.stringify(moveLanePayload({ from: "a", to: "b", title: undefined })), '{"lane_id":"b","from_lane_id":"a"}');
});


test("the origin of a move says who made it, and is left out when nobody says", () => {
  for (const origin of ["app", "rotation", "label", "project"] as const) {
    assert.deepEqual(moveLanePayload({ from: "a", to: "b", origin }), { lane_id: "b", from_lane_id: "a", origin });
  }
  assert.equal("origin" in moveLanePayload({ from: "a", to: "b" }), false);
});
