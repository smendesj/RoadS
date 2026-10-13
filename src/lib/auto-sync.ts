// When the Dashboard and the Roadmap sync with GitHub Project #7 without anyone pressing the button: on opening,
// on coming back to the tab and every AUTO_SYNC_MS while the tab is visible, and right after a move that touches
// the current sprint (the one move that changes a Status on the Project). The server brakes each kind of call:
// a sync the page starts by itself reaches GitHub at most every AUTO_SYNC_MS, however many tabs are open, so the
// free tiers of Vercel and Supabase are never at stake; the button and a move keep the shorter SYNC_COOLDOWN_MS.

import { CURRENT_SPRINT } from "./sprint-status-sync.ts";
import { SYNC_COOLDOWN_MS } from "./sync-cooldown.ts";

export const AUTO_SYNC_MS = 5 * 60_000;
/** Coming back to a tab syncs, but switching back and forth asks at most this often. */
export const AUTO_SYNC_MIN_GAP_MS = 60_000;

export function cooldownFor({ auto = false }: { auto?: boolean }): number {
  return auto ? AUTO_SYNC_MS : SYNC_COOLDOWN_MS;
}

export function touchesCurrentSprint(from: string, to: string): boolean {
  return from !== to && (from === CURRENT_SPRINT || to === CURRENT_SPRINT);
}

/**
 * When to try again a move the button's brake held back: the server's own count (its clock, not the browser's),
 * half a second after, never sooner than 1 s (no tight loop) nor later than the brake and a margin.
 */
export function retryDelay(retryInMs: number | undefined): number {
  return Math.min(SYNC_COOLDOWN_MS + 5_000, Math.max(1_000, (retryInMs ?? 0) + 500));
}
