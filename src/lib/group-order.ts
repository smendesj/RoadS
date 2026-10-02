import { TRIAGE_LANE, TYPE_LANES } from "./issue-lane.ts";

type Group = { id: string; items: { number?: number | null }[] };

// The type blocks come first, the one holding the highest issue number on top (an empty one goes
// last among them); the curated groups follow in their own order.
export function orderGroups<G extends Group>(groups: G[]): G[] {
  const isTypeBlock = (g: G) => g.id === TRIAGE_LANE || TYPE_LANES.includes(g.id);
  const highest = (g: G) => Math.max(0, ...g.items.map((it) => it.number ?? 0));
  const typeBlocks = groups.filter(isTypeBlock).sort((a, b) => highest(b) - highest(a));
  return [...typeBlocks, ...groups.filter((g) => !isTypeBlock(g))];
}
