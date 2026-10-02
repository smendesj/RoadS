import { syncFailureMessage } from "./sync-message.ts";

// What /api/frontlights/sync-board hands back after running the same sync as the Sincronizar
// button: when it ran and what the Roadmap took in, never the board's cards (titles and links).
type RoadmapChange = { added: number; removed: number; issuesCreated: number; error?: string };
type Result =
  | { ok: true; syncedAt: string; columns: unknown[]; roadmap: RoadmapChange }
  | { ok: false; reason: string; message?: string };

export type SyncSummary =
  | { ok: true; ran: boolean; syncedAt: string; roadmap: RoadmapChange }
  | { ok: false; reason: string; message: string };

export function syncSummary(result: Result, skippedByCooldown: boolean): SyncSummary {
  if (!result.ok) return { ok: false, reason: result.reason, message: syncFailureMessage(result) };
  return { ok: true, ran: !skippedByCooldown, syncedAt: result.syncedAt, roadmap: result.roadmap };
}
