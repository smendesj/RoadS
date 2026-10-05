// The payload of a "move_lane" row of the sync queue, built in one place. Frontlights relies on BOTH lanes
// (docs/frontlights-contract.md): `lane_id` is where the item went and `from_lane_id` where it came from, so it
// can write the departure into the sprint file it left. They are there whoever made the move: a person in the
// app, the rotation of the sprints, the filing by type label. `title` and `reason` are informative.

export type MovePayload = { lane_id: string; from_lane_id: string; title?: string; reason?: string };

export function moveLanePayload(move: { from: string; to: string; title?: string; reason?: string }): MovePayload {
  return {
    lane_id: move.to,
    from_lane_id: move.from,
    ...(move.title !== undefined ? { title: move.title } : {}),
    ...(move.reason !== undefined ? { reason: move.reason } : {}),
  };
}
