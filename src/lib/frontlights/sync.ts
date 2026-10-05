// POST /api/frontlights/sync-board: the same sync as the Sincronizar button, with the same 30 s cooldown (the
// token's GitHub quota is shared with the daily cron and with whoever presses the button). A second call
// right after one answers from the last snapshot and says ran: false. The answer is a summary of what the
// Roadmap took in, never the board's cards. The sync itself and the clock come in through SyncDeps, so the
// cooldown runs under test without GitHub or a database.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYNC_COOLDOWN_MS } from "../sync-cooldown.ts";
import { syncSummary } from "../sync-summary.ts";
import type { SyncSummary } from "../sync-summary.ts";
import { isWithin } from "../timestamp.ts";

type Outcome = Parameters<typeof syncSummary>[0];

export type SyncDeps = {
  /** The last snapshot of the board, or null when there is none or it can't be read. */
  latestSnapshot(): Promise<{ syncedAt: string; columns: unknown[] } | null>;
  /** Runs the real sync (GitHub, the Roadmap, the snapshot). */
  run(): Promise<Outcome>;
  now(): number;
};

export async function syncBoardAnswer(deps: SyncDeps): Promise<SyncSummary> {
  const latest = await deps.latestSnapshot();
  if (latest && isWithin(latest.syncedAt, deps.now(), SYNC_COOLDOWN_MS)) {
    return syncSummary({ ok: true, syncedAt: latest.syncedAt, columns: latest.columns, roadmap: { added: 0, removed: 0, issuesCreated: 0 } }, true);
  }
  return syncSummary(await deps.run(), false);
}

/** Reads the single row of board_sync_state. A missing row, or one that can't be read, never blocks a sync. */
export function supabaseSnapshotReader(client: SupabaseClient): SyncDeps["latestSnapshot"] {
  return async () => {
    const { data } = await client.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
    return data ? { syncedAt: data.synced_at as string, columns: data.columns as unknown[] } : null;
  };
}
