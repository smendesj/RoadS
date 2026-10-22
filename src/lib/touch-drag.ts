// The rules of dragging a Roadmap card with a finger (use-touch-drag.ts plays them on the screen). A press lifts the
// card only after the finger rests LONG_PRESS_MS in place: moving more than MOVE_TOLERANCE_PX before that is the
// page being scrolled, and stays so. While a card is lifted, the scrolling area under the finger scrolls toward an
// edge it comes near, faster the closer it gets and the longer it stays there (a row of weeks is thousands of px long). Dropping it on a sprint or group moves it, before the card under the
// finger in a week; anywhere else it goes back. Pure, so the rules run under test without a screen.

export const LONG_PRESS_MS = 250;
export const MOVE_TOLERANCE_PX = 8;
/** How far from an edge the area starts scrolling, and its fastest pace (px per frame) as the finger gets there. */
export const EDGE_PX = 56;
export const MAX_SCROLL_PX = 18;
/** Held in the edge zone, that fastest pace climbs evenly to TOP_SCROLL_PX over EDGE_RAMP_MS. */
export const TOP_SCROLL_PX = 80;
export const EDGE_RAMP_MS = 1_000;

export type PressState = "waiting" | "active" | "cancelled";

export function pressAfterTime(state: PressState, elapsedMs: number): PressState {
  return state === "waiting" && elapsedMs >= LONG_PRESS_MS ? "active" : state;
}

export function pressAfterMove(state: PressState, dx: number, dy: number): PressState {
  return state === "waiting" && Math.hypot(dx, dy) > MOVE_TOLERANCE_PX ? "cancelled" : state;
}

/**
 * Scroll step for a finger at `pos` in an area spanning `start`..`end`: negative toward the start, positive toward the
 * end. `heldMs` is how long the finger has stayed in that edge zone (0 when it just came in, or came back).
 */
export function edgeScrollSpeed(pos: number, start: number, end: number, heldMs = 0): number {
  const cap = MAX_SCROLL_PX + (TOP_SCROLL_PX - MAX_SCROLL_PX) * Math.min(1, Math.max(0, heldMs) / EDGE_RAMP_MS);
  const pace = (depth: number) => Math.round(cap * Math.min(1, depth / EDGE_PX));
  if (pos < start + EDGE_PX) return -pace(start + EDGE_PX - pos);
  if (pos > end - EDGE_PX) return pace(pos - (end - EDGE_PX));
  return 0;
}

/**
 * What a finger lifting card `itemId` (from lane `from`) asks for: the lane under it (`to`) and the card under it
 * there (`before`), which the card goes right before; with no card under the finger, it goes last. Over its own card,
 * or over no lane, it goes back and nothing is saved. Whether the drop changes anything else (a group keeps its own
 * order, a card already in place stays) is moveItem's to say (src/lib/roadmap-move.ts).
 */
export function dropMove(itemId: string, from: string, to: string | null, before: string | null): { from: string; to: string; before: string | null } | null {
  return to && before !== itemId ? { from, to, before } : null;
}

/** For this long after a finger last held a card, a browser drag on it is the browser's own long press: it gives way. */
export const NATIVE_DRAG_GUARD_MS = 1_500;

export function touchOwnsDrag(lastTouchAt: number | null, now: number): boolean {
  return lastTouchAt !== null && now - lastTouchAt < NATIVE_DRAG_GUARD_MS;
}
