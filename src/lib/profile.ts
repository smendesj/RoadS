import { isAvatarId } from "./avatars.ts";

export type AvatarStore = {
  getUserId: () => Promise<string | null>;
  setAvatar: (userId: string, avatar: string) => Promise<void>;
};

// The user id always comes from the session, never from the caller, so nobody can set another
// profile's picture; and only ids from the shipped set are ever written.
export async function saveAvatar(avatar: string, { getUserId, setAvatar }: AvatarStore): Promise<void> {
  if (!isAvatarId(avatar)) throw new Error("invalid_avatar");
  const userId = await getUserId();
  if (!userId) throw new Error("not_authenticated");
  await setAvatar(userId, avatar);
}

export type AvatarAnswer = { status: number; body: { ok: true } | { error: string } };

// POST /api/profile/avatar { "avatar": "<id>" }. A plain request rather than a server action: the browser
// sends server actions one at a time, so a pick made while the page's own GitHub sync was under way waited
// for it: a reload in that time showed the old picture, or lost the pick if it was still waiting. Like a server
// action, it only answers the app's own pages: the Origin has to name the host the request came to.
export async function answerAvatarRequest(
  { origin, host, body }: { origin: string | null; host: string | null; body: unknown },
  store: AvatarStore
): Promise<AvatarAnswer> {
  if (!origin || !host || hostOf(origin) !== host) return { status: 403, body: { error: "cross_origin" } };
  const avatar = body && typeof body === "object" ? (body as { avatar?: unknown }).avatar : undefined;
  try {
    await saveAvatar(typeof avatar === "string" ? avatar : "", store);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "invalid_avatar") return { status: 400, body: { error: code } };
    if (code === "not_authenticated") return { status: 401, body: { error: code } };
    console.error("avatar save failed", e);
    return { status: 500, body: { error: "save_failed" } };
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
