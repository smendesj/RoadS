// The Roadmap block an open issue is filed in comes from its type:* label. An issue without a known
// one has no block and stays out of the Roadmap until it gets a type.
const BLOCK_TYPES = ["feature", "bug", "chore", "spike", "epic"];
export const TYPE_LANES = BLOCK_TYPES.map((t) => `tipo-${t}`);

/** The type named by a type:* label that has a block; an epic wins over the type it also carries. */
function blockType(labels: string[]): string | null {
  const types = labels.filter((l) => l.startsWith("type:")).map((l) => l.slice(5));
  return types.includes("epic") ? "epic" : (types.find((t) => BLOCK_TYPES.includes(t)) ?? null);
}

export function laneForLabels(labels: string[]): string | null {
  const type = blockType(labels);
  return type ? `tipo-${type}` : null;
}

/** The type RoadS stores on an item (feature, bug, chore or spike), or null: an epic has none of its own. */
export function tipoForLabels(labels: string[]): string | null {
  const type = labels.filter((l) => l.startsWith("type:")).map((l) => l.slice(5)).find((t) => t !== "epic" && BLOCK_TYPES.includes(t));
  return type ?? null;
}
