import { answerJson, frontlightsJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { receiveDraft, reportState } from "@/lib/progress/ingest";
import { supabaseReportStore } from "@/lib/progress/ingest-store";
import { createAdminClient } from "@/lib/supabase/admin";

// "Resumo para a diretoria", the door the Frontlights CLI uses. A service-to-service call like the others
// under /api/frontlights: the shared secret, then the admin client (RLS lets only the service role create
// or refresh a report). All the rules live in src/lib/progress/ingest.ts and draft.ts, tested without a
// server; this file is the HTTP plumbing.

// GET -> { schemaVersion, window, draft, lastSent }. `window` is what to collect next (since the end of the
// last SENT report; on a send day up to now). `draft` and `lastSent` carry only id, period, pushed_at, rev and
// checked_at; `lastSent` also lists `entries` [{ id, status }]: what that e-mail already told, edits
// applied, so the next one does not repeat it. Either is null when there is none.
export const GET = door("/progress-report", async () => {
  return frontlightsJson({ ...(await reportState(supabaseReportStore(createAdminClient()), "GeoCloud")) });
});

// POST { schemaVersion?, produto?, content } -> 200 { id, created, url } | 400 { error } (the draft is
// invalid, or names a version of the contract this server does not speak; the error names the field, never
// its value, except the issue numbers of deliveries that lack a print) | 409 { error } (that period was
// already sent, or two pushes collided) | 409 { error: "other_draft_pending", draft: { period_start,
// period_end } } (a draft of another period is waiting; it is never written over).
// Pushing again (same period start) refreshes `content` and keeps the user's edits (`overrides`) and the image link.
export const POST = door("/progress-report", async (request) => {
  const body = await request.json().catch(() => null);
  return answerJson(await receiveDraft(supabaseReportStore(createAdminClient()), body));
});
