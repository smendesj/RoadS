type Group = { items: { number?: number | null }[] };

// The group holding the highest issue number comes first, whatever lower numbers it also has; groups
// with no numbered issue go last. Groups that tie keep the order they came in.
export function orderGroups<G extends Group>(groups: G[]): G[] {
  const highest = (g: G) => Math.max(0, ...g.items.map((it) => it.number ?? 0));
  return groups
    .map((g, i) => ({ g, i, top: highest(g) }))
    .sort((a, b) => b.top - a.top || a.i - b.i)
    .map(({ g }) => g);
}
