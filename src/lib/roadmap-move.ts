import type { Lane, RoadmapGroup, RoadmapItem } from "./types.ts";

type Board = { lanes: Lane[]; groups: RoadmapGroup[] };

// The board as it looks after `itemId` is dropped on `targetLaneId`, or null when nothing should change
// (unknown item, unknown lane, or the item is already there). The target can be a sprint lane or a
// Roadmap group; the item must land in either, never just leave its old lane.
export function moveItem(board: Board, itemId: string, targetLaneId: string): Board | null {
  const all = [...board.lanes, ...board.groups];
  const target = all.find((lane) => lane.id === targetLaneId);
  const item: RoadmapItem | undefined = all.flatMap((lane) => lane.items).find((it) => it.id === itemId);
  if (!target || !item || target.items.some((it) => it.id === itemId)) return null;

  const place = <T extends { id: string; items: RoadmapItem[] }>(lane: T): T => {
    const items = lane.items.filter((it) => it.id !== itemId);
    return { ...lane, items: lane.id === targetLaneId ? [...items, item] : items };
  };
  return { lanes: board.lanes.map(place), groups: board.groups.map(place) };
}
