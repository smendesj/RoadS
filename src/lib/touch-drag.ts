// The rules of dragging a Roadmap card with a finger (use-touch-drag.ts plays them on the screen). A press lifts the
// card only after the finger rests LONG_PRESS_MS in place: moving more than MOVE_TOLERANCE_PX before that is the
// page being scrolled, and stays so. While a card is lifted, the scrolling area under the finger scrolls toward an
// edge it comes near, faster the closer it gets. Dropping it on another sprint or group moves it; anywhere else it
// goes back. Pure, so the rules run under test without a screen.

export const LONG_PRESS_MS = 250;
export const MOVE_TOLERANCE_PX = 8;
/** How far from an edge the area starts scrolling, and its fastest pace (px per frame). */
export const EDGE_PX = 56;
export const MAX_SCROLL_PX = 18;

export type PressState = "waiting" | "active" | "cancelled";

export function pressAfterTime(state: PressState, elapsedMs: number): PressState {
  return state === "waiting" && elapsedMs >= LONG_PRESS_MS ? "active" : state;
}

export function pressAfterMove(state: PressState, dx: number, dy: number): PressState {
  return state === "waiting" && Math.hypot(dx, dy) > MOVE_TOLERANCE_PX ? "cancelled" : state;
}

/** Scroll step for a finger at `pos` in an area spanning `start`..`end`: negative toward the start, positive toward the end. */
export function edgeScrollSpeed(pos: number, start: number, end: number): number {
  const pace = (depth: number) => Math.round(MAX_SCROLL_PX * Math.min(1, depth / EDGE_PX));
  if (pos < start + EDGE_PX) return -pace(start + EDGE_PX - pos);
  if (pos > end - EDGE_PX) return pace(pos - (end - EDGE_PX));
  return 0;
}

export function dropMove(from: string, to: string | null): { from: string; to: string } | null {
  return to && to !== from ? { from, to } : null;
}

/** For this long after a finger last held a card, a browser drag on it is the browser's own long press: it gives way. */
export const NATIVE_DRAG_GUARD_MS = 1_500;

export function touchOwnsDrag(lastTouchAt: number | null, now: number): boolean {
  return lastTouchAt !== null && now - lastTouchAt < NATIVE_DRAG_GUARD_MS;
}
