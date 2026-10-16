// The Roadmap as it stands now, in the shape FrontlightS reads at GET /api/frontlights/roadmap-state
// (contract schemaVersion 1). Pure on purpose: the route reads the rows and this builds the answer,
// so the contract is testable without a database. It never carries a sync marker or an ack: those
// belong to /pending-changes and /ack, and this stays read-only.
//
// A sprint is a week (src/lib/sprint-week.ts): its sprintId is `sprint-DD-MM-AAAA`, from its Monday, and its title
// is its dates. laneId is the lane's own id, the same once migration 0031 has renamed the lanes; until then a
// positional lane (`atual`…) is a week like the others, told by its dates. The weeks come in the order of their
// start date. The e2e fixture lanes (`zz-test-*`) and what is in them never reach Frontlights.
//
// Which weeks: the current one always (empty when it has no lane), every stored week that holds an item, past or
// future, and every week an unacked change names, stored empty or already deleted (then empty and dated by its id),
// so Frontlights can write the departure into its file. A stored empty week that is none of these stays out.

import { statusByUrl, type StatusKey } from "./board.ts";
import { currentMonday, isTestLane, sprintIdFor, sprintLanesByDate, todayInSaoPaulo, weekTitle } from "./sprint-week.ts";
import { weekOfId } from "./week-plan.ts";
import { MAX_ITEMS_PER_SPRINT } from "./types.ts";

type SnapshotColumn = { key: string; items: { url: string }[] };

export type LaneRow = { id: string; title: string; kind: string; start_date: string | null; end_date: string | null; sort_order: number };
export type ItemRow = {
  id: string;
  lane_id: string;
  sort_order: number;
  title: string;
  description: string;
  produto: string;
  prioridade: string;
  effort: string;
  github_issue_url: string | null;
  github_issue_number: number | null;
  updated_at: string;
};
export type PendingRow = { id: string; item_id: string | null; action: string; payload: Record<string, unknown> | null };

export type StateStatus = "open" | "development" | "blocker" | "done" | "none";
export type StateItem = {
  id: string;
  position: number;
  title: string;
  description: string;
  produto: string;
  prioridade: string;
  effort: string;
  githubIssueUrl: string | null;
  issueNumber: number | null;
  status: StateStatus;
  done: boolean;
  updatedAt: string;
  pendingChangeIds: string[];
};
export type StateSprintItem = StateItem & { overLimit: boolean };
export type RoadmapState = {
  schemaVersion: 1;
  asOf: string;
  snapshotSyncedAt: string | null;
  maxSprintItems: number;
  timezone: "America/Sao_Paulo";
  sprints: { sprintId: string; laneId: string; title: string; startDate: string; endDate: string; items: StateSprintItem[] }[];
  groups: { laneId: string; title: string; items: StateItem[] }[];
  removedPending: { changeId: string; itemId: null; title: string; laneId: string | null }[];
};

const STATUS_BY_KEY: Record<StatusKey, StateStatus> = { open: "open", dev: "development", blocker: "blocker", done: "done" };
const ISSUE_NUMBER = /\/issues\/(\d+)/;
// The queued changes that name a lane: lane_id of these three, and from_lane_id of a move_lane.
const CITING_ACTIONS = new Set(["add", "remove", "move_lane"]);

// The stored number wins; an older row may carry only the URL.
function issueNumberOf(row: ItemRow): number | null {
  if (!row.github_issue_url) return null;
  if (row.github_issue_number) return row.github_issue_number;
  const fromUrl = Number(row.github_issue_url.match(ISSUE_NUMBER)?.[1]);
  return fromUrl || null;
}

