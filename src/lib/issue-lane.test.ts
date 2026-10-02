import { test } from "node:test";
import assert from "node:assert/strict";
import { laneForLabels, tipoForLabels } from "./issue-lane.ts";

test("files an issue in the block of its type label", () => {
  assert.equal(laneForLabels(["area:backend", "type:bug"]), "tipo-bug");
  assert.equal(laneForLabels(["type:feature", "priority:high"]), "tipo-feature");
  assert.equal(laneForLabels(["type:epic"]), "tipo-epic");
});

test("an epic wins over the type it also carries", () => {
  assert.equal(laneForLabels(["type:feature", "type:epic"]), "tipo-epic");
  assert.equal(tipoForLabels(["type:epic", "type:feature"]), "feature");
});

test("an issue without a known type label has no block", () => {
  assert.equal(laneForLabels([]), null);
  assert.equal(laneForLabels(["security", "type:unknown"]), null);
});

test("an epic alone has no stored type", () => {
  assert.equal(tipoForLabels(["type:epic"]), null);
  assert.equal(tipoForLabels(["type:spike"]), "spike");
});
