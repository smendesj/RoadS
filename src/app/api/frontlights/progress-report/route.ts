import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { receiveDraft, reportState } from "@/lib/progress/ingest";
import { supabaseReportStore } from "@/lib/progress/ingest-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// "Resumo para a diretoria", the door the Frontlights CLI uses. A service-to-service call like the others
// under /api/frontlights: the shared secret, then the admin client (RLS lets only the service role create
// or refresh a report). All the rules live in src/lib/progress/ingest.ts and draft.ts, tested without a
// server; this file is the HTTP plumbing.

// GET -> { window, draft, lastSent }. `window` is what to collect next (since the end of the last SENT
// report; on a send day up to now). `draft` and `lastSent` carry only id, period, pushed_at, rev and
// checked_at; `lastSent` also lists `entries` [{ id, status }]: what that e-mail already told, edits
// applied, so the next one does not repeat it. Either is null when there is none.
export async function GET(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await reportState(supabaseReportStore(createAdminClient()), "GeoCloud"));
  } catch (error) {
    return serverError("progress-report GET", error);
  }
}

// POST { produto?, content } -> 200 { id, created, url } | 400 { error } (the draft is invalid; the error
// names the field, never its value) | 409 { error } (that period was already sent, or two pushes collided).
// Pushing again refreshes `content` and keeps the user's edits (`overrides`) and the image link.
export async function POST(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  try {
    const result = await receiveDraft(supabaseReportStore(createAdminClient()), body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return serverError("progress-report POST", error);
  }
}
