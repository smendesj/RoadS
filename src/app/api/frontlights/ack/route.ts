import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoTimestamp } from "@/lib/timestamp";
import { NextResponse } from "next/server";

// POST /api/frontlights/ack { "asOf": "<ISO timestamp>" }
// Marks every roadmap_sync_queue row created at or before asOf as acked, so the
// next /pending-changes call (with ?since=asOf) doesn't return them again.
export async function POST(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const asOf = body?.asOf;
  if (!isIsoTimestamp(asOf)) {
    return NextResponse.json({ error: "asOf must be an ISO timestamp string" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roadmap_sync_queue")
    .update({ acked_at: new Date().toISOString() })
    .is("acked_at", null)
    .lte("created_at", asOf)
    .select("id");

  if (error) return serverError("ack", error);

  return NextResponse.json({ acked: data?.length ?? 0 });
}
