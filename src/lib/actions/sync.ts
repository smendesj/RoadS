"use server";

// The entry points the Dashboard and Roadmap use for the GitHub board. The sync itself lives in
// src/lib/board-sync.ts, a plain server module on purpose: everything exported from THIS file is an
// endpoint any signed-in user can call directly.

import { syncBoard, type SyncColumn, type SyncResult } from "@/lib/board-sync";
import { cooldownFor } from "@/lib/auto-sync";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { SliceGroup } from "@/lib/slices";

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

  return syncBoard({ brakeMs: cooldownFor({ auto }) });
}

export async function getLatestBoardSnapshot(): Promise<{ columns: SyncColumn[]; syncedAt: string; slices: SliceGroup[] } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("board_sync_state").select("columns, synced_at, slices").eq("id", true).maybeSingle();
  if (!data) return null;
  return { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string, slices: (data.slices as SliceGroup[] | null) ?? [] };
}
