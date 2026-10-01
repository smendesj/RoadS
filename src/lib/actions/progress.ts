"use server";

// The three things an admin does to the "Resumo para a diretoria" in the browser: edit a sentence,
// tick "números conferidos", mark the report as sent. Everything exported from THIS file is an
// endpoint any signed-in user can call directly, so these are the only three, and every rule (who
// may, what is refused, what is written) lives in src/lib/progress/review.ts where it is tested; this
// file only connects the database to it, under the caller's own session so the row policies apply a
// second time.
//
// An answer is { ok: true, rev, warnings? } or { ok: false, reason }, with nothing about the
// database in it. Anyone who is not a signed-in admin with a chosen password (a scrum master, a dev,
// nobody) gets { ok: false, reason: "forbidden" | "unauthenticated" | "must_reset_password" } and
// nothing is read or written for them.

import { markSent, saveEdit, setChecked, type ReviewPorts, type ReviewResult, type ReviewRow } from "@/lib/progress/review";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export type ProgressActionResult = ReviewResult;

const COLUMNS = "id, status, rev, content, overrides, checked_at, pushed_at";

// What reaches the server log: the code and the message, never the row (it holds the whole report).
function logLine(error: unknown): { code: string | null; message: string } {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return { code: typeof e.code === "string" ? e.code : null, message: typeof e.message === "string" ? e.message : "unknown error" };
}

async function databasePorts(): Promise<ReviewPorts> {
  const supabase = await createServerSupabase();
  return {
    getActor: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { userId: null, role: null, mustResetPassword: false };
      const { data: profile } = await supabase.from("profiles").select("role, must_reset_password").eq("id", user.id).single();
      return { userId: user.id, role: profile?.role ?? null, mustResetPassword: profile?.must_reset_password === true };
    },
    loadReport: async (id) => {
      const { data, error } = await supabase.from("progress_reports").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as ReviewRow | null) ?? null;
    },
    // Conditional on `rev` and on the report still being a draft: if anything changed since it was
    // read, no row matches and the caller is told its screen is out of date. The database bumps `rev`
    // itself (and stamps who checked and when), so the new value is read back instead of guessed.
    updateReport: async (id, rev, patch) => {
      const { data, error } = await supabase
        .from("progress_reports")
        .update(patch)
        .eq("id", id)
        .eq("rev", rev)
        .eq("status", "draft")
        .select("rev");
      if (error) throw error;
      return data && data.length > 0 ? { rev: data[0].rev as number } : null;
    },
    now: () => new Date(),
    onError: (error) => console.error("progress report action failed", logLine(error)),
  };
}

export async function saveProgressEdit(input: { id: string; rev: number; key: string; value: string | boolean }): Promise<ProgressActionResult> {
  return saveEdit(input, await databasePorts());
}

export async function setProgressChecked(input: { id: string; rev: number; checked: boolean }): Promise<ProgressActionResult> {
  return setChecked(input, await databasePorts());
}

export async function markProgressReportSent(input: { id: string; rev: number }): Promise<ProgressActionResult> {
  return markSent(input, await databasePorts());
}
