import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { attachShots } from "@/lib/progress/attach";
import { supabaseAttachStore } from "@/lib/progress/attach-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Adds prints of deliveries to a report that was already SENT (the attach script, scripts/progress/attach.ts,
// after uploading each print through /progress-report/shots). The shared secret, then the admin client. Every
// rule lives in src/lib/progress/attach.ts; this file is the HTTP plumbing.
//
// POST { shots: [{ caption, mime, issue, path }] } -> 200 { added, existing } | 400 { error } | 401
//   | 404 { error: "not_found" } | 409 { error: "not_sent" | "concurrent_change" }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = await attachShots(supabaseAttachStore(createAdminClient()), id, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return serverError("progress-report attach POST", error);
  }
}
