import { answerJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { pendingChanges } from "@/lib/frontlights/queue";
import { supabaseQueueStore } from "@/lib/frontlights/queue-store";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/frontlights/pending-changes?since=<ISO timestamp, optional> -> { schemaVersion, asOf, changes }.
// The rules (what a change carries, why asOf is the newest row's creation time, what is skipped) live in
// src/lib/frontlights/queue.ts. Admin client: a service-to-service call, not a user session.
export const GET = door("/pending-changes", async (request) => {
  const since = new URL(request.url).searchParams.get("since");
  return answerJson(await pendingChanges(supabaseQueueStore(createAdminClient()), since));
});
