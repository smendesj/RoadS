"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

// Who can be an Assignee (issue #23): the profiles the admin tied to a GitHub login in Config, each with the name it
// is shown by. Any signed-in user may ask (the Roadmap shows names instead of logins to everyone); a profile only
// reads its own row (RLS), so the list is read as the service role, and it carries no e-mail.
export async function listAssignableProfiles(): Promise<{ login: string; name: string }[]> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");

  const admin = createAdminClient();
  const { data: profiles, error } = await admin.from("profiles").select("id, github_login").not("github_login", "is", null);
  if (error) throw error;
  if (!profiles?.length) return [];
  const { data: authList, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) throw authError;
  const names = new Map(authList.users.map((u) => [u.id, (u.user_metadata?.name as string | undefined)?.trim() || null]));
  return profiles
    .map((p) => ({ login: p.github_login as string, name: names.get(p.id as string) ?? (p.github_login as string) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
