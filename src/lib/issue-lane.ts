// The Roadmap block an open issue is filed in comes from its type:* label. An issue without a known
// one has no block and stays out of the Roadmap until it gets a type.
const BLOCK_TYPES = ["feature", "bug", "chore", "spike", "epic"];
export const TYPE_LANES = BLOCK_TYPES.map((t) => `tipo-${t}`);

/** Where "+ Novo item" puts a new item: no week, the lane of a feature (the type its edit starts with). Once it has an
 *  issue, the sync files it in the lane of the issue's type label. */
export const NEW_ITEM_LANE = "tipo-feature";

/** The target a card dropped on the Kanban's Open is moved to: no lane, but "no week". The server unplans the item into
 *  the type lane unplanLane names; the caller never picks it. */
export const KANBAN = "kanban";

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

/** The type lane an item with no week goes back to: the one its issue's type label names, else the one of the type it
 *  is stored with, among `lanes` (the type lanes the database has). Null when neither names one. The sync releases an
 *  item the Project took out of Development this way, and a drop on the Kanban unplans one (unplanLane). */
export function releaseLane(labels: string[], tipo: string | null, lanes: ReadonlySet<string>): string | null {
  return [laneForLabels(labels), tipo ? `tipo-${tipo}` : null].find((lane): lane is string => !!lane && lanes.has(lane)) ?? null;
}

/** Unplanning: a card dropped from a week on the Kanban always lands in a type lane, the one releaseLane names, else
 *  where "+ Novo item" puts an item. The server decides it, never the caller. */
export function unplanLane(labels: string[], tipo: string | null, lanes: ReadonlySet<string>): string {
  return releaseLane(labels, tipo, lanes) ?? NEW_ITEM_LANE;
}
