// The parts of every issue in the current sprint, shown under it in the Dashboard's Sprint block: the boxes of its
// acceptance criteria, always, and its sub-issues still open (the rule is src/lib/parts.ts; a closed sub-issue is
// no part). GitHub is read once per sync (board-sync.ts) and the groups are stored with the board snapshot
// (board_sync_state.slices); this module is the part that needs no server: the query, the reading of its answer, and
// the rows the Dashboard draws. An open sub-issue's status comes from the same snapshot as the Kanban.

import type { StatusKey } from "./board.ts";
import { boxTitle, type Box } from "./criteria.ts";
import { newestIssueFirst } from "./issue-order.ts";
import { issueParts, partsOf } from "./parts.ts";
import type { Tone } from "./tones.ts";

export const SLICES_REPO = { owner: "Essencis-Labs", name: "GeoCloudAI" } as const;
/** GitHub's page of sub-issues; more than that per issue are not read. */
const PAGE = 100;

export type SliceIssue = { number: number; title: string; url: string; state: "open" | "closed" };
export type SliceGroup = {
  parent: { number: number; title: string; url: string };
  /** How many parts the issue had when it was read (the Dashboard counts them again, by the rule). */
  total: number;
  /** Its sub-issues still open (a snapshot from before 16/10/2026 may also hold closed ones). */
  items: SliceIssue[];
  /** The boxes of its acceptance criteria (missing in a snapshot from before 16/10/2026 when it had sub-issues). */
  boxes?: Box[];
};

/** One GraphQL query for all the issues of the sprint. Only whole positive numbers are ever put into it. */
export function slicesQuery(numbers: number[]): string {
  const aliases = numbers
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => `i${n}: issue(number: ${n}) { number title url body subIssues(first: ${PAGE}) { totalCount nodes { number title url state stateReason } } }`)
    .join("\n    ");
  return `query {\n  repository(owner: "${SLICES_REPO.owner}", name: "${SLICES_REPO.name}") {\n    ${aliases}\n  }\n}`;
}

type RawIssue = { number?: unknown; title?: unknown; url?: unknown; state?: unknown };
type RawParent = RawIssue & { body?: unknown; subIssues?: { totalCount?: unknown; nodes?: unknown } | null };

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string";

/**
 * The answer of slicesQuery as groups, in the order of `numbers` (the order of the sprint). GraphQL can't filter
 * sub-issues by state, so the closed ones are dropped here. An issue with no parts, one GitHub didn't answer for or
 * one that doesn't look right has nothing to show and is left out.
 */
export function parseSlices(data: unknown, numbers: number[]): SliceGroup[] {
  const repository = (data as { repository?: Record<string, RawParent | null> | null } | null)?.repository;
  if (!repository || typeof repository !== "object") return [];
  const groups: SliceGroup[] = [];
  for (const n of numbers) {
    const raw = repository[`i${n}`];
    if (!raw || !isNumber(raw.number) || !isText(raw.title) || !isText(raw.url)) continue;
    const nodes = Array.isArray(raw.subIssues?.nodes) ? (raw.subIssues!.nodes as RawIssue[]) : [];
    const read = nodes.flatMap((s) => (isNumber(s.number) && isText(s.title) && isText(s.url) ? [{ number: s.number, title: s.title, url: s.url, state: s.state }] : []));
    const parts = issueParts(isText(raw.body) ? raw.body : null, read);
    if (parts.total === 0) continue;
    groups.push({
      parent: { number: raw.number, title: raw.title, url: raw.url },
      total: parts.total,
      items: parts.open.map((s) => ({ number: s.number, title: s.title, url: s.url, state: "open" as const })),
      boxes: parts.boxes,
    });
  }
  return groups;
}

/** A row under an issue of the Sprint block: a box (no link, no number) or an open sub-issue. */
export type PartRow = { title: string; ref: string; url: string | null; status: string; tone: Tone };
export type IssuePartRows = { done: number; total: number; rows: PartRow[] };

const STATUS: Record<StatusKey, { status: string; tone: Tone }> = {
  open: { status: "A FAZER", tone: "neutral" },
  dev: { status: "EM ANDAMENTO", tone: "brand" },
  blocker: { status: "BLOQUEADO", tone: "red" },
  done: { status: "CONCLUÍDO", tone: "green" },
};

/**
 * The parts of each issue of the sprint, by issue number: its boxes first, in the order of the body (CONCLUÍDO when
 * ticked, BLOQUEADO when a "Bloqueada:" sub-item says so, A FAZER otherwise), then its open sub-issues from the
 * highest number to the lowest, each where the board puts it. "x de y" is counted by the rule (parts.ts), whatever
 * the snapshot says: a closed sub-issue left in an older snapshot is neither shown nor counted.
 */
export function partsByIssue(groups: SliceGroup[], statusOf: Map<string, StatusKey>): Map<number, IssuePartRows> {
  const byIssue = new Map<number, IssuePartRows>();
  for (const g of groups) {
    const parts = partsOf(g.boxes ?? [], g.items);
    if (parts.total === 0) continue;
    const boxRows = parts.boxes.map((b) => {
      const label = b.checked ? STATUS.done : b.blocked ? STATUS.blocker : STATUS.open;
      return { title: boxTitle(b.text), ref: "", url: null, status: label.status, tone: label.tone };
    });
    const subRows = newestIssueFirst(parts.open, (s) => s.number).map((s) => {
      const label = STATUS[statusOf.get(s.url) ?? "open"];
      return { title: s.title, ref: `#${s.number}`, url: s.url, status: label.status, tone: label.tone };
    });
    byIssue.set(g.parent.number, { done: parts.done, total: parts.total, rows: [...boxRows, ...subRows] });
  }
  return byIssue;
}
