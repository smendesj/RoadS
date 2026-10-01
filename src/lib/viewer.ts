import { isAvatarId } from "./avatars.ts";
import type { Role } from "./types.ts";

/** Who is looking at the page, as the server knows it — available from the very first render. */
export type Viewer = { id: string; role: Role; avatar: string | null };

export type ViewerSource = {
  getUserId: () => Promise<string | null>;
  getProfile: (userId: string) => Promise<{ role?: string | null; avatar?: string | null } | null>;
};

const ROLES: Role[] = ["admin", "scrum_master", "dev"];

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", scrum_master: "Scrum Master", dev: "Dev" };

/** "Visitante" is only for nobody signed in. */
export function roleLabel(role: Role | null): string {
  return role === null ? "Visitante" : ROLE_LABEL[role];
}

// A signed-in user is never a visitor: no role, an unknown role or no profile row all mean the
// least-privileged one, Dev. The picture is only passed on when it is one of the shipped avatars.
export async function loadViewer({ getUserId, getProfile }: ViewerSource): Promise<Viewer | null> {
  const id = await getUserId();
  if (!id) return null;
  const profile = await getProfile(id);
  const role = ROLES.find((r) => r === profile?.role) ?? "dev";
  const avatar = profile?.avatar;
  return { id, role, avatar: isAvatarId(avatar) ? avatar : null };
}
