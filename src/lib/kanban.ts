// The Roadmap's Kanban, under the row of weeks: Open, where the scrum master plans, and Done, to look at. It is read
// from the Project #7 snapshot the sync stores (board_sync_state.columns) crossed with the Roadmap's items. Blocker and
// Development stay out: an issue in Development is already in the current week, which the sync keeps in step with
// the Project.
//
// Open has every card Open on the Project, in the order of the Project's Kanban view, each tied to the Roadmap item of
// the same issue (an issue no item holds, one with no type label, is shown but can't be planned). Before them come
// the items with no issue on the board, newest first: a "+ New item" draft, and an item whose issue the last sync did
// not see yet (just opened on saving it). A card whose item is in a week stays in Open, labelled with that week
// ("▸ Sprint 19/10"); dragged again, it goes to another week.
//
// Done has what went to Done in the last DONE_WINDOW_DAYS days, counted from when the card's Status changed on the
// Project (`statusAt`, stored with the snapshot since 16/10/2026), latest first; "Show all" shows all of them.
// Pure, so the rules run under test without a screen or a database.

import { statusByUrl } from "./board.ts";
import type { RoadmapItem } from "./types.ts";

export const DONE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type KanbanIssue = { title: string; ref: string; url: string; statusAt?: string };
export type OpenCard = {
  /** The Roadmap item of the card: the one with the same issue, or the item itself when it has no issue on the board. */
  item: RoadmapItem | null;
  /** The issue's card on the Project; null for an item with no issue on the board. */
  issue: KanbanIssue | null;
  /** The week the item is planned in, and the label the card carries for it. */
  week: { laneId: string; label: string } | null;
};
export type KanbanColumns = { open: OpenCard[]; done: { recent: KanbanIssue[]; all: KanbanIssue[] } };

type SnapshotColumn = { key: string; items: KanbanIssue[] };
type WeekLane = { id: string; title: string; start?: string; items: RoadmapItem[] };

/** "2026-10-19" -> "▸ Sprint 19/10": the week a Kanban card is planned in, by its first day. */
export function weekLabel(start: string): string {
  const [, m, d] = start.split("-");
  return `▸ Sprint ${d}/${m}`;
}

/** Latest first by `at`; the ones without it go last, in the order they came. */
function latestFirst<T>(list: T[], at: (x: T) => string | undefined): T[] {
  const time = (x: T) => {
    const t = Date.parse(at(x) ?? "");
    return Number.isNaN(t) ? -Infinity : t;
  };
  return list
    .map((x, i) => ({ x, i, t: time(x) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : b.t > a.t ? 1 : -1))
    .map(({ x }) => x);
}

export function kanbanColumns(columns: SnapshotColumn[], board: { lanes: WeekLane[]; groups: { items: RoadmapItem[] }[] }, now: number): KanbanColumns {
  const onBoard = statusByUrl(columns);
  const weekOf = new Map<string, OpenCard["week"]>();
  for (const lane of board.lanes) {
    const label = lane.start ? weekLabel(lane.start) : `▸ ${lane.title}`;
    for (const it of lane.items) weekOf.set(it.id, { laneId: lane.id, label });
  }
  const items = [...board.lanes, ...board.groups].flatMap((lane) => lane.items);
  const byUrl = new Map(items.filter((it) => it.url).map((it) => [it.url!, it]));

  const loose = latestFirst(
    items.filter((it) => !it.url || !onBoard.has(it.url)),
    (it) => it.createdAt
  ).map((it): OpenCard => ({ item: it, issue: null, week: weekOf.get(it.id) ?? null }));
  const issues = (columns.find((c) => c.key === "open")?.items ?? []).map((issue): OpenCard => {
    const it = byUrl.get(issue.url) ?? null;
    return { item: it, issue, week: it ? weekOf.get(it.id) ?? null : null };
  });

  const all = latestFirst(columns.find((c) => c.key === "done")?.items ?? [], (c) => c.statusAt);
  const recent = all.filter((c) => c.statusAt && now - Date.parse(c.statusAt) <= DONE_WINDOW_DAYS * DAY_MS);
  return { open: [...loose, ...issues], done: { recent, all } };
}
