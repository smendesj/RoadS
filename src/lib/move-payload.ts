// The payload of a "move_lane" row of the sync queue, built in one place. Frontlights relies on BOTH lanes
// (docs/frontlights-contract.md): `lane_id` is where the item went and `from_lane_id` where it came from, so it
// can write the departure into the sprint file it left. They are there whoever made the move: a person in the
// app, the rotation of the sprints, the filing by type label, the GitHub Project. `title` and `reason` are
// informative, and so is `origin`: who made the move. It is optional, so older rows don't carry it.

export type MoveOrigin = "app" | "rotation" | "label" | "project";
export type MovePayload = { lane_id: string; from_lane_id: string; title?: string; reason?: string; origin?: MoveOrigin };

export function moveLanePayload(move: { from: string; to: string; title?: string; reason?: string; origin?: MoveOrigin }): MovePayload {
  return {
    lane_id: move.to,
    from_lane_id: move.from,
    ...(move.title !== undefined ? { title: move.title } : {}),
    ...(move.reason !== undefined ? { reason: move.reason } : {}),
    ...(move.origin !== undefined ? { origin: move.origin } : {}),
  };
}
