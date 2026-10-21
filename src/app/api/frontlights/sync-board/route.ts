import { syncBoard } from "@/lib/board-sync";
import { frontlightsJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { supabaseSnapshotReader, syncBoardAnswer } from "@/lib/frontlights/sync";
import { createAdminClient } from "@/lib/supabase/admin";

// A sync may run this long (SYNC_MAX_DURATION_S in src/lib/sync-cooldown.ts; Next reads only a literal here).
export const maxDuration = 300;

// POST /api/frontlights/sync-board -> runs the same sync as the Sincronizar button (Project #7 statuses, the
// Dashboard snapshot, the Roadmap's open and closed issues), so FrontlightS can start from what the Roadmap
// would show after a click. Same 30 s cooldown as the button: a second call right after one answers from the
// last snapshot and says ran: false. The answer is a summary, never the board's cards. The cooldown and the
// summary live in src/lib/frontlights/sync.ts.
export const POST = door("/sync-board", async () => {
  const summary = await syncBoardAnswer({
    latestSnapshot: supabaseSnapshotReader(createAdminClient()),
    run: syncBoard,
    now: Date.now,
  });
  return frontlightsJson({ ...summary });
});
