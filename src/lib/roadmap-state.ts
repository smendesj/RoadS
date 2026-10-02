// The Roadmap as it stands now, in the shape FrontlightS reads at GET /api/frontlights/roadmap-state
// (contract schemaVersion 1). Pure on purpose: the route reads the rows and this builds the answer,
// so the contract is testable without a database. It never carries a sync marker or an ack: those
// belong to /pending-changes and /ack, and this stays read-only.

import { statusByUrl, type StatusKey } from "./board.ts";
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

  const itemsByLane = new Map<string, ItemRow[]>();
  for (const row of [...input.items].sort((a, b) => a.sort_order - b.sort_order)) {
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

  const sprints: RoadmapState["sprints"] = [];
  const groups: RoadmapState["groups"] = [];
  for (const lane of [...input.lanes].sort((a, b) => a.sort_order - b.sort_order)) {
    const items = (itemsByLane.get(lane.id) ?? []).map(toItem);
    if (lane.kind === "sprint") {
      // A sprint with no dates has nothing to name a folder or a file after, so it is left out.
      if (!lane.start_date || !lane.end_date) continue;
      sprints.push({
        sprintId: `sprint-${lane.start_date}`,
        laneId: lane.id,
        title: lane.title,
        startDate: lane.start_date,
        endDate: lane.end_date,
        items: items.map((it, i) => ({ ...it, overLimit: i >= MAX_ITEMS_PER_SPRINT })),
      });
    } else {
      groups.push({ laneId: lane.id, title: lane.title, items });
    }
  }

  const removedPending = input.pending
    .filter((c) => c.action === "remove")
    .map((c) => ({
      changeId: c.id,
      itemId: null as null,
      title: typeof c.payload?.title === "string" ? c.payload.title : "",
      laneId: typeof c.payload?.lane_id === "string" ? c.payload.lane_id : null,
    }));

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
