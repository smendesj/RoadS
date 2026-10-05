// The Roadmap as it stands now, for GET /api/frontlights/roadmap-state: the rows behind a small port
// (StateStore, plugged into Supabase by state-store.ts) and the pure builder in ../roadmap-state.ts. Read-only:
// it consumes nothing and never acks.
import { buildRoadmapState } from "../roadmap-state.ts";
import type { ItemRow, LaneRow, PendingRow, RoadmapState } from "../roadmap-state.ts";

export type StateRows = {
  lanes: LaneRow[];
  items: ItemRow[];
  columns: { key: string; items: { url: string }[] }[] | null;
  snapshotSyncedAt: string | null;
  pending: PendingRow[];
};

export type StateStore = { read(): Promise<StateRows> };

export async function readRoadmapState(store: StateStore, now: Date): Promise<RoadmapState> {
  return buildRoadmapState({ ...(await store.read()), now });
}
