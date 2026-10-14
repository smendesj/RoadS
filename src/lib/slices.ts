// The SLICES block of the Dashboard: the parts of every issue in the current sprint: its sub-issues or, for an issue
// with none (Frontlights stopped creating them on 13/10/2026), the boxes of its acceptance criteria (src/lib/criteria.ts). GitHub is read
// once per sync (board-sync.ts) and the groups are stored with the board snapshot; this module is the part
// that needs no server: the query, the reading of its answer, and the rows the Dashboard draws. Each row's
// Status comes from the same snapshot as the Kanban, so a slice reads the same in both places.

import type { StatusKey } from "./board.ts";
import { boxTitle, criteriaBoxes, type Box } from "./criteria.ts";
import { newestIssueFirst } from "./issue-order.ts";
import type { Tone } from "./tones.ts";

export const SLICES_REPO = { owner: "Essencis-Labs", name: "GeoCloudAI" } as const;
/** GitHub's page of sub-issues; an issue with more still says how many it has. */
const PAGE = 100;

export type SliceIssue = { number: number; title: string; url: string; state: "open" | "closed" };
export type SliceGroup = {
  parent: { number: number; title: string; url: string };
  /** All the parts the issue has: its sub-issues, which may be more than `items` holds, or its boxes. */
  total: number;
  items: SliceIssue[];
  /** For an issue with no sub-issues: the boxes of its acceptance criteria (then `items` is empty). */
  boxes?: Box[];
};

/** One GraphQL query for all the issues of the sprint. Only whole positive numbers are ever put into it. */
export function slicesQuery(numbers: number[]): string {
  const aliases = numbers
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => `i${n}: issue(number: ${n}) { number title url body subIssues(first: ${PAGE}) { totalCount nodes { number title url state } } }`)
    .join("\n    ");
  return `query {\n  repository(owner: "${SLICES_REPO.owner}", name: "${SLICES_REPO.name}") {\n    ${aliases}\n  }\n}`;
}

type RawIssue = { number?: unknown; title?: unknown; url?: unknown; state?: unknown };
type RawParent = RawIssue & { body?: unknown; subIssues?: { totalCount?: unknown; nodes?: unknown } | null };

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string";

/**
 * The answer of slicesQuery as groups, in the order of `numbers` (the order of the sprint). An issue with no
 * sub-issues, one GitHub didn't answer for or one that doesn't look right has nothing to show and is left out.
 */
export function parseSlices(data: unknown, numbers: number[]): SliceGroup[] {
  const repository = (data as { repository?: Record<string, RawParent | null> | null } | null)?.repository;
  if (!repository || typeof repository !== "object") return [];
  const groups: SliceGroup[] = [];
  for (const n of numbers) {
    const raw = repository[`i${n}`];
    if (!raw || !isNumber(raw.number) || !isText(raw.title) || !isText(raw.url)) continue;
    const nodes = Array.isArray(raw.subIssues?.nodes) ? (raw.subIssues!.nodes as RawIssue[]) : [];
    const items: SliceIssue[] = nodes.flatMap((s) =>
      isNumber(s.number) && isText(s.title) && isText(s.url) ? [{ number: s.number, title: s.title, url: s.url, state: s.state === "CLOSED" ? ("closed" as const) : ("open" as const) }] : []
    );
    if (!items.length) {
      // No sub-issues: its parts are the boxes of its acceptance criteria, when it has any.
      const none = !isNumber(raw.subIssues?.totalCount) || raw.subIssues?.totalCount === 0;
      const boxes = none && isText(raw.body) ? criteriaBoxes(raw.body) : null;
      if (boxes && boxes.length) groups.push({ parent: { number: raw.number, title: raw.title, url: raw.url }, total: boxes.length, items: [], boxes });
      continue;
    }
    const total = isNumber(raw.subIssues?.totalCount) ? Math.max(raw.subIssues!.totalCount as number, items.length) : items.length;
    groups.push({ parent: { number: raw.number, title: raw.title, url: raw.url }, total, items });
  }
  return groups;
}

export type SliceRow = { title: string; ref: string; url: string; status: string; tone: Tone };
export type SliceBlock = { title: string; ref: string; url: string; done: number; total: number; rows: SliceRow[] };

const STATUS: Record<StatusKey, { status: string; tone: Tone }> = {
  open: { status: "A FAZER", tone: "neutral" },
  dev: { status: "EM ANDAMENTO", tone: "brand" },
  blocker: { status: "BLOQUEADO", tone: "red" },
  done: { status: "CONCLUÍDO", tone: "green" },
};

/**
 * A slice stands where the board puts it; one that is closed is done whatever the board says, and one the board
 * doesn't have is still to do. Blocks and their rows go from the highest issue number to the lowest.
 */
export function sliceBlocks(groups: SliceGroup[], statusOf: Map<string, StatusKey>): SliceBlock[] {
  return newestIssueFirst(groups, (g) => g.parent.number).map((g) => {
    // Boxes keep the order the issue gives them (the order of its slices) and link to the issue itself.
    const boxRows = (g.boxes ?? []).map((b) => {
      const label = b.checked ? STATUS.done : b.blocked ? STATUS.blocker : STATUS.open;
      return { title: boxTitle(b.text), ref: "", url: g.parent.url, status: label.status, tone: label.tone };
    });
    const rows = [...boxRows, ...newestIssueFirst(g.items, (s) => s.number).map((s) => {
      const label = STATUS[s.state === "closed" ? "done" : (statusOf.get(s.url) ?? "open")];
      return { title: s.title, ref: `#${s.number}`, url: s.url, status: label.status, tone: label.tone };
    })];
    return {
      title: g.parent.title,
      ref: `#${g.parent.number}`,
      url: g.parent.url,
      done: rows.filter((r) => r.status === STATUS.done.status).length,
      total: g.total,
      rows,
    };
  });
}
