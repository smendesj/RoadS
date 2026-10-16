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
