// When the Dashboard and the Roadmap sync with GitHub Project #7 without anyone pressing the button: on opening,
// on coming back to the tab and every AUTO_SYNC_MS while the tab is visible, and right after a move that touches
// the current sprint (the one move that changes a Status on the Project). The server brakes each kind of call:
// a sync the page starts by itself reaches GitHub at most every AUTO_SYNC_MS, however many tabs are open, so the
// free tiers of Vercel and Supabase are never at stake; the button and a move keep the shorter SYNC_COOLDOWN_MS.

import { CURRENT_SPRINT } from "./sprint-status-sync.ts";
import { SYNC_COOLDOWN_MS } from "./sync-cooldown.ts";

export const AUTO_SYNC_MS = 5 * 60_000;

export function cooldownFor({ auto = false }: { auto?: boolean }): number {
  return auto ? AUTO_SYNC_MS : SYNC_COOLDOWN_MS;
}

export function touchesCurrentSprint(from: string, to: string): boolean {
  return from !== to && (from === CURRENT_SPRINT || to === CURRENT_SPRINT);
}

/** How long until the button's brake lets a sync through again, counted from the last sync. */
export function retryDelay(syncedAt: string, now: number): number {
  const then = Date.parse(syncedAt);
  return Number.isNaN(then) ? 0 : Math.max(0, then + SYNC_COOLDOWN_MS - now);
}
