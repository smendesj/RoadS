// Project #7 holds GeoCloud and ELIMS issues side by side. The RoadS board only ever shows
// GeoCloud ones — ELIMS issues are never pulled into RoadS, whatever their status.

export const BOARD_REPO = "Essencis-Labs/GeoCloudAI";
export const BOARD_STATUSES = ["Open", "Development", "Blocker", "Done"] as const;

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
