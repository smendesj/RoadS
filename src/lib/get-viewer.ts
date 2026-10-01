import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadViewer } from "@/lib/viewer";

// Who is asking, looked up once per request however many parts of the page want to know.
export const getViewer = cache(async () => {
  const supabase = await createClient();
  return loadViewer({
    getUserId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    getProfile: async (userId) => (await supabase.from("profiles").select("role, avatar").eq("id", userId).single()).data,
  });
});
