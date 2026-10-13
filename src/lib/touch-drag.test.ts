import { test } from "node:test";
import assert from "node:assert/strict";
import { dropMove, edgeScrollSpeed, LONG_PRESS_MS, MOVE_TOLERANCE_PX, pressAfterMove, pressAfterTime } from "./touch-drag.ts";

test("holding a card still for 250 ms lifts it", () => {
  assert.equal(LONG_PRESS_MS, 250);
  assert.equal(pressAfterTime("waiting", 249), "waiting");
  assert.equal(pressAfterTime("waiting", 250), "active");
});

test("moving the finger more than 8 px before that is a scroll, and the card never lifts", () => {
  assert.equal(MOVE_TOLERANCE_PX, 8);
  assert.equal(pressAfterMove("waiting", 3, 4), "waiting", "5 px is a finger resting");
  assert.equal(pressAfterMove("waiting", 0, 9), "cancelled");
  assert.equal(pressAfterMove("waiting", -7, -7), "cancelled", "about 9.9 px diagonally");
  assert.equal(pressAfterTime("cancelled", 1_000), "cancelled", "a scroll stays a scroll however long the finger stays");
});

test("once lifted, the card follows the finger however far it goes", () => {
  assert.equal(pressAfterMove("active", 400, -300), "active");
  assert.equal(pressAfterTime("active", 5_000), "active");
});

test("near an edge the area scrolls toward it, faster the closer the finger; in the middle it stays put", () => {
  // A 400 px wide strip from x=0 to x=400, with 56 px edges and 18 px per frame at most.
  assert.equal(edgeScrollSpeed(200, 0, 400), 0);
  assert.equal(edgeScrollSpeed(56, 0, 400), 0, "the edge zone starts inside the 56 px");
  assert.equal(edgeScrollSpeed(0, 0, 400), -18, "on the very edge: full speed back");
  assert.equal(edgeScrollSpeed(28, 0, 400), -9, "half way into the edge zone: half speed");
  assert.equal(edgeScrollSpeed(372, 0, 400), 9);
  assert.equal(edgeScrollSpeed(400, 0, 400), 18);
  assert.equal(edgeScrollSpeed(-30, 0, 400), -18, "past the edge never goes faster than the cap");
  assert.equal(edgeScrollSpeed(450, 0, 400), 18);
});

test("dropping on another sprint or group moves the card; on its own, or on nothing, it goes back and nothing is saved", () => {
  assert.deepEqual(dropMove("atual", "proxima"), { from: "atual", to: "proxima" });
  assert.deepEqual(dropMove("tipo-feature", "atual"), { from: "tipo-feature", to: "atual" });
  assert.equal(dropMove("atual", "atual"), null);
  assert.equal(dropMove("atual", null), null);
});
