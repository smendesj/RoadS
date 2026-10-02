import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { buildRoadmapState } from "@/lib/roadmap-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/frontlights/roadmap-state -> the Roadmap as it stands now (see src/lib/roadmap-state.ts for
// the shape). Read-only: it consumes nothing and never acks. FrontlightS uses it for the content and
// context of ROADMAP.md and the SPRINT files (sprint dates, order, status, the over-the-limit flag),
// while /pending-changes stays the list of what changed and the only thing /ack closes.
// Admin client, like the other routes: a service-to-service call with no user session.
export async function GET(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [lanes, items, snapshot, pending] = await Promise.all([
    admin.from("lanes").select("id, title, kind, start_date, end_date, sort_order"),
    admin
      .from("roadmap_items")
      .select("id, lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, github_issue_number, updated_at"),
    admin.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle(),
    admin.from("roadmap_sync_queue").select("id, item_id, action, payload").is("acked_at", null),
  ]);
  const failed = lanes.error ?? items.error ?? snapshot.error ?? pending.error;
  if (failed) return serverError("roadmap-state", failed);

  const state = buildRoadmapState({
    lanes: lanes.data ?? [],
    items: items.data ?? [],
    columns: (snapshot.data?.columns as { key: string; items: { url: string }[] }[] | undefined) ?? null,
    snapshotSyncedAt: (snapshot.data?.synced_at as string | undefined) ?? null,
    pending: pending.data ?? [],
    now: new Date(),
  });

  return NextResponse.json(state);
}
