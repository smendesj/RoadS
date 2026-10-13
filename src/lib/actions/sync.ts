"use server";

// The entry points the Dashboard and Roadmap use for the GitHub board. The sync itself lives in
// src/lib/board-sync.ts, a plain server module on purpose: everything exported from THIS file is an
// endpoint any signed-in user can call directly.

import { syncBoard, type SyncColumn, type SyncResult } from "@/lib/board-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { SliceGroup } from "@/lib/slices";
import { brakedSync } from "@/lib/sync-claim";

// Client entry point for the manual "Board sincronizado" button — dev, scrum_master
// and admin can all trigger it (it's a read-refresh, not an edit, so there's no
// reason to restrict it the way Roadmap editing is restricted); anyone without a
// real session gets turned away before we spend a GitHub API call on them.
// `auto` is a sync the page starts by itself (on opening, on coming back, every 5 minutes): it gets the longer
// brake (src/lib/sync-claim.ts). Read strictly, since anyone can call this with anything.
export async function syncBoardAsViewer(opts?: { auto?: boolean }): Promise<SyncResult> {
  const auto = opts != null && typeof opts === "object" && opts.auto === true;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile?.role) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };
  return brakedSync(
    {
      now: () => Date.now(),
      // No token, no claim: a server without one (the local e2e) never holds production's brake.
      configured: () => Boolean(process.env.GITHUB_TOKEN),
      latestSnapshot: getLatestBoardSnapshot,
      // The conditional update is the claim: only one caller moves sync_claimed_at forward past the cutoff.
      claim: async (brakeMs) => {
        const admin = createAdminClient();
        const now = new Date();
        const cutoff = new Date(now.getTime() - brakeMs).toISOString();
        const { data, error } = await admin
          .from("board_sync_state")
          .update({ sync_claimed_at: now.toISOString() })
          .eq("id", true)
          .or(`sync_claimed_at.is.null,sync_claimed_at.lt."${cutoff}"`)
          .select("sync_claimed_at");
        if (error) throw error;
        if (data?.length) return { claimed: true, claimedAt: data[0].sync_claimed_at as string };
        const { data: row } = await admin.from("board_sync_state").select("sync_claimed_at").eq("id", true).maybeSingle();
        return { claimed: false, claimedAt: (row?.sync_claimed_at as string | null) ?? null };
      },
      run: syncBoard,
    },
    { auto }
  );
}

export async function getLatestBoardSnapshot(): Promise<{ columns: SyncColumn[]; syncedAt: string; slices: SliceGroup[] } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("board_sync_state").select("columns, synced_at, slices").eq("id", true).maybeSingle();
  if (!data) return null;
  return { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string, slices: (data.slices as SliceGroup[] | null) ?? [] };
}
