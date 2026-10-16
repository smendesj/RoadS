"use client";

import { useEffect, useState } from "react";
import { dropMove, edgeScrollSpeed, LONG_PRESS_MS, pressAfterMove, pressAfterTime, touchOwnsDrag, type PressState } from "@/lib/touch-drag";

// Dragging a Roadmap card with a finger (src/lib/touch-drag.ts has the rules). The desktop keeps the browser's own
// drag and drop; this only listens to touch. Touch events, not pointer events: once the browser starts panning it
// cancels the pointer, and a non-passive touchmove is the one way to keep the page still after the card lifts.
//
// The screen marks: every sprint and group carries data-lane-id (where a card can land), and every card in it
// data-item-id (the one a dropped card goes before); a scrolling area that should follow the finger near its edges
// carries data-drag-scroll="x" or "y" (the page itself always does).

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
};

type Ports = {
  setLifted(id: string | null): void;
  setOver(lane: string | null): void;
  setBefore(card: string | null): void;
};

// Built once per Roadmap (the listeners it adds must be the very functions it later removes).
function touchDragController({ setLifted, setOver, setBefore }: Ports) {
  let press: Press | null = null;
  let drop: (itemId: string, toLane: string, beforeId: string | null) => void = () => {};
  let over: string | null = null;
  let before: string | null = null;
  let lastTouchAt: number | null = null;

  // The lane under the finger, and the card under it in that lane (the copy that follows the finger lets the touch
  // through, so this is the card on the page).
  const spotAt = (x: number, y: number): { lane: string | null; card: string | null } => {
    const el = document.elementFromPoint(x, y);
    const lane = el?.closest("[data-lane-id]") as HTMLElement | null;
    const card = el?.closest("[data-item-id]") as HTMLElement | null;
    return { lane: lane?.dataset.laneId ?? null, card: lane && card && lane.contains(card) ? card.dataset.itemId ?? null : null };
  };

  const track = (x: number, y: number) => {
    if (!press) return;
    press.x = x;
    press.y = y;
    if (press.ghost) press.ghost.style.transform = `translate(${x - press.offsetX}px, ${y - press.offsetY}px) scale(1.03)`;
    const spot = spotAt(x, y);
    if (spot.lane !== over) {
      over = spot.lane;
      setOver(spot.lane);
    }
    if (spot.card !== before) {
      before = spot.card;
      setBefore(spot.card);
    }
  };

  // While the card is up, the areas under the finger scroll toward an edge it comes near.
  const scrollLoop = () => {
    if (!press || press.state !== "active") return;
    if (!press.card.isConnected) return end(false); // the card left the page (a reload replaced it)
    let el = document.elementFromPoint(press.x, press.y) as HTMLElement | null;
    while (el) {
      const axis = el.dataset?.dragScroll;
      if (axis) {
        const r = el.getBoundingClientRect();
        if (axis === "x") el.scrollLeft += edgeScrollSpeed(press.x, r.left, r.right);
        if (axis === "y") el.scrollTop += edgeScrollSpeed(press.y, r.top, r.bottom);
      }
      el = el.parentElement;
    }
    const pageStep = edgeScrollSpeed(press.y, 0, window.innerHeight);
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
    const spot = dropIt && p.card.isConnected ? spotAt(p.x, p.y) : { lane: null, card: null };
    over = null;
    before = null;
    setOver(null);
    setBefore(null);
    setLifted(null);
    const move = dropMove(p.itemId, p.from, spot.lane, spot.card);
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
    };
    target.addEventListener("touchmove", onMove as EventListener, { passive: false });
    target.addEventListener("touchend", onEnd as EventListener, { passive: false });
    target.addEventListener("touchcancel", onCancel);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("touchstart", onAnotherFinger);
  }

  return {
    start,
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
  const [over, setOver] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [controller] = useState(() => touchDragController({ setLifted, setOver, setBefore }));
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
  return { start: controller.start, touchOwnsDrag: controller.touchOwnsDrag, lifted, over, before };
}
