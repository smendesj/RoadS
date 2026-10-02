import { syncBoard, type SyncColumn } from "@/lib/board-sync";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { SYNC_COOLDOWN_MS } from "@/lib/sync-cooldown";
import { syncSummary } from "@/lib/sync-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWithin } from "@/lib/timestamp";
import { NextResponse } from "next/server";

// POST /api/frontlights/sync-board -> runs the same sync as the Sincronizar button (Project #7
// statuses, the Dashboard snapshot, the Roadmap's open and closed issues), so FrontlightS can start
// from what the Roadmap would show after a click. Same 30 s cooldown as the button: a second call
// right after one answers from the last snapshot and says ran: false. The answer is a summary, never
// the board's cards.
export async function POST(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: latest } = await admin.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
  if (latest && isWithin(latest.synced_at as string, Date.now(), SYNC_COOLDOWN_MS)) {
    return NextResponse.json(
      syncSummary(
        {
          ok: true,
          syncedAt: latest.synced_at as string,
          columns: latest.columns as SyncColumn[],
          roadmap: { added: 0, removed: 0, issuesCreated: 0 },
        },
        true
      )
    );
  }

  return NextResponse.json(syncSummary(await syncBoard(), false));
}