export function buildRoadmapState(input: {
  lanes: LaneRow[];
  items: ItemRow[];
  columns: SnapshotColumn[] | null;
  snapshotSyncedAt: string | null;
  pending: PendingRow[];
  now: Date;
}): RoadmapState {
  const byUrl = statusByUrl(input.columns ?? []);

  const pendingByItem = new Map<string, string[]>();
  for (const change of input.pending) {
    if (!change.item_id) continue;
    pendingByItem.set(change.item_id, [...(pendingByItem.get(change.item_id) ?? []), change.id]);
  }

  // The stored order, made stable: sort_order, then the id, the same order the Roadmap and the Dashboard read from
  // the database (getRoadmapBoard), so a tie left by older rows lands in one place on the screen and in the file.
  const itemOrder = (a: ItemRow, b: ItemRow): number => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const itemsByLane = new Map<string, ItemRow[]>();
  for (const row of [...input.items].sort(itemOrder)) {
    itemsByLane.set(row.lane_id, [...(itemsByLane.get(row.lane_id) ?? []), row]);
  }

  const toItem = (row: ItemRow, index: number): StateItem => {
    const key = row.github_issue_url ? byUrl.get(row.github_issue_url) : undefined;
    const status = key ? STATUS_BY_KEY[key] : "none";
    return {
      id: row.id,
      position: index + 1,
      title: row.title,
      description: row.description,
      produto: row.produto,
      prioridade: row.prioridade,
      effort: row.effort,
      githubIssueUrl: row.github_issue_url,
      issueNumber: issueNumberOf(row),
      status,
      done: status === "done",
      updatedAt: row.updated_at,
      pendingChangeIds: pendingByItem.get(row.id) ?? [],
    };
  };

  const lanes = input.lanes.filter((l) => !isTestLane(l.id));
  const sprintLanes = sprintLanesByDate(lanes.filter((l) => l.kind === "sprint"));
  // The ids the unacked changes name: lane_id of an add, a remove or a move_lane, from_lane_id of a move_lane.
  const cited = new Set<string>();
  for (const change of input.pending) {
    if (!CITING_ACTIONS.has(change.action)) continue;
    for (const key of change.action === "move_lane" ? ["lane_id", "from_lane_id"] : ["lane_id"]) {
      const id = change.payload?.[key];
      if (typeof id === "string") cited.add(id);
    }
  }
  const monday = currentMonday(todayInSaoPaulo(input.now));

  // A stored week comes when it holds an item (past or future), when it is the current week, or when an unacked
  // change names it (by its own id or by its date id); a stored week that is none of these stays out.
  const sprints: RoadmapState["sprints"] = [];
  for (const lane of sprintLanes) {
    // A sprint with no dates has nothing to name a folder or a file after, so it is left out.
    if (!lane.start_date || !lane.end_date) continue;
    const items = (itemsByLane.get(lane.id) ?? []).map(toItem);
    const current = lane.start_date <= monday && monday <= lane.end_date;
    if (!items.length && !current && !cited.has(lane.id) && !cited.has(sprintIdFor(lane.start_date))) continue;
    sprints.push({
      sprintId: sprintIdFor(lane.start_date),
      laneId: lane.id,
      title: weekTitle(lane.start_date, lane.end_date),
      startDate: lane.start_date,
      endDate: lane.end_date,
      items: items.map((it, i) => ({ ...it, overLimit: i >= MAX_ITEMS_PER_SPRINT })),
    });
  }

  // Weeks with no lane that still belong in the answer, empty, named and dated by their id: the current week,
  // always, and every week an unacked change names once its lane is gone: the future week its last item left, the
  // ended week the rotation deleted. After the ack the week is no longer named and is gone. Only a real Monday's
  // `sprint-DD-MM-AAAA` is a week, and a week a lane already holds (by its dates, so a positional lane too) is never
  // added twice. The screen's empty weeks (the one at the end, the gaps) are in neither the lanes nor the queue.
  const held = (start: string) => sprints.some((s) => s.startDate <= start && start <= s.endDate);
  const addWeek = (id: string) => {
    const week = weekOfId(id);
    if (!week || held(week.start)) return;
    sprints.push({ sprintId: id, laneId: id, title: weekTitle(week.start, week.end), startDate: week.start, endDate: week.end, items: [] });
  };
  addWeek(sprintIdFor(monday));
  for (const id of cited) addWeek(id);
  sprints.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const groups: RoadmapState["groups"] = [...lanes]
    .filter((l) => l.kind !== "sprint")
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((lane) => ({ laneId: lane.id, title: lane.title, items: (itemsByLane.get(lane.id) ?? []).map(toItem) }));

  // A removal names its lane as it was then; a sprint lane is named by its week, like sprints[].sprintId.
  const weekOf = new Map(sprintLanes.filter((l) => l.start_date).map((l) => [l.id, sprintIdFor(l.start_date!)]));
  const removedPending = input.pending
    .filter((c) => c.action === "remove")
    .map((c) => {
      const laneId = typeof c.payload?.lane_id === "string" ? c.payload.lane_id : null;
      return {
        changeId: c.id,
        itemId: null as null,
        title: typeof c.payload?.title === "string" ? c.payload.title : "",
        laneId: laneId === null ? null : weekOf.get(laneId) ?? laneId,
      };
    })
    .filter((r) => !(r.laneId && isTestLane(r.laneId)));

  return {
    schemaVersion: 1,
    asOf: input.now.toISOString(),
    snapshotSyncedAt: input.snapshotSyncedAt,
    maxSprintItems: MAX_ITEMS_PER_SPRINT,
    timezone: "America/Sao_Paulo",
    sprints,
    groups,
    removedPending,
  };
}
