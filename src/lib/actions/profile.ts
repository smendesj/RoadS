"use server";

import { isAvatarId } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/server";

export async function updateMyAvatar(avatar: string): Promise<void> {
  if (!isAvatarId(avatar)) throw new Error("invalid_avatar");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not_authenticated");
  const { error } = await supabase.from("profiles").update({ avatar }).eq("id", user.id);
  if (error) throw error;
}
