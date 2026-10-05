import { syncBoard } from "@/lib/board-sync";
import { pruneCalls } from "@/lib/frontlights/calls";
import { supabaseCallStore } from "@/lib/frontlights/calls-store";
import { bearerMatches } from "@/lib/secret";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Hit by Vercel Cron (see vercel.json) once a day at 08:00 America/Sao_Paulo.
// Vercel signs cron requests with this header when CRON_SECRET is set — reject
// anything else so this can't be used to burn GitHub API calls by a random caller.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await syncBoard();

  // The daily run also drops the log of Frontlights calls that is older than its retention. A failure here is
  // logged and never changes what the sync answers.
  try {
    await pruneCalls(supabaseCallStore(createAdminClient()), new Date());
  } catch (error) {
    console.error("frontlights call log prune failed", error);
  }

  return NextResponse.json(result);
}
