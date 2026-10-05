import { answerJson } from "@/lib/frontlights/contract";
import { door } from "@/lib/frontlights/doors";
import { PROGRESS_SHOTS_BUCKET } from "@/lib/progress/shot-store";
import { receiveShot, type ShotBucket } from "@/lib/progress/shot-upload";
import { createAdminClient } from "@/lib/supabase/admin";

// One print of the "Resumo para a diretoria", sent by the push script before the draft that names it. Same
// door as the draft (the shared secret, then the admin client: the prints bucket has no policy for anyone
// else). Every rule lives in src/lib/progress/shot-upload.ts; this file is the HTTP plumbing.
//
// POST { data: "<base64>" } -> 200 { schemaVersion, path, mime } | 400 { error } | 401
export const POST = door("/progress-report/shots", async (request) => {
  const body = await request.json().catch(() => null);
  const storage = createAdminClient().storage.from(PROGRESS_SHOTS_BUCKET);
  const bucket: ShotBucket = {
    upload: async (path, bytes, contentType) => {
      const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
      return { error: error ? { statusCode: (error as { statusCode?: string }).statusCode, message: error.message } : null };
    },
  };
  return answerJson(await receiveShot(bucket, body));
});
