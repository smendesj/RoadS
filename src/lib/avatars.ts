// Generic profile pictures shipped in /public/avatars. A user's choice is stored as the id only,
// so the id is validated against this list before it ever reaches the database.
export const AVATAR_IDS = Array.from({ length: 18 }, (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`);

export function isAvatarId(value: unknown): value is string {
  return typeof value === "string" && AVATAR_IDS.includes(value);
}

export function avatarSrc(id: string): string {
  return `/avatars/${id}.svg`;
}
