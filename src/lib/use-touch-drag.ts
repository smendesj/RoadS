"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { KANBAN } from "@/lib/issue-lane";
import { dropMove, edgeScrollSpeed, LONG_PRESS_MS, pressAfterMove, pressAfterTime, touchOwnsDrag, type PressState } from "@/lib/touch-drag";

// Dragging a Roadmap card with a finger (src/lib/touch-drag.ts has the rules). The desktop keeps the browser's own
// drag and drop; this only listens to touch. Touch events, not pointer events: once the browser starts panning it
// cancels the pointer, and a non-passive touchmove is the one way to keep the page still after the card lifts.
//
// The screen marks: every sprint and group carries data-lane-id (where a card can land), and every card in it
// data-item-id (the one a dropped card goes before); the Kanban's Open carries data-unplan-target (a card dropped there
// lands on KANBAN, before no card: the Roadmap unplans it); a scrolling area that should follow the finger near its
// edges carries data-drag-scroll="x" or "y" (the page itself always does).
//
// The lane and card under the finger change at every week it crosses: they live in a small store (TouchHover), not in
// the Roadmap's state, so only the lane and the card that light up or go dark render again (useTouchHover).

type Press = {
  itemId: string;
  from: string;
  card: HTMLElement;
  /** Where the touch started; its listeners live there (see start). */
  target: EventTarget;
  touchId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  state: PressState;
  timer: number;
  ghost: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  frame: number;
  snapped: { el: HTMLElement; value: string }[];
  /** Since when the finger has stayed in an edge zone of each scrolling area, and which edge (edgeScrollSpeed's heldMs). */
  edges: Map<HTMLElement | Window, { side: number; since: number }>;
};

/** The lane under the finger carrying a card, and the card under it there (the one the card would go before). */
export type TouchSpot = { over: string | null; before: string | null };

export type TouchHover = {
  get(): TouchSpot;
  subscribe(listener: () => void): () => void;
};

const NOWHERE: TouchSpot = { over: null, before: null };

