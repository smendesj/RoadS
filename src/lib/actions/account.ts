"use server";

import { finishPasswordReset, resetErrorMessage } from "@/lib/account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The last step of choosing a new password: the one place that may clear an account's "must reset"
// flag. Expected failures come back as a message (a thrown error reaches the browser masked).
export async function completePasswordReset(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  try {
    await finishPasswordReset(password, {
      getUserId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
      setPassword: async (value) => {
        const { error } = await supabase.auth.updateUser({ password: value });
        if (error) throw error;
      },
      clearMustReset: async (userId) => {
        const { error } = await createAdminClient().from("profiles").update({ must_reset_password: false }).eq("id", userId);
        if (error) throw error;
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("completePasswordReset failed", e);
    return { ok: false, error: resetErrorMessage(e) };
  }
}
