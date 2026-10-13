// The brake in front of every sync: the Dashboard's and Roadmap's buttons, a page keeping itself in step, a move
// into or out of the current sprint, FrontlightS's sync-board and the daily cron all go through it (syncBoard in
// board-sync.ts). Two rules:
//   - inside the brake (30 s for a press, 5 min for a page's own sync: cooldownFor in auto-sync.ts) the last
//     snapshot comes back, with how long until the brake lets go, counted on the server's clock;
//   - before reaching GitHub a run claims itself in the database (claim_board_sync, migration 0029): granted only
//     when the brake has passed AND the last run finished (or has been stuck for minutes), so two never run at
//     once (a run takes seconds, and two together could open the same issue twice), and a run that failed still
//     holds the brake, so a broken GitHub isn't asked again by every open tab. Every granted run is marked
//     finished, failed or not.
// Pure, with the database and the sync behind BrakeDeps, so the rules run under test without either.

import type { SyncColumn, SyncResult } from "./board-sync.ts";

export type BrakeDeps = {
  now(): number;
  /** False without a GitHub token: then nothing is claimed and, past the brake, the answer is "not configured". */
  configured(): boolean;
  latestSnapshot(): Promise<{ columns: SyncColumn[] | unknown[]; syncedAt: string } | null>;
  /** Asks the database for the run; `claimedAt` is the claim that stands (this one when granted). No row: null. */
  claim(brakeMs: number): Promise<{ claimed: boolean; claimedAt: string | null }>;
  /** Marks the run claimed at `claimedAt` as finished. */
  finish(claimedAt: string): Promise<void>;
  run(): Promise<SyncResult>;
};

export async function brakedSync(deps: BrakeDeps, { brakeMs }: { brakeMs: number }): Promise<SyncResult> {
  const now = deps.now();
  const latest = await deps.latestSnapshot();
  const cached = (since: string): SyncResult => ({
    ok: true,
    columns: (latest?.columns ?? []) as SyncColumn[],
    syncedAt: latest?.syncedAt ?? since,
    roadmap: { added: 0, removed: 0, issuesCreated: 0 },
    cached: true,
    retryInMs: Math.max(0, Date.parse(since) + brakeMs - now),
  });

  if (latest) {
    const age = now - Date.parse(latest.syncedAt);
    if (age >= 0 && age < brakeMs) return cached(latest.syncedAt);
  }
  if (!deps.configured()) return { ok: false, reason: "not_configured" };
  const { claimed, claimedAt } = await deps.claim(brakeMs);
  if (!claimed && claimedAt) return cached(claimedAt);
  try {
    return await deps.run();
  } finally {
    if (claimed && claimedAt) await deps.finish(claimedAt).catch((e) => console.error("sync: marking the run finished failed", e));
  }
}
