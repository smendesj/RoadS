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
