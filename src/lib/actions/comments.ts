"use server";

import { mayChangeComment } from "@/lib/comment-author";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

// Editing and deleting a Comment (issue #23). Whoever wrote it and the admin may (RLS in migration 0040 says the same);
// since issue #34 the card shows no Comments and the sync only creates on GitHub the ones never sent (comment-sync.ts),
// so an edit or a delete here stays in RoadS. A Comment never sent is deleted at once; one that was is hidden and kept.

async function requireCommentActor(noteId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role, must_reset_password").eq("id", user.id).single();
  if (profile?.must_reset_password) throw new Error("must_reset_password");

  const { data: note, error } = await supabase
    .from("item_notes")
    .select("id, author_id, github_comment_id, deleted_at")
    .eq("id", noteId)
    .single();
  if (error || !note || note.deleted_at) throw new Error("not_found");
  if (!mayChangeComment({ authorId: note.author_id }, { id: user.id, role: profile?.role ?? "dev" })) throw new Error("forbidden");
  return { supabase, note };
}

export async function editItemComment(noteId: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body) throw new Error("text_required");
  const { supabase } = await requireCommentActor(noteId);
  const { error } = await supabase.from("item_notes").update({ body, updated_at: new Date().toISOString() }).eq("id", noteId);
  if (error) throw error;
}

export async function deleteItemComment(noteId: string): Promise<void> {
  const { supabase, note } = await requireCommentActor(noteId);
  const { error } = note.github_comment_id
    ? await supabase.from("item_notes").update({ deleted_at: new Date().toISOString() }).eq("id", noteId)
    : await supabase.from("item_notes").delete().eq("id", noteId);
  if (error) throw error;
}
