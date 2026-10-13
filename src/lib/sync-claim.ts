// The brake in front of every sync a signed-in page asks for (the button, a page keeping itself in step, a move
// into or out of the current sprint). Two rules:
//   - inside the brake (cooldownFor in auto-sync.ts: 30 s for the button, 5 min for a page's own sync) the last
//     snapshot comes back, with how long until the brake lets go, counted on the server's clock;
//   - before reaching GitHub a sync claims the run in board_sync_state.sync_claimed_at with a conditional update,
//     so two never run at once (a sync takes seconds, and two together could open the same issue twice), and a
//     sync that failed still holds the brake, so a broken GitHub isn't asked again by every open tab.
// Pure, with the database and the sync behind BrakeDeps, so the rules run under test without either.

import type { SyncColumn, SyncResult } from "./board-sync.ts";
import { cooldownFor } from "./auto-sync.ts";

export type BrakeDeps = {
  now(): number;
  /** False without a GitHub token: then nothing is claimed and, past the brake, the answer is "not configured". */
  configured(): boolean;
  latestSnapshot(): Promise<{ columns: SyncColumn[] | unknown[]; syncedAt: string } | null>;
  /** Claims the run unless one was claimed less than `brakeMs` ago; `claimedAt` is the claim that stands. No row: null. */
  claim(brakeMs: number): Promise<{ claimed: boolean; claimedAt: string | null }>;
  run(): Promise<SyncResult>;
};

export async function brakedSync(deps: BrakeDeps, { auto = false }: { auto?: boolean }): Promise<SyncResult> {
  const brake = cooldownFor({ auto });
  const now = deps.now();
  const latest = await deps.latestSnapshot();
  const cached = (since: string): SyncResult => ({
    ok: true,
    columns: (latest?.columns ?? []) as SyncColumn[],
    syncedAt: latest?.syncedAt ?? since,
    roadmap: { added: 0, removed: 0, issuesCreated: 0 },
    cached: true,
    retryInMs: Math.max(0, Date.parse(since) + brake - now),
  });

  if (latest) {
    const age = now - Date.parse(latest.syncedAt);
    if (age >= 0 && age < brake) return cached(latest.syncedAt);
  }
  if (!deps.configured()) return { ok: false, reason: "not_configured" };
  const { claimed, claimedAt } = await deps.claim(brake);
  if (!claimed && claimedAt) return cached(claimedAt);
  return deps.run();
}
