// Planning in weeks (src/lib/sprint-week.ts has what a week is). A week's lane exists only while it holds an item:
// it is created when the first item is dropped in it and deleted when a future week empties. These are the rules
// the server checks before it writes a lane with the service role (src/lib/week-lanes.ts); the id it is handed
// comes from the browser, so everything about the lane (title, dates) is derived here, never taken from the caller.

import { currentMonday, sprintIdFor, weekTitle } from "./sprint-week.ts";

/** How far ahead a week may be planned: the current week's Monday plus this many weeks. */
export const WEEK_HORIZON_WEEKS = 52;

const WEEK_ID = /^sprint-(\d{2})-(\d{2})-(\d{4})$/;

export type NewWeekLane = { id: string; title: string; kind: "sprint"; start_date: string; end_date: string };
export type WeekRefusal = "invalid" | "not_monday" | "past" | "too_far";

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "sprint-19-10-2026" -> its first day "2026-10-19" and the weekday of it (1 = Monday), or null when it is no real date. */
function parseWeekId(id: string): { start: string; weekday: number } | null {
  const m = WEEK_ID.exec(id);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const start = `${y}-${mo}-${d}`;
  if (date.toISOString().slice(0, 10) !== start) return null;
  return { start, weekday: date.getUTCDay() };
}

/** The lane to create for a week dropped on: a real Monday's id, not before the current week, within the horizon. */
export function weekToCreate(id: string, today: string): { ok: true; lane: NewWeekLane } | { ok: false; reason: WeekRefusal } {
  const parsed = parseWeekId(id);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (parsed.weekday !== 1) return { ok: false, reason: "not_monday" };
  const monday = currentMonday(today);
  if (parsed.start < monday) return { ok: false, reason: "past" };
  if (parsed.start > addDays(monday, 7 * WEEK_HORIZON_WEEKS)) return { ok: false, reason: "too_far" };
  const end = addDays(parsed.start, 4);
  return { ok: true, lane: { id: sprintIdFor(parsed.start), title: weekTitle(parsed.start, end), kind: "sprint", start_date: parsed.start, end_date: end } };
}

/**
 * Where a sprint lane stands today, by its first day against the current week's Monday: "future" (it goes when it
 * empties), "current" (never deleted for being empty) or "ended" (the rotation's to empty and delete).
 */
export function weekFate(start: string, today: string): "future" | "current" | "ended" {
  const monday = currentMonday(today);
  return start > monday ? "future" : start === monday ? "current" : "ended";
}

export type RowWeek = { id: string; start: string; end: string; virtual: boolean; current: boolean };

/**
 * The Roadmap's row of weeks: every week stored in the database (`weekLanes` of sprint-week.ts, so the e2e fixture
 * and lanes with no dates are not here), past ones included until the rotation deletes them, and every week from
 * the current one to the last stored one that the database lacks (a gap), plus one empty week after that: the
 * ones it lacks are `virtual`, shown but not stored until an item is dropped in them. Nothing is added past the
 * 52-week horizon. In date order; `current` is the week whose dates hold today (the next one on a weekend).
 */
export function weekRow(stored: { id: string; start_date: string; end_date: string }[], today: string): RowWeek[] {
  const monday = currentMonday(today);
  const horizon = addDays(monday, 7 * WEEK_HORIZON_WEEKS);
  const weeks: RowWeek[] = stored.map((l) => ({ id: l.id, start: l.start_date, end: l.end_date, virtual: false, current: false }));
  const last = weeks.reduce((max, w) => (w.start > max ? w.start : max), monday);
  const until = addDays(last, 7) < horizon ? addDays(last, 7) : horizon;
  for (let m = monday; m <= until; m = addDays(m, 7)) {
    if (!weeks.some((w) => w.start <= m && m <= w.end)) weeks.push({ id: sprintIdFor(m), start: m, end: addDays(m, 4), virtual: true, current: false });
  }
  weeks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const day = today < monday ? monday : today;
  const current = weeks.find((w) => w.start <= day && day <= w.end);
  if (current) current.current = true;
  return weeks;
}
