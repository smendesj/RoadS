// Coverage gaps: git work (a commit, a merged PR) that no Claude message sits near. Something was done
// outside the machine the usage collector reads (the phone, a cloud session, another account), so the
// usage numbers of that day understate the work, and the "conferência" table must say so.
import type { CoverageGap, UsageModel } from "../progress-report.ts";

export type GitWork = { at: string; ref: string };

const MINUTE = 60_000;

/** The usage collector hands over sessions, not messages: a session becomes a point every 30 minutes. */
const SESSION_STEP_MINUTES = 30;

/**
 * Work farther than `thresholdMinutes` from every message is a gap; exactly the threshold is not.
 * Without any message, every piece of work is a gap (nearestMessageMinutes: null). Sorted by time, then
 * by ref, so the same input always prints the same table.
 */
export function findCoverageGaps(gitTimes: GitWork[], messageTimes: string[], thresholdMinutes = 90): CoverageGap[] {
  const messages = messageTimes.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  const seen = new Set<string>();
  const gaps: (CoverageGap & { ms: number })[] = [];
  for (const work of gitTimes) {
    const ms = Date.parse(work.at);
    if (!Number.isFinite(ms)) continue;
    const key = `${work.ref}|${ms}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nearest = nearestDistance(messages, ms);
    if (nearest === null) {
      gaps.push({ at: work.at, ref: work.ref, nearestMessageMinutes: null, ms });
    } else if (nearest > thresholdMinutes * MINUTE) {
      // ceil: a reported gap always shows more minutes than the threshold, never "90" for a 90.4 gap.
      gaps.push({ at: work.at, ref: work.ref, nearestMessageMinutes: Math.ceil(nearest / MINUTE), ms });
    }
  }
  gaps.sort((a, b) => a.ms - b.ms || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return gaps.map((gap) => ({ at: gap.at, ref: gap.ref, nearestMessageMinutes: gap.nearestMessageMinutes }));
}

/** Distance in ms from `ms` to the closest value of the sorted `sorted` list; null when it is empty. */
function nearestDistance(sorted: number[], ms: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  const after = Math.abs(sorted[lo] - ms);
  const before = lo > 0 ? Math.abs(ms - sorted[lo - 1]) : Infinity;
  return Math.min(after, before);
}

/** Instants standing in for "a message was sent here": session spans in steps, plus first/last prompt. */
export function messageTimesFromUsage(usage: Pick<UsageModel, "days">): string[] {
  const times: string[] = [];
  for (const day of usage.days ?? []) {
    if (day.firstPromptAt) times.push(day.firstPromptAt);
    if (day.lastPromptAt) times.push(day.lastPromptAt);
    for (const session of day.sessions ?? []) {
      const start = Date.parse(session.start);
      const end = Date.parse(session.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      for (let t = start; t < end; t += SESSION_STEP_MINUTES * MINUTE) times.push(new Date(t).toISOString());
      times.push(new Date(end).toISOString());
    }
  }
  return times;
}
