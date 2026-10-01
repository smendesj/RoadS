"use server";

// The entry points the Dashboard and Roadmap use for the GitHub board. The sync itself lives in
// src/lib/board-sync.ts, a plain server module on purpose: everything exported from THIS file is an
// endpoint any signed-in user can call directly.

import { syncBoard, type SyncColumn, type SyncResult } from "@/lib/board-sync";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { isWithin } from "@/lib/timestamp";

// A second sync inside this window gets the last result back instead of spending GitHub API calls: the
// token's quota is shared with the daily cron and with whoever owns it, and any role can press the button.
const SYNC_COOLDOWN_MS = 30_000;

// Client entry point for the manual "Board sincronizado" button — dev, scrum_master
// and admin can all trigger it (it's a read-refresh, not an edit, so there's no
// reason to restrict it the way Roadmap editing is restricted); anyone without a
// real session gets turned away before we spend a GitHub API call on them.
export async function syncBoardAsViewer(): Promise<SyncResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile?.role) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };

  const latest = await getLatestBoardSnapshot();
  if (latest && isWithin(latest.syncedAt, Date.now(), SYNC_COOLDOWN_MS)) {
    return { ok: true, columns: latest.columns, syncedAt: latest.syncedAt, roadmap: { added: 0, removed: 0, issuesCreated: 0 } };
  }

  return syncBoard();
}

export async function getLatestBoardSnapshot(): Promise<{ columns: SyncColumn[]; syncedAt: string } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
  if (!data) return null;
  return { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string };
}
