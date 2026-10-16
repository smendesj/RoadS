import type { Lane, RoadmapGroup, RoadmapItem } from "./types.ts";

type Board = { lanes: Lane[]; groups: RoadmapGroup[] };

// The board as it looks after `itemId` is dropped on `targetLaneId`, or null when nothing should change. The target
// can be a sprint lane (a week) or a Roadmap group; the item must land in either, never just leave its old lane.
//
// A week keeps the order it is given: dropped on a card (`beforeId`), the item goes right before it, also within the
// week it is already in; dropped anywhere else in a week ("Mover para" too), it goes last. A group keeps its own
// order (by issue number on the screen), so a drop on the group it is already in changes nothing.
//
// Nothing changes for an unknown item or lane, a card that is not in the target, the item dropped on itself, or a
// drop that leaves the week in the order it had.
export function moveItem(board: Board, itemId: string, targetLaneId: string, beforeId: string | null = null): Board | null {
  const all = [...board.lanes, ...board.groups];
  const target = all.find((lane) => lane.id === targetLaneId);
  const item: RoadmapItem | undefined = all.flatMap((lane) => lane.items).find((it) => it.id === itemId);
  if (!target || !item || beforeId === itemId) return null;
  if (beforeId !== null && !target.items.some((it) => it.id === beforeId)) return null;
  const already = target.items.some((it) => it.id === itemId);
  if (already && !board.lanes.some((lane) => lane.id === targetLaneId)) return null;

  const rest = target.items.filter((it) => it.id !== itemId);
  const at = beforeId === null ? rest.length : rest.findIndex((it) => it.id === beforeId);
  const placed = [...rest.slice(0, at), item, ...rest.slice(at)];
  if (already && placed.every((it, i) => it.id === target.items[i].id)) return null;

  const place = <T extends { id: string; items: RoadmapItem[] }>(lane: T): T =>
    lane.id === targetLaneId ? { ...lane, items: placed } : { ...lane, items: lane.items.filter((it) => it.id !== itemId) };
  return { lanes: board.lanes.map(place), groups: board.groups.map(place) };
}

/**
 * Where `itemId` goes in a week when it is dropped there, as the server writes it: `items` are the week's items as
 * stored (in sort_order, with or without the dropped one). In the new order (before `beforeId`, or last when it is
 * null) every item is numbered 0, 1, 2…: the dropped item's number, and the neighbours whose number changes (ties
 * and gaps an older writer left are evened out on the way). Null when `beforeId` is the item itself or no item of
 * the week.
 */
export function dropOrder(
  items: { id: string; sortOrder: number }[],
  itemId: string,
  beforeId: string | null
): { sortOrder: number; neighbors: { id: string; sortOrder: number }[] } | null {
  const rest = items.filter((it) => it.id !== itemId);
  const at = beforeId === null ? rest.length : rest.findIndex((it) => it.id === beforeId);
  if (at < 0) return null;
  const order = [...rest.slice(0, at).map((it) => it.id), itemId, ...rest.slice(at).map((it) => it.id)];
  const was = new Map(rest.map((it) => [it.id, it.sortOrder]));
  const neighbors = order.flatMap((id, sortOrder) => (id !== itemId && was.get(id) !== sortOrder ? [{ id, sortOrder }] : []));
  return { sortOrder: at, neighbors };
}
