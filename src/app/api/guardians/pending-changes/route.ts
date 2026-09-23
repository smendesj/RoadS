import { checkGuardiansAuth } from "@/lib/guardians-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/guardians/pending-changes?since=<ISO timestamp, optional>
// Returns every un-acked guardians_sync_queue row (optionally only those created
// after `since`), each with enough of the current roadmap_items/lanes state that
// the caller can write ROADMAP.md/SPRINT.md without a second round trip. Uses the
// admin client since this is a service-to-service call, not a user session — RLS
// on guardians_sync_queue only allows scrum_master/admin through the anon key.
export async function GET(request: Request) {
  if (!checkGuardiansAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new URL(request.url).searchParams.get("since");

  const admin = createAdminClient();
  let query = admin
    .from("guardians_sync_queue")
    .select(
      "id, item_id, action, payload, created_at, roadmap_items(title, description, produto, prioridade, effort, github_issue_url, lane_id, lanes(title))"
    )
    .is("acked_at", null)
    .order("created_at", { ascending: true });

  if (since) query = query.gt("created_at", since);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes = (data ?? []).map((row) => {
    const item = Array.isArray(row.roadmap_items) ? row.roadmap_items[0] : row.roadmap_items;
    const lane = item ? (Array.isArray(item.lanes) ? item.lanes[0] : item.lanes) : null;
    return {
      id: row.id,
      itemId: row.item_id,
      action: row.action,
      payload: row.payload,
      createdAt: row.created_at,
      item: item
        ? {
            title: item.title,
            description: item.description,
            produto: item.produto,
            prioridade: item.prioridade,
            effort: item.effort,
            githubIssueUrl: item.github_issue_url,
            lane: lane?.title ?? null,
            laneId: item.lane_id,
          }
        : null,
    };
  });

  return NextResponse.json({ changes });
}
