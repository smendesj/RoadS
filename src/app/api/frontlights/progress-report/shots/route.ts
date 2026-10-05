import { serverError } from "@/lib/api-response";
import { checkFrontlightsAuth } from "@/lib/frontlights-auth";
import { PROGRESS_SHOTS_BUCKET } from "@/lib/progress/shot-store";
import { receiveShot, type ShotBucket } from "@/lib/progress/shot-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// One print of the "Resumo para a diretoria", sent by the push script before the draft that names it. Same
// door as the draft (the shared secret, then the admin client: the prints bucket has no policy for anyone
// else). Every rule lives in src/lib/progress/shot-upload.ts; this file is the HTTP plumbing.
//
// POST { data: "<base64>" } -> 200 { path, mime } | 400 { error } | 401
export async function POST(request: Request) {
  if (!checkFrontlightsAuth(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  try {
    const storage = createAdminClient().storage.from(PROGRESS_SHOTS_BUCKET);
    const bucket: ShotBucket = {
      upload: async (path, bytes, contentType) => {
        const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
        return { error: error ? { statusCode: (error as { statusCode?: string }).statusCode, message: error.message } : null };
      },
    };
    const result = await receiveShot(bucket, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return serverError("progress-report shots POST", error);
  }
}
