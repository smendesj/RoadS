import { currentWeekLane, newWeekLane, sprintLanesByDate, weekLanes, type WeekLaneRow } from "./sprint-week.ts";

// The turn of the week (see sprint-week.ts): only the week that ended moves. A week is over from the
// day after its last day, so the week of Friday 16/10 turns on Saturday 17/10, into the week of Monday 19/10. Its
// items the board marks Done leave the Roadmap (an item with no issue is never done); the rest go, in their order,
// on top of the week of today, which is created when it is missing, and the items already planned there go down
// (a new order only: nothing is queued for them, they did not change week). The week that ended is then empty and
// its lane goes. The weeks to come never move. Weeks nobody synced in are all turned at once, so each item gets a
// single move, to today's week, the oldest week's items first. Any dated sprint lane is a week, so the positional
// lanes count until migration 0031 renames them; the e2e fixture never does.

export type WeekItem = { id: string; laneId: string; sortOrder: number; url: string | null };

export type WeekRotationPlan = {
  /** Done items of the weeks that ended: they leave the Roadmap (a remove each). */
  finished: { id: string; laneId: string }[];
  /** The lane of today's week the rest go to; null when nothing goes. */
  target: string | null;
  /** True when that lane does not exist yet and must be created first (named and dated by its Monday). */
  createTarget: boolean;
  /** The items that change week (a move_lane each, origin rotation), on top of today's week in this order. */
  moves: { id: string; from: string; to: string; sortOrder: number }[];
  /** The items already in today's week, pushed down below the moved ones; no change to queue. */
  reorders: { id: string; sortOrder: number }[];
  /** The lanes of the weeks that ended, by date: empty once the plan is applied, so they go. */
  deleteLanes: string[];
};

const inOrder = (items: WeekItem[]): WeekItem[] =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.i - b.i)
    .map(({ item }) => item);

export function planRotation(input: { today: string; lanes: WeekLaneRow[]; items: WeekItem[]; doneUrls: Set<string> }): WeekRotationPlan {
  const weeks = sprintLanesByDate(weekLanes(input.lanes));
  const ended = weeks.filter((w) => w.end_date! < input.today);
  const plan: WeekRotationPlan = { finished: [], target: null, createTarget: false, moves: [], reorders: [], deleteLanes: ended.map((w) => w.id) };
  if (!ended.length) return plan;

  const current = currentWeekLane(weeks, input.today);
  const target = current?.id ?? newWeekLane(input.today).id;
  const carried: WeekItem[] = [];
  for (const w of ended) {
    for (const item of inOrder(input.items.filter((it) => it.laneId === w.id))) {
      if (item.url && input.doneUrls.has(item.url)) plan.finished.push({ id: item.id, laneId: item.laneId });
      else carried.push(item);
    }
  }
  if (!carried.length) return plan;

  plan.target = target;
  plan.createTarget = !current;
  plan.moves = carried.map((item, sortOrder) => ({ id: item.id, from: item.laneId, to: target, sortOrder }));
  inOrder(input.items.filter((it) => it.laneId === target)).forEach((item, i) => {
    const sortOrder = carried.length + i;
    if (item.sortOrder !== sortOrder) plan.reorders.push({ id: item.id, sortOrder });
  });
  return plan;
}
