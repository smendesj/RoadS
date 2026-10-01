// A signed-in user is logged out after 10 minutes without any interaction.
export const IDLE_LIMIT_MS = 10 * 60 * 1000;

// lastActivity is the epoch-ms stamp of the last interaction; a missing or garbled stamp can't
// prove inactivity, so it never expires the session.
export function isIdleExpired(lastActivity: number | null, now: number): boolean {
  if (lastActivity === null || Number.isNaN(lastActivity)) return false;
  return now - lastActivity >= IDLE_LIMIT_MS;
}
