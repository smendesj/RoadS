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
  /** The card's own id on the Project (what a Status is written to), not the issue's. */
  id?: string;
  content?: { number?: number; title?: string; url?: string; repository?: { nameWithOwner?: string } } | null;
  /** The Status value; `updatedAt` is when GitHub last changed it on this card. */
  fieldValueByName?: { name?: string; updatedAt?: string } | null;
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

export type ProjectCard = { itemId: string; number: number; status: BoardStatus; statusAt: string };

/**
 * A GeoCloud card as the sprint sync reads it: its id on the Project, the issue, its Status and since when.
 * A card missing any of those can't be judged or written to, so it isn't one. ELIMS never is.
 */
export function projectCard(node: ProjectNode): ProjectCard | null {
  const card = boardCard(node);
  const number = node.content?.number;
  const statusAt = node.fieldValueByName?.updatedAt;
  if (!card || !number || !node.id || !statusAt) return null;
  return { itemId: node.id, number, status: card.status, statusAt };
}

const COLUMN_OF_STATUS = { Open: "open", Development: "dev" } as const;

/**
 * The snapshot's columns after RoadS wrote these Statuses to the Project: each card moves to the column of
 * its new Status and the counts follow, so the Dashboard doesn't show the old Status until the next sync.
 * A card the snapshot doesn't have is ignored; the input isn't touched.
 */
export function withStatusWrites<C extends { key: string; count: number; items: { url: string }[] }>(
  columns: C[],
  changes: { url: string; status: keyof typeof COLUMN_OF_STATUS }[]
): C[] {
  let next = columns;
  for (const { url, status } of changes) {
    const from = next.find((c) => c.items.some((i) => i.url === url));
    const card = from?.items.find((i) => i.url === url);
    if (!from || !card) continue;
    const to = COLUMN_OF_STATUS[status];
    if (from.key === to || !next.some((c) => c.key === to)) continue;
    next = next.map((c) => {
      if (c.key === from.key) {
        const items = c.items.filter((i) => i.url !== url);
        return { ...c, items, count: items.length };
      }
      if (c.key === to) {
        const items = [...c.items, card];
        return { ...c, items, count: items.length };
      }
      return c;
    });
  }
  return next;
}

/** The Project view whose order the Dashboard's Kanban follows. */
export const KANBAN_VIEW = "Kanban";
const SORTABLE = ["Created", "Updated", "Title"] as const;

export type SortKey = { field: (typeof SORTABLE)[number]; direction: "ASC" | "DESC" };

type ProjectView = { name?: string; sortByFields?: { nodes?: { direction?: string; field?: { name?: string } | null }[] } | null };

/**
 * How the Kanban view on GitHub sorts its cards. A sort on a field RoadS doesn't read (a custom field, say) can't be
 * followed in part without lying about the order, so it falls back to none: the Project's manual order.
 */
export function kanbanSort(views: ProjectView[] | undefined): SortKey[] {
  const nodes = views?.find((v) => v.name === KANBAN_VIEW)?.sortByFields?.nodes ?? [];
  const keys: SortKey[] = [];
  for (const n of nodes) {
    const field = n.field?.name;
    if (!(SORTABLE as readonly string[]).includes(field ?? "") || (n.direction !== "ASC" && n.direction !== "DESC")) return [];
    keys.push({ field: field as SortKey["field"], direction: n.direction });
  }
  return keys;
}

export type SortableCard = { card: BoardCard; createdAt: string; updatedAt: string };

const sortValue = (e: SortableCard, field: SortKey["field"]) =>
  field === "Created" ? e.createdAt : field === "Updated" ? e.updatedAt : e.card.title.toLocaleLowerCase("pt-BR");

/** The cards in the Kanban view's order; a tie on every field keeps the order they were read in (the Project's manual one). */
export function sortCards(entries: SortableCard[], sort: SortKey[]): BoardCard[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      for (const { field, direction } of sort) {
        const x = sortValue(a.e, field);
        const y = sortValue(b.e, field);
        if (x !== y) return (x < y ? -1 : 1) * (direction === "ASC" ? 1 : -1);
      }
      return a.i - b.i;
    })
    .map(({ e }) => e.card);
}

/** Per Status, how many cards of other repositories (ELIMS) the Project holds that the RoadS board leaves out. */
export function otherRepoCounts(nodes: ProjectNode[]): Map<BoardStatus, number> {
  const counts = new Map<BoardStatus, number>();
  for (const node of nodes) {
    const status = node.fieldValueByName?.name as BoardStatus | undefined;
    if (!node.content?.number || node.content.repository?.nameWithOwner === BOARD_REPO) continue;
    if (!status || !BOARD_STATUSES.includes(status)) continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}
