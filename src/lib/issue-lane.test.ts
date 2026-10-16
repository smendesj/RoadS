import { test } from "node:test";
import assert from "node:assert/strict";
import { laneForLabels, releaseLane, tipoForLabels, unplanLane } from "./issue-lane.ts";

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

// Unplanning: a card dropped from a week on the Kanban goes back to a type lane, and the server picks which.
const TYPE_LANE_IDS = new Set(["tipo-feature", "tipo-bug", "tipo-chore", "tipo-spike", "tipo-epic"]);

test("released from a week, an item goes to the type lane of its issue's label, over the type it is stored with", () => {
  assert.equal(releaseLane(["type:bug", "area:backend"], "feature", TYPE_LANE_IDS), "tipo-bug");
  assert.equal(releaseLane(["type:feature", "type:epic"], "chore", TYPE_LANE_IDS), "tipo-epic");
});

test("with no type label it can file, it goes to the lane of its stored type", () => {
  assert.equal(releaseLane([], "chore", TYPE_LANE_IDS), "tipo-chore");
  assert.equal(releaseLane(["type:unknown"], "spike", TYPE_LANE_IDS), "tipo-spike");
  // A label naming a lane the database lacks does not count.
  assert.equal(releaseLane(["type:bug"], "chore", new Set(["tipo-chore"])), "tipo-chore");
});

test("with neither, nothing is named: the sync leaves such an item where it is", () => {
  assert.equal(releaseLane([], null, TYPE_LANE_IDS), null);
  assert.equal(releaseLane(["type:bug"], null, new Set(["tipo-feature"])), null);
});

test("unplanned by a drop on the Kanban, an item always lands in a type lane: with none named, the lane of a new item", () => {
  assert.equal(unplanLane(["type:bug"], null, TYPE_LANE_IDS), "tipo-bug");
  assert.equal(unplanLane([], "spike", TYPE_LANE_IDS), "tipo-spike");
  assert.equal(unplanLane([], null, TYPE_LANE_IDS), "tipo-feature");
});
