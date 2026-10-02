import { test } from "node:test";
import assert from "node:assert/strict";
import { laneForLabels } from "./issue-lane.ts";

test("files an issue in the block of its type label", () => {
  assert.equal(laneForLabels(["area:backend", "type:bug"]), "tipo-bug");
  assert.equal(laneForLabels(["type:feature", "priority:high"]), "tipo-feature");
});

test("leaves issues without a known type label in the no-type block", () => {
  assert.equal(laneForLabels([]), "triagem");
  assert.equal(laneForLabels(["security", "type:epic"]), "triagem");
});