// Built once per Roadmap (the listeners it adds must be the very functions it later removes).
function touchDragController(setLifted: (id: string | null) => void) {
  let press: Press | null = null;
  let drop: (itemId: string, toLane: string, beforeId: string | null) => void = () => {};
  let spot: TouchSpot = NOWHERE;
  const listeners = new Set<() => void>();
  const hover: TouchHover = {
    get: () => spot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setSpot = (next: TouchSpot) => {
    if (next.over === spot.over && next.before === spot.before) return;
    spot = next;
    for (const listener of listeners) listener();
  };
  let lastTouchAt: number | null = null;

  // The lane under the finger, and the card under it in that lane (the copy that follows the finger lets the touch
  // through, so this is the card on the page).
  const spotAt = (x: number, y: number): { lane: string | null; card: string | null } => {
    const el = document.elementFromPoint(x, y);
    if (!el?.closest("[data-lane-id]") && el?.closest("[data-unplan-target]")) return { lane: KANBAN, card: null };
    const lane = el?.closest("[data-lane-id]") as HTMLElement | null;
    const card = el?.closest("[data-item-id]") as HTMLElement | null;
    return { lane: lane?.dataset.laneId ?? null, card: lane && card && lane.contains(card) ? card.dataset.itemId ?? null : null };
  };

  const track = (x: number, y: number) => {
    if (!press) return;
    press.x = x;
    press.y = y;
    if (press.ghost) press.ghost.style.transform = `translate(${x - press.offsetX}px, ${y - press.offsetY}px) scale(1.03)`;
    const at = spotAt(x, y);
    setSpot({ over: at.lane, before: at.card });
  };

  // The step for one scrolling area, faster the longer the finger has stayed at the same edge of it; leaving the
  // edge, or turning to the other one, starts again from the base pace.
  const stepFor = (p: Press, area: HTMLElement | Window, pos: number, start: number, end: number, now: number) => {
    const side = Math.sign(edgeScrollSpeed(pos, start, end));
    const held = p.edges.get(area);
    if (!side) {
      p.edges.delete(area);
      return 0;
    }
    if (held?.side !== side) p.edges.set(area, { side, since: now });
    return edgeScrollSpeed(pos, start, end, now - (held?.side === side ? held.since : now));
  };

  // While the card is up, the areas under the finger scroll toward an edge it comes near.
  const scrollLoop = () => {
    if (!press || press.state !== "active") return;
    if (!press.card.isConnected) return end(false); // the card left the page (a reload replaced it)
    const now = performance.now();
    const under = new Set<HTMLElement | Window>([window]);
    let el = document.elementFromPoint(press.x, press.y) as HTMLElement | null;
    while (el) {
      const axis = el.dataset?.dragScroll;
      if (axis) {
        under.add(el);
        const r = el.getBoundingClientRect();
        if (axis === "x") el.scrollLeft += stepFor(press, el, press.x, r.left, r.right, now);
        if (axis === "y") el.scrollTop += stepFor(press, el, press.y, r.top, r.bottom, now);
      }
      el = el.parentElement;
    }
    // An area the finger left keeps no hold time: coming back, it starts at the base pace.
    for (const area of press.edges.keys()) if (!under.has(area)) press.edges.delete(area);
    const pageStep = stepFor(press, window, press.y, 0, window.innerHeight, now);
    if (pageStep) window.scrollBy(0, pageStep);
    track(press.x, press.y);
    press.frame = requestAnimationFrame(scrollLoop);
  };

  const lift = () => {
    if (!press) return;
    if (!press.card.isConnected) return end(false); // replaced before it lifted: nothing to lift
    press.state = pressAfterTime(press.state, LONG_PRESS_MS);
    if (press.state !== "active") return;
    navigator.vibrate?.(15);
    const r = press.card.getBoundingClientRect();
    press.offsetX = press.x - r.left;
    press.offsetY = press.y - r.top;
    const ghost = press.card.cloneNode(true) as HTMLElement;
    ghost.setAttribute("data-touch-ghost", "");
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("draggable");
    Object.assign(ghost.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${r.width}px`,
      margin: "0",
      zIndex: "1000",
      pointerEvents: "none",
      opacity: "0.95",
      boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
    });
    document.body.appendChild(ghost);
    press.ghost = ghost;
    // A snapping strip would pull back every step the drag scrolls it.
    for (const el of document.querySelectorAll<HTMLElement>('[data-drag-scroll="x"]')) {
      press.snapped.push({ el, value: el.style.scrollSnapType });
      el.style.scrollSnapType = "none";
    }
    setLifted(press.itemId);
    track(press.x, press.y);
    press.frame = requestAnimationFrame(scrollLoop);
  };

  const onMove = (e: TouchEvent) => {
    if (!press) return;
    if (e.touches.length > 1) return end(false); // a second finger: pinching or scrolling, not dragging
    const t = finger(e.touches);
    if (!t) return;
    if (press.state === "waiting") {
      press.state = pressAfterMove(press.state, t.clientX - press.startX, t.clientY - press.startY);
      press.x = t.clientX;
      press.y = t.clientY;
      if (press.state === "cancelled") end(false);
      return;
    }
    // The card is up: the finger moves it, not the page. A move the browser marks as not cancelable (it already took
    // the touch as a scroll) can't be held back; the card still follows the finger, and the page may move with it.
    if (e.cancelable) e.preventDefault();
    track(t.clientX, t.clientY);
  };

  const onEnd = (e: TouchEvent) => {
    if (!press || !finger(e.changedTouches)) return; // another finger lifting is not this drag ending
    const wasActive = press.state === "active";
    if (wasActive) e.preventDefault(); // no click on whatever is under the finger after a drop
    end(wasActive);
  };

  const onCancel = () => end(false);

  // A second finger anywhere (its events go to its own node, not to ours) means pinching or scrolling: no drag.
  const onAnotherFinger = (e: TouchEvent) => {
    if (e.touches.length > 1) end(false);
  };

  const onContextMenu = (e: Event) => {
    if (press) e.preventDefault(); // a long press is ours, not the browser's menu
  };

  // The touch that started the drag, among the touches of an event.
  const finger = (list: TouchList): Touch | null => {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === press?.touchId) return list[i];
    return null;
  };

  function end(dropIt: boolean) {
    const p = press;
    if (!p) return;
    press = null;
    window.clearTimeout(p.timer);
    cancelAnimationFrame(p.frame);
    p.ghost?.remove();
    for (const { el, value } of p.snapped) el.style.scrollSnapType = value;
    p.target.removeEventListener("touchmove", onMove as EventListener);
    p.target.removeEventListener("touchend", onEnd as EventListener);
    p.target.removeEventListener("touchcancel", onCancel);
    document.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("touchstart", onAnotherFinger);
    // A card that left the page mid-gesture (a reload replaced it) never drops anywhere.
    const at = dropIt && p.card.isConnected ? spotAt(p.x, p.y) : { lane: null, card: null };
    setSpot(NOWHERE);
    setLifted(null);
    const move = dropMove(p.itemId, p.from, at.lane, at.card);
    if (move) drop(p.itemId, move.to, move.before);
  }

  /** Wire to a draggable card's onTouchStart. */
  function start(e: React.TouchEvent<HTMLElement>, itemId: string, from: string) {
    lastTouchAt = Date.now();
    if (press || e.touches.length !== 1) return;
    const t = e.touches[0];
    // A touch keeps going to the node it started on even if that node leaves the page, where the document would
    // no longer hear it: the listeners go on that node, so a drag can always end.
    const target = e.target as EventTarget;
    press = {
      itemId,
      from,
      card: e.currentTarget,
      target,
      touchId: t.identifier,
      startX: t.clientX,
      startY: t.clientY,
      x: t.clientX,
      y: t.clientY,
      state: "waiting",
      timer: window.setTimeout(lift, LONG_PRESS_MS),
      ghost: null,
      offsetX: 0,
      offsetY: 0,
      frame: 0,
      snapped: [],
      edges: new Map(),
    };
    target.addEventListener("touchmove", onMove as EventListener, { passive: false });
    target.addEventListener("touchend", onEnd as EventListener, { passive: false });
    target.addEventListener("touchcancel", onCancel);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("touchstart", onAnotherFinger);
  }

  return {
    start,
    hover,
    cancel: () => end(false),
    /** True right after a finger held a card: a browser drag then is the browser's own long press (touchOwnsDrag). */
    // While a finger is on a card, however long it holds, the browser's drag is its long press; just after, too.
    touchOwnsDrag: () => press !== null || touchOwnsDrag(lastTouchAt, Date.now()),
    /** What a drop does; set after every render, so it always sees the Roadmap as it is now. */
    onDrop: (fn: typeof drop) => {
      drop = fn;
    },
  };
}

// iOS decides at touchstart whether a touch's moves may be held back, from the listeners already in place: one
// that is there all along (and does nothing) lets the drag hold the page still once the card lifts.
const noop = () => {};

export function useTouchDrag(onDrop: (itemId: string, toLane: string, beforeId: string | null) => void) {
  const [lifted, setLifted] = useState<string | null>(null);
  const [controller] = useState(() => touchDragController(setLifted));
  useEffect(() => {
    controller.onDrop(onDrop);
  });
  useEffect(() => {
    window.addEventListener("touchmove", noop, { passive: false });
    return () => {
      window.removeEventListener("touchmove", noop);
      controller.cancel();
    };
  }, [controller]);
  return { start: controller.start, touchOwnsDrag: controller.touchOwnsDrag, lifted, hover: controller.hover };
}

/** What a part of the screen reads from the spot under the finger; it renders again only when `select`'s answer changes. */
export function useTouchHover<T>(hover: TouchHover, select: (spot: TouchSpot) => T): T {
  return useSyncExternalStore(hover.subscribe, () => select(hover.get()), () => select(NOWHERE));
}
