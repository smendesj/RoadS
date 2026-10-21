// The name a Comment written in RoadS is shown and signed with on GitHub (issue #23): the profile's name, else its
// role. Never the e-mail, which would land on the issue.

const ROLE_NAME: Record<string, string> = { admin: "Admin", scrum_master: "Scrum Master", dev: "Dev" };

export function commentAuthorName(user: { user_metadata?: Record<string, unknown> } | null | undefined, role: string): string {
  const name = user?.user_metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : ROLE_NAME[role] ?? "RoadS";
}

/** Who may edit or delete a Comment: whoever wrote it in RoadS, and the admin (a comment from GitHub: the admin only). */
export function mayChangeComment(note: { authorId?: string | null }, viewer: { id: string; role: string } | null): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || (Boolean(note.authorId) && note.authorId === viewer.id);
}
