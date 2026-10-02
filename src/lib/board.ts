// Project #7 holds GeoCloud and ELIMS issues side by side. The RoadS board only ever shows
// GeoCloud ones — ELIMS issues are never pulled into RoadS, whatever their status.

export const BOARD_REPO = "Essencis-Labs/GeoCloudAI";
export const BOARD_STATUSES = ["Open", "Development", "Blocker", "Done"] as const;

/** The status keys the Dashboard's snapshot columns carry (see STATUS_META in board-sync.ts). */
export type StatusKey = "open" | "dev" | "blocker" | "done";

/** Issue URL -> status key, from a board snapshot's columns. The one place both tabs read "done" from. */
export function statusByUrl(columns: { key: string; items: { url: string }[] }[]): Map<string, StatusKey> {
  const byUrl = new Map<string, StatusKey>();
  for (const col of columns) for (const it of col.items) byUrl.set(it.url, col.key as StatusKey);
  return byUrl;
}

/** The lanes with each item's Project #7 status filled in from the snapshot; an item with no issue, or one
 *  the snapshot lacks, gets none. The Roadmap passes only its sprint lanes, so only sprint items carry it. */
export function withIssueStatus<L extends { items: { url: string | null; status?: StatusKey }[] }>(
  lanes: L[],
  columns: { key: string; items: { url: string }[] }[]
): L[] {
  const byUrl = statusByUrl(columns);
  return lanes.map((lane) => ({
    ...lane,
    items: lane.items.map((it) => {
      const status = it.url ? byUrl.get(it.url) : undefined;
      return status ? { ...it, status } : it;
    }),
  }));
}

export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type BoardCard = { title: string; ref: string; url: string };

type ProjectNode = {
  content?: { number?: number; title?: string; url?: string; repository?: { nameWithOwner?: string } } | null;
  fieldValueByName?: { name?: string } | null;
};

export function boardCard(node: ProjectNode): { status: BoardStatus; card: BoardCard } | null {
  const content = node.content;
  const status = node.fieldValueByName?.name;
  if (!content?.number || content.repository?.nameWithOwner !== BOARD_REPO) return null;
  if (!status || !(BOARD_STATUSES as readonly string[]).includes(status)) return null;
  return {
    status: status as BoardStatus,
    card: { title: content.title ?? "", ref: `#${content.number}`, url: content.url ?? "" },
  };
}
