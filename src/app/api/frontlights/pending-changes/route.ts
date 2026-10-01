import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIsoTimestamp } from "@/lib/timestamp";
import { NextResponse } from "next/server";

// GET /api/frontlights/pending-changes?since=<ISO timestamp, optional>
// -> { asOf: string | null, changes: [...] }. A "remove" arrives with item and itemId null
// (the row is gone and the queue's FK is "on delete set null"); its payload carries
// item_id, lane_id and title. Every id is a uuid string.
// Returns every un-acked roadmap_sync_queue row (optionally only those created
// after `since`), each with enough of the current roadmap_items/lanes state that
// the caller can write ROADMAP.md/SPRINT.md without a second round trip. Uses the
// admin client since this is a service-to-service call, not a user session — RLS
// on roadmap_sync_queue only allows scrum_master/admin through the anon key.
export async function GET(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new URL(request.url).searchParams.get("since");
  if (since && !isIsoTimestamp(since)) {
    return NextResponse.json({ error: "since must be an ISO timestamp string" }, { status: 400 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("roadmap_sync_queue")
    .select(
      "id, item_id, action, payload, created_at, roadmap_items(title, description, produto, prioridade, effort, github_issue_url, lane_id, lanes(title))"
    )
    .is("acked_at", null)
    .order("created_at", { ascending: true });

  if (since) query = query.gt("created_at", since);

  const { data, error } = await query;
  if (error) return serverError("pending-changes", error);

  const rows = data ?? [];
  const changes = rows.flatMap((row) => {
    const item = Array.isArray(row.roadmap_items) ? row.roadmap_items[0] : row.roadmap_items;
    // An add/modify/move_lane whose item was deleted since has nothing left to write (the FK
    // set item_id to null); only a "remove" still carries meaning. Skip the rest.
    if (!item && row.action !== "remove") return [];
    const lane = item ? (Array.isArray(item.lanes) ? item.lanes[0] : item.lanes) : null;
    return [{
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
    }];
  });

  // asOf is the createdAt of the newest pending row — never "now" — so an ack with it can't
  // swallow a change queued between this fetch and the ack, and it also consumes the skipped
  // orphans. null when nothing is pending.
  const asOf = rows.length ? rows[rows.length - 1].created_at : null;

  return NextResponse.json({ asOf, changes });
}
