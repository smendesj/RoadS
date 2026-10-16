// A sprint is a week. Its lane is named after its Monday (`sprint-DD-MM-AAAA`) and titled by its dates only
// ("Sprint 12–16/10"); the weeks go in the order of their start date, never of the text of their id. The current
// week is told by the calendar in São Paulo, not by an id: the sprint lane whose dates hold today. A week is over
// from the day after its last day, so on a Saturday or a Sunday the current week is the one starting on the next
// Monday (the rotation of the sprints turns the week on that same day).
//
// Lanes are told apart by kind and dates only, so the three positional lanes (`atual`, `proxima`, `terceira`)
// that the database still holds until migration 0030 are weeks like any other. The e2e fixture (`zz-test-*`)
// lives in the real database and is never a week: it is left out of the current week, the rotation and the
// state handed to Frontlights.

export type WeekLaneRow = { id: string; kind: string; start_date: string | null; end_date: string | null };

export const TEST_LANE_PREFIX = "zz-test-";
export const SAO_PAULO = "America/Sao_Paulo";

export const isTestLane = (id: string): boolean => id.startsWith(TEST_LANE_PREFIX);

/** "2026-10-12" (a Monday) -> "sprint-12-10-2026". */
export function sprintIdFor(monday: string): string {
  const [y, m, d] = monday.split("-");
  return `sprint-${d}-${m}-${y}`;
}

/** "12–16/10", or "28/09–02/10" when the week crosses a month. */
export function weekDates(start: string, end: string): string {
  const [, sm, sd] = start.split("-");
  const [, em, ed] = end.split("-");
  return sm === em ? `${sd}–${ed}/${em}` : `${sd}/${sm}–${ed}/${em}`;
}

export const weekTitle = (start: string, end: string): string => `Sprint ${weekDates(start, end)}`;

export function todayInSaoPaulo(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: SAO_PAULO });
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday of the week that is current on `today`: its own week from Monday to Friday, the next one on a weekend. */
export function currentMonday(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday … 6 Saturday
  if (weekday === 6) return addDays(today, 2);
  if (weekday === 0) return addDays(today, 1);
  return addDays(today, 1 - weekday);
}

/** The lanes that are weeks: sprint lanes with both dates, the e2e fixture left out. */
export function weekLanes<T extends WeekLaneRow>(lanes: T[]): T[] {
  return lanes.filter((l) => l.kind === "sprint" && !!l.start_date && !!l.end_date && !isTestLane(l.id));
}

export function currentWeekLane<T extends WeekLaneRow>(lanes: T[], today: string): T | null {
  const day = today < currentMonday(today) ? currentMonday(today) : today;
  return sprintLanesByDate(weekLanes(lanes)).find((l) => l.start_date! <= day && day <= l.end_date!) ?? null;
}

/** The lane of the current week, for when it has to be created: named and dated by its Monday, Monday to Friday. */
export function newWeekLane(today: string): { id: string; title: string; kind: "sprint"; start_date: string; end_date: string } {
  const start = currentMonday(today);
  const end = addDays(start, 4);
  return { id: sprintIdFor(start), title: weekTitle(start, end), kind: "sprint", start_date: start, end_date: end };
}

/** Sprint lanes by start date; a lane with no date goes last, in the order it came. */
export function sprintLanesByDate<T extends WeekLaneRow>(lanes: T[]): T[] {
  return lanes
    .map((lane, i) => ({ lane, i }))
    .sort((a, b) => {
      const sa = a.lane.start_date ?? "9999";
      const sb = b.lane.start_date ?? "9999";
      return sa < sb ? -1 : sa > sb ? 1 : a.i - b.i;
    })
    .map(({ lane }) => lane);
}
