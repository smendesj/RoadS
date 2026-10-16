// An issue closed before its week came leaves that week (issue #16): the sync's reconcile takes the item out with a
// remove, CLOSED_BEFORE_WEEK as its reason, and the issue shows in the Kanban's Done from the board snapshot. Only a week
// still to come (its Monday after the current week's, src/lib/week-plan.ts) is looked at: the current week keeps its
// closed issues, and so does one that ended, since the turn of the week takes them out as done (sprint-rotation.ts).
// "Closed" is an issue on Project #7 that is no longer among the repo's open issues; one taken off the Project, an item
// with no issue, the e2e test week and a lane with no dates are left alone. Pure, so the rule runs under test.

import { weekLanes, type WeekLaneRow } from "./sprint-week.ts";
import { weekFate } from "./week-plan.ts";

export const CLOSED_BEFORE_WEEK = "issue closed before its sprint";

export type PlannedItem = { id: string; laneId: string; number: number | null };

export function closedBeforeTheirWeek(input: {
  today: string;
  lanes: WeekLaneRow[];
  items: PlannedItem[];
  open: ReadonlySet<number>;
  onProject: ReadonlySet<number>;
}): { id: string; laneId: string }[] {
  const toCome = new Set(weekLanes(input.lanes).filter((w) => weekFate(w.start_date!, input.today) === "future").map((w) => w.id));
  return input.items
    .filter((it) => toCome.has(it.laneId) && !!it.number && input.onProject.has(it.number) && !input.open.has(it.number))
    .map((it) => ({ id: it.id, laneId: it.laneId }));
}

/** The row the remove is queued with: item_id null since the item is about to go, the payload carrying it all. */
export type ClosedRemoveRow = {
  item_id: null;
  action: "remove";
  payload: { item_id: string; lane_id: string; title: string; github_issue_url: string | null; reason: typeof CLOSED_BEFORE_WEEK };
};

/** The database behind the removal, so the sequence runs under test; board-sync.ts plugs the real ones in. */
export type ClosedRemovalDeps = {
  /** Inserts the row into roadmap_sync_queue and answers its id; throws when the insert fails. */
  queue(row: ClosedRemoveRow): Promise<string>;
  /** Deletes the item only while it is still in `laneId`; answers whether a row went; throws when the delete fails. */
  deleteFromWeek(id: string, laneId: string): Promise<boolean>;
  /** Takes the queued row back out. */
  unqueue(queueId: string): Promise<void>;
  /** Deletes the lane when it is a week to come left empty, never a positional one (src/lib/week-lanes.ts). */
  deleteFutureWeekIfEmpty(laneId: string): Promise<unknown>;
};

/**
 * Takes out of the weeks to come the items whose issue was closed, in the order the rotation's remove keeps: the
 * change is queued first, with item_id null since the row is about to go and the payload carrying it all; then the
 * delete, only of the item still in the week this sync saw it in; when it fails or finds nothing (another sync took
 * it), the change just queued is withdrawn. A failed queue stops here with nothing deleted. A week to come that this
 * left empty goes, after all its items; a failure there keeps the week, empty. Answers how many items left.
 */
export async function removeClosedBeforeTheirWeek(
  input: {
    today: string;
    lanes: WeekLaneRow[];
    items: (PlannedItem & { title: string; githubIssueUrl: string | null })[];
    open: ReadonlySet<number>;
    onProject: ReadonlySet<number>;
  },
  deps: ClosedRemovalDeps
): Promise<number> {
  const byId = new Map(input.items.map((it) => [it.id, it]));
  const leaving = closedBeforeTheirWeek(input);

  let left = 0;
  const emptied = new Set<string>();
  for (const { id, laneId } of leaving) {
    const item = byId.get(id)!;
    const queued = await deps.queue({
      item_id: null,
      action: "remove",
      payload: { item_id: id, lane_id: laneId, title: item.title, github_issue_url: item.githubIssueUrl, reason: CLOSED_BEFORE_WEEK },
    });
    let removed: boolean;
    try {
      removed = await deps.deleteFromWeek(id, laneId);
    } catch (e) {
      await deps.unqueue(queued);
      throw e;
    }
    if (!removed) {
      await deps.unqueue(queued);
      continue;
    }
    left++;
    emptied.add(laneId);
  }
  for (const laneId of emptied) {
    await deps.deleteFutureWeekIfEmpty(laneId).catch((e) => console.error("deleteFutureWeekIfEmpty failed; the empty week stays", e));
  }
  return left;
}
