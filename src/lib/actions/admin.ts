"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { AppUser, Role } from "@/lib/types";

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not_authenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return user;
}

export async function listUsersForConfig(): Promise<AppUser[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: authList, error } = await admin.auth.admin.listUsers();
  if (error) throw error;

  const server = await createServerSupabase();
  const { data: profiles } = await server.from("profiles").select("id, role, must_reset_password");
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return authList.users.map((u) => {
    const p = byId.get(u.id);
    return {
      id: u.id,
      name: (u.user_metadata?.name as string | undefined) || u.email || "—",
      email: u.email ?? "—",
      title: "",
      role: (p?.role as Role) ?? "dev",
      mustResetPassword: p?.must_reset_password ?? false,
    };
  });
}

export async function updateUserRole(userId: string, role: "dev" | "scrum_master") {
  await requireAdmin();
  const server = await createServerSupabase();
  const { error } = await server.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

export async function resetUserPassword(userId: string, email: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const tempPassword = "Rs-" + Math.random().toString(36).slice(2, 10) + "!9";
  const { error: pwError } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (pwError) throw pwError;

  const server = await createServerSupabase();
  await server.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/redefinir-senha`,
  });
  await server.from("profiles").update({ must_reset_password: true }).eq("id", userId);
}
