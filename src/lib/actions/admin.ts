"use server";

import { createClient as createSupabaseJs } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { resetFailureMessage, resetPassword, temporaryPassword } from "@/lib/password-reset";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { AppUser, Role } from "@/lib/types";

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not_authenticated");
  const { data: profile } = await supabase.from("profiles").select("role, must_reset_password").eq("id", user.id).single();
  if (profile?.must_reset_password) throw new Error("must_reset_password");
  if (profile?.role !== "admin") throw new Error("not_admin");
  return user;
}

export async function listUsersForConfig(): Promise<AppUser[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: authList, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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

// The e-mail address is read from the account (never taken from the screen), and expected failures come
// back as a message: a thrown error reaches the browser masked, and the Config screen must not claim an
// e-mail was sent when it wasn't.
export async function resetUserPassword(userId: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  try {
    const email = await resetPassword(userId, {
      getEmail: async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        return error ? null : (data.user?.email ?? null);
      },
      sendRecoveryEmail: async (address) => {
        // Implicit flow, so the link carries its own tokens and opens a session in whichever browser the
        // person uses. The default (PKCE) ties the link to the browser that asked: the admin's.
        const mailer = createSupabaseJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
          auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { error } = await mailer.auth.resetPasswordForEmail(address, { redirectTo: `${origin}/redefinir-senha` });
        if (error) throw error;
      },
      setTemporaryPassword: async (id) => {
        const { error } = await admin.auth.admin.updateUserById(id, { password: temporaryPassword() });
        if (error) throw error;
      },
      flagMustReset: async (id) => {
        const { error } = await admin.from("profiles").update({ must_reset_password: true }).eq("id", id);
        if (error) throw error;
      },
    });
    return { ok: true, email };
  } catch (e) {
    console.error("resetUserPassword failed", e);
    return { ok: false, error: resetFailureMessage(e) };
  }
}
