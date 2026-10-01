import { syncBoard } from "@/lib/board-sync";
import { bearerMatches } from "@/lib/secret";
import { NextResponse } from "next/server";

// Hit by Vercel Cron (see vercel.json) once a day at 08:00 America/Sao_Paulo.
// Vercel signs cron requests with this header when CRON_SECRET is set — reject
// anything else so this can't be used to burn GitHub API calls by a random caller.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await syncBoard();
  return NextResponse.json(result);
}
