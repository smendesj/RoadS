import { createHash, timingSafeEqual } from "node:crypto";

// True when the Authorization header is exactly `Bearer <secret>`. Compared in constant time (on
// equal-length digests) so response timing can't be used to guess the secret one character at a
// time; with no secret configured nothing matches, look-alikes like "Bearer undefined" included.
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
