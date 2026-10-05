// The Supabase side of the Roadmap-state port (state.ts). Four reads at once; if any of them fails the whole
// read fails, so Frontlights never writes its files from a half-empty Roadmap.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StateRows, StateStore } from "./state.ts";

export function supabaseStateStore(client: SupabaseClient): StateStore {
  return {
    async read() {
      const [lanes, items, snapshot, pending] = await Promise.all([
        client.from("lanes").select("id, title, kind, start_date, end_date, sort_order"),
        client
          .from("roadmap_items")
          .select("id, lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, github_issue_number, updated_at"),
        client.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle(),
        client.from("roadmap_sync_queue").select("id, item_id, action, payload").is("acked_at", null),
      ]);
      const failed = lanes.error ?? items.error ?? snapshot.error ?? pending.error;
      if (failed) throw failed;
      return {
        lanes: lanes.data ?? [],
        items: items.data ?? [],
        columns: (snapshot.data?.columns as StateRows["columns"] | undefined) ?? null,
        snapshotSyncedAt: (snapshot.data?.synced_at as string | undefined) ?? null,
        pending: pending.data ?? [],
      };
    },
  };
}
