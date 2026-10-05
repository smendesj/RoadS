import { answerJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { ackUpTo } from "@/lib/frontlights/queue";
import { supabaseQueueStore } from "@/lib/frontlights/queue-store";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/frontlights/ack { "asOf": "<ISO timestamp>", "schemaVersion"?: 1 } -> { schemaVersion, acked }.
// Marks every roadmap_sync_queue row created at or before asOf as acked, so the next /pending-changes call
// (with ?since=asOf) doesn't return them again. The rules live in src/lib/frontlights/queue.ts.
export const POST = door("/ack", async (request) => {
  const body = await request.json().catch(() => null);
  return answerJson(await ackUpTo(supabaseQueueStore(createAdminClient()), body, new Date()));
});
