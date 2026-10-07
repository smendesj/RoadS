// The vocabulary and the rules that turn GitHub facts into a PROPOSED status for the report. Pure: no
// network, no clock. The user has the last word on the screen ("concluído" above all); this only proposes
// and keeps the evidence it used.
import { BOARD_STATUSES } from "../board.ts";
import type { BoardStatus } from "../board.ts";
import { localDay } from "../progress-report.ts";
import type { EntryStatus } from "../progress-report.ts";

/** Delivery means reaching this branch. */
export const MAIN_BRANCH = "main";

/**
 * What an open (or draft) PR reads as while its issue is still open. Decided with the product owner:
 * "em_validacao", because in this workflow a PR is published only once the work is done and waiting for
 * the live check. Change this single line to make an open PR read as "em_andamento" instead.
 */
export const OPEN_PR_STATUS: EntryStatus = "em_validacao";

export type PrFact = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  base: string | null;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  /** Earliest commit of the PR branch: the work often predates the day the PR was opened. */
  firstCommitAt: string | null;
};

export type StatusInput = {
  /** Exclusive end of the report window. Work and merges only count when they happened before it. */
  windowEnd: string;
  /** When the issue was closed as completed, whenever that happened (null if open or not planned). */
  closedAt: string | null;
  /** The Project #7 status when the window ended, and now ("Done" now is the user's confirmation). */
  board: { atEnd: BoardStatus | null; now: BoardStatus | null };
  /** The PRs linked to the issue (by "(#N)" in the title or by a closing reference), any state. */
  prs: PrFact[];
  /** Numbers of the PRs GitHub itself says closed the issue. */
  closers?: number[];
  /** Instants of the commits that cite the issue. */
  commits: string[];
  /** The parts of the issue (the leaves of its sub-issue tree): how many there are and how many are done. */
  subIssues?: { total: number; done: number } | null;
  /** Instants at which parts of the issue, at any depth, were closed as completed: a delivered part is work done. */
  closedParts?: string[];
};

export type StatusReason =
  | "merged_confirmed"
  | "merged_awaiting_confirmation"
  | "pr_open"
  | "closed_without_pr"
  | "blocked"
  | "children_pending"
  | "work_in_progress"
  | "board_development";

export type StatusDecision = {
  status: EntryStatus;
  reason: StatusReason;
  /** The PR whose merge into main is the delivery date; never the date the issue was closed. */
  delivery: PrFact | null;
  /** The delivery instant in São Paulo time, e.g. "2026-03-08T23:30:00-03:00". */
  deliveredAt: string | null;
  /** The São Paulo calendar day of the delivery (a 23:30 merge is still that day, though already tomorrow in UTC). */
  deliveredDay: string | null;
};

