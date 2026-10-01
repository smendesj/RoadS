"use server";

import { saveAvatar } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export async function updateMyAvatar(avatar: string): Promise<void> {
  const supabase = await createClient();
  await saveAvatar(avatar, {
    getUserId: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    setAvatar: async (userId, value) => {
      const { error } = await supabase.from("profiles").update({ avatar: value }).eq("id", userId);
      if (error) throw error;
    },
  });
}
