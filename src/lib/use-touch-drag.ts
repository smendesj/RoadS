"use client";

import { useEffect, useState } from "react";
import { dropMove, edgeScrollSpeed, LONG_PRESS_MS, pressAfterMove, pressAfterTime, type PressState } from "@/lib/touch-drag";

// Dragging a Roadmap card with a finger (src/lib/touch-drag.ts has the rules). The desktop keeps the browser's own
// drag and drop; this only listens to touch. Touch events, not pointer events: once the browser starts panning it
// cancels the pointer, and a non-passive touchmove is the one way to keep the page still after the card lifts.
//
// The screen marks: every sprint and group carries data-lane-id (where a card can land); a scrolling area that
// should follow the finger near its edges carries data-drag-scroll="x" or "y" (the page itself always does).

type Press = {
  itemId: string;
  from: string;
  card: HTMLElement;
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
};

// Built once per Roadmap (the listeners it adds must be the very functions it later removes).
function touchDragController({ setLifted, setOver }: Ports) {
  let press: Press | null = null;
  let drop: (itemId: string, toLane: string) => void = () => {};
  let over: string | null = null;

  const laneAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest("[data-lane-id]") as HTMLElement | null)?.dataset.laneId ?? null;
  };

  const track = (x: number, y: number) => {
    if (!press) return;
    press.x = x;
    press.y = y;
    if (press.ghost) press.ghost.style.transform = `translate(${x - press.offsetX}px, ${y - press.offsetY}px) scale(1.03)`;
    const lane = laneAt(x, y);
    if (lane !== over) {
      over = lane;
      setOver(lane);
    }
  };

  // While the card is up, the areas under the finger scroll toward an edge it comes near.
  const scrollLoop = () => {
    if (!press || press.state !== "active") return;
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
    press.state = pressAfterTime(press.state, LONG_PRESS_MS);
    if (press.state !== "active") return;
    navigator.vibrate?.(15);
    const r = press.card.getBoundingClientRect();
    press.offsetX = press.x - r.left;
    press.offsetY = press.y - r.top;
    const ghost = press.card.cloneNode(true) as HTMLElement;
    ghost.setAttribute("data-touch-ghost", "");
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
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return end(false);
    if (press.state === "waiting") {
      press.state = pressAfterMove(press.state, t.clientX - press.startX, t.clientY - press.startY);
      press.x = t.clientX;
      press.y = t.clientY;
      if (press.state === "cancelled") end(false);
      return;
    }
    e.preventDefault(); // the card is up: the finger moves it, not the page
    track(t.clientX, t.clientY);
  };

  const onEnd = (e: TouchEvent) => {
    const wasActive = press?.state === "active";
    if (wasActive) e.preventDefault(); // no click on whatever is under the finger after a drop
    end(wasActive);
  };

  const onCancel = () => end(false);

  const onContextMenu = (e: Event) => {
    if (press) e.preventDefault(); // a long press is ours, not the browser's menu
  };

  function end(dropIt: boolean) {
    const p = press;
    if (!p) return;
    press = null;
    window.clearTimeout(p.timer);
    cancelAnimationFrame(p.frame);
    p.ghost?.remove();
    for (const { el, value } of p.snapped) el.style.scrollSnapType = value;
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onCancel);
    document.removeEventListener("contextmenu", onContextMenu);
    const target = dropIt ? laneAt(p.x, p.y) : null;
    over = null;
    setOver(null);
    setLifted(null);
    const move = dropMove(p.from, target);
    if (move) drop(p.itemId, move.to);
  }

  /** Wire to a draggable card's onTouchStart. */
  function start(e: React.TouchEvent<HTMLElement>, itemId: string, from: string) {
    if (press || e.touches.length !== 1) return;
    const t = e.touches[0];
    press = {
      itemId,
      from,
      card: e.currentTarget,
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
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: false });
    document.addEventListener("touchcancel", onCancel);
    document.addEventListener("contextmenu", onContextMenu);
  }

  return {
    start,
    cancel: () => end(false),
    /** What a drop does; set after every render, so it always sees the Roadmap as it is now. */
    onDrop: (fn: typeof drop) => {
      drop = fn;
    },
  };
}

export function useTouchDrag(onDrop: (itemId: string, toLane: string) => void) {
  const [lifted, setLifted] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [controller] = useState(() => touchDragController({ setLifted, setOver }));
  useEffect(() => {
    controller.onDrop(onDrop);
  });
  useEffect(() => controller.cancel, [controller]);
  return { start: controller.start, lifted, over };
}