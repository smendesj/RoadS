import { syncBoard } from "@/lib/actions/sync";
import { NextResponse } from "next/server";

// Hit by Vercel Cron (see vercel.json) once a day at 08:00 America/Sao_Paulo.
// Vercel signs cron requests with this header when CRON_SECRET is set — reject
// anything else so this can't be used to burn GitHub API calls by a random caller.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await syncBoard();
  return NextResponse.json(result);
}
