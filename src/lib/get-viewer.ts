import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadViewer } from "@/lib/viewer";

// Who is asking, looked up once per request however many parts of the page want to know.
export const getViewer = cache(async () => {
  const supabase = await createClient();
  return loadViewer({
    getUserId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    getProfile: async (userId) =>
      (await supabase.from("profiles").select("role, avatar, must_reset_password").eq("id", userId).single()).data,
  });
});

// For the signed-in pages: someone who has to choose a new password is sent there first, whatever
// address they typed. (The login page does the same, but a login redirect alone is easy to walk around.)
export async function getViewerOrReset() {
  const viewer = await getViewer();
  if (viewer?.mustResetPassword) redirect("/redefinir-senha");
  return viewer;
}
