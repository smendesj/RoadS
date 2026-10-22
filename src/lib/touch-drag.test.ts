import { test } from "node:test";
import assert from "node:assert/strict";
import { dropMove, EDGE_RAMP_MS, edgeScrollSpeed, LONG_PRESS_MS, MOVE_TOLERANCE_PX, pressAfterMove, pressAfterTime, TOP_SCROLL_PX, touchOwnsDrag } from "./touch-drag.ts";

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

test("held at an edge, the area speeds up over a second to 80 px per frame; just arrived, it keeps the base pace", () => {
  // The same strip; the fourth argument is how long the finger has stayed in that edge zone.
  assert.equal(EDGE_RAMP_MS, 1_000);
  assert.equal(TOP_SCROLL_PX, 80);
  assert.equal(edgeScrollSpeed(400, 0, 400, 0), 18, "just arrived: the base pace");
  assert.equal(edgeScrollSpeed(400, 0, 400, 500), 49, "half a second in: half way from 18 to 80");
  assert.equal(edgeScrollSpeed(400, 0, 400, 1_000), 80);
  assert.equal(edgeScrollSpeed(400, 0, 400, 10_000), 80, "never faster than the top pace");
  assert.equal(edgeScrollSpeed(0, 0, 400, 1_000), -80, "toward the start too");
  assert.equal(edgeScrollSpeed(372, 0, 400, 1_000), 40, "half way into the edge zone: half the top pace");
  assert.equal(edgeScrollSpeed(200, 0, 400, 10_000), 0, "in the middle it stays put, however long the finger stays");
});

test("dropping on another sprint or group moves the card; on its own card, or on nothing, it goes back and nothing is saved", () => {
  assert.deepEqual(dropMove("a1", "atual", "proxima", null), { from: "atual", to: "proxima", before: null });
  assert.deepEqual(dropMove("g1a", "tipo-feature", "atual", null), { from: "tipo-feature", to: "atual", before: null });
  assert.equal(dropMove("a1", "atual", "atual", "a1"), null, "held over its own card: back in place");
  assert.equal(dropMove("a1", "atual", null, null), null);
});

test("dropped on a card, the card goes before it, in another week or in its own; on the empty part of its own week, last", () => {
  assert.deepEqual(dropMove("g1a", "tipo-feature", "atual", "a2"), { from: "tipo-feature", to: "atual", before: "a2" });
  assert.deepEqual(dropMove("a2", "atual", "atual", "a1"), { from: "atual", to: "atual", before: "a1" });
  assert.deepEqual(dropMove("a1", "atual", "atual", null), { from: "atual", to: "atual", before: null });
});

test("a browser drag that starts right after a finger held the card is the browser's long press, and gives way", () => {
  const now = 10_000;
  assert.equal(touchOwnsDrag(now - 600, now), true, "the native long press fires about 500 ms in");
  assert.equal(touchOwnsDrag(now - 1_400, now), true);
  assert.equal(touchOwnsDrag(now - 2_000, now), false, "a mouse drag long after a touch is a mouse drag");
  assert.equal(touchOwnsDrag(null, now), false, "no touch yet: a desktop drag");
});