/** An instant as an ISO string with the São Paulo offset (no daylight saving there since 2019). */
export function toSaoPauloIso(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  return new Date(ms - 3 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

/** A raw Project #7 status name as one of the four known ones, else null. */
export function asBoardStatus(name: string | null | undefined): BoardStatus | null {
  return (BOARD_STATUSES as readonly string[]).includes(name ?? "") ? (name as BoardStatus) : null;
}

/**
 * The Project #7 status at an instant. The item only knows its current value and when that changed; if it
 * changed after `at`, the timeline history (when GitHub recorded it) says what it was, else it is unknown.
 */
export function boardStatusAt(
  item: { status: string | null; statusUpdatedAt: string | null } | null,
  history: { at: string; to: string }[],
  at: string
): BoardStatus | null {
  if (!item) return null;
  const limit = Date.parse(at);
  if (!item.statusUpdatedAt || Date.parse(item.statusUpdatedAt) < limit) return asBoardStatus(item.status);
  const earlier = history
    .filter((e) => Date.parse(e.at) < limit)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  return earlier ? asBoardStatus(earlier.to) : null;
}

const mergedAtOf = (p: PrFact): number => Date.parse(p.mergedAt ?? "");

/**
 * What a PR was at an instant: merged by then, open (the user could already see it), closed without
 * merging, or not opened yet ("later": a branch may still have had commits before then).
 */
export function prStateAt(p: PrFact, at: string): "merged" | "open" | "abandoned" | "later" {
  const t = Date.parse(at);
  const before = (x: string | null): boolean => x !== null && Date.parse(x) < t;
  if (before(p.mergedAt)) return "merged";
  if (!before(p.createdAt)) return "later";
  return p.state === "closed" && before(p.closedAt) ? "abandoned" : "open";
}

/**
 * Which merged PR is "the delivery": the one GitHub says closed the issue; else, once the issue is closed,
 * the last PR merged up to the closure (a follow-up PR that only mentions the issue in its title does not
 * move the date); else, while it is still open, the last piece merged so far.
 */
export function pickDelivery(mergedIntoMain: PrFact[], closers: number[], closedAt: string | null): PrFact | null {
  if (mergedIntoMain.length === 0) return null;
  const sorted = [...mergedIntoMain].sort((a, b) => mergedAtOf(a) - mergedAtOf(b) || a.number - b.number);
  const closer = sorted.find((p) => closers.includes(p.number));
  if (closer) return closer;
  if (closedAt) {
    const upToClosure = sorted.filter((p) => mergedAtOf(p) <= Date.parse(closedAt));
    return upToClosure.at(-1) ?? sorted[0];
  }
  return sorted.at(-1) ?? null;
}

/**
 * The proposed status as of the end of the window, or null when the issue has no place in the report
 * (backlog: nothing done, nothing committed to for the sprint).
 *
 * Work and merges count only until the window ends, except the human confirmation: closing the issue or
 * moving it to Done after the window still turns an already merged delivery into "concluido", since the
 * e-mail goes out after the window.
 */
export function classifyEntry(input: StatusInput): StatusDecision | null {
  const end = Date.parse(input.windowEnd);
  const before = (t: string | null): boolean => t !== null && Date.parse(t) < end;

  const merged = input.prs.filter((p) => prStateAt(p, input.windowEnd) === "merged");
  const open = input.prs.filter((p) => prStateAt(p, input.windowEnd) === "open");
  const mergedMain = merged.filter((p) => p.base === MAIN_BRANCH);
  const children = input.subIssues && input.subIssues.total > 0 ? input.subIssues : null;
  // An umbrella is delivered by its last step, whatever PR GitHub says "closed" the umbrella issue itself.
  const delivery = pickDelivery(mergedMain, children ? [] : input.closers ?? [], input.closedAt);
  const decide = (status: EntryStatus, reason: StatusReason): StatusDecision => ({
    status,
    reason,
    delivery,
    deliveredAt: delivery?.mergedAt ? toSaoPauloIso(delivery.mergedAt) : null,
    deliveredDay: delivery?.mergedAt ? localDay(delivery.mergedAt) : null,
  });

  const childrenPending = children !== null && children.done < children.total;
  const confirmed = input.closedAt !== null || input.board.now === "Done";

  if (delivery && confirmed && !childrenPending) return decide("concluido", "merged_confirmed");
  if (before(input.closedAt) && merged.length === 0 && open.length === 0 && !childrenPending) {
    return decide("concluido", "closed_without_pr");
  }
  if (input.board.atEnd === "Blocker") return decide("bloqueado", "blocked");
  if (merged.length > 0 || open.length > 0) {
    if (childrenPending) return decide("em_andamento", "children_pending");
    return merged.length > 0 ? decide("em_validacao", "merged_awaiting_confirmation") : decide(OPEN_PR_STATUS, "pr_open");
  }
  const worked =
    input.commits.some(before) || input.prs.some((p) => before(p.firstCommitAt) || before(p.createdAt)) || (input.closedParts ?? []).some(before);
  if (worked) return decide("em_andamento", "work_in_progress");
  if (input.board.atEnd === "Development") return decide("proximo", "board_development");
  return null;
}
