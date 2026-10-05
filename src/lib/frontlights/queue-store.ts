// The Supabase side of the queue port (queue.ts). It takes the client as an argument, so it carries no
// "server-only" and a test can hand it a stand-in; the routes pass createAdminClient() (a service-to-service
// call with no user session: RLS on roadmap_sync_queue only lets scrum_master and admin through the anon key).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueRow, QueueStore } from "./queue.ts";

const TABLE = "roadmap_sync_queue";
const WITH_ITEM = "id, item_id, action, payload, created_at, roadmap_items(title, description, produto, prioridade, effort, github_issue_url, lane_id, lanes(title))";

export function supabaseQueueStore(client: SupabaseClient): QueueStore {
  return {
    async listPending(since) {
      let query = client.from(TABLE).select(WITH_ITEM).is("acked_at", null).order("created_at", { ascending: true });
      if (since) query = query.gt("created_at", since);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as QueueRow[];
    },

    async ackThrough(asOf, ackedAt) {
      const { data, error } = await client.from(TABLE).update({ acked_at: ackedAt }).is("acked_at", null).lte("created_at", asOf).select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}
