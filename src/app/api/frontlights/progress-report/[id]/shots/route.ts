import { answerJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { attachShots } from "@/lib/progress/attach";
import { supabaseAttachStore } from "@/lib/progress/attach-store";
import { createAdminClient } from "@/lib/supabase/admin";

// Adds prints (of its deliveries, or general ones with no `issue`) to a report that was already SENT (the attach
// script, scripts/progress/attach.ts, after uploading each print through /progress-report/shots). The shared
// secret, then the admin client. Every rule lives in src/lib/progress/attach.ts; this file is the HTTP plumbing.
//
// POST { shots: [{ caption, mime, issue?, path }] } -> 200 { schemaVersion, added, existing } | 400 { error } | 401
//   | 404 { error: "not_found" } | 409 { error: "not_sent" | "concurrent_change" }
export const POST = door<{ params: Promise<{ id: string }> }>("/progress-report/[id]/shots", async (request, { params }) => {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  return answerJson(await attachShots(supabaseAttachStore(createAdminClient()), id, body));
});
