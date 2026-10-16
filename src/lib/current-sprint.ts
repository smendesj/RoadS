import "server-only";

// The lane of this week, read from the database: the rule is in src/lib/sprint-week.ts (the sprint lane whose dates
// hold today in São Paulo, whatever its id, so the positional lanes still in the database until migration 0031
// count too). Not a "use server" file: nothing here is an endpoint.

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentWeekLane, newWeekLane, todayInSaoPaulo, type WeekLaneRow } from "@/lib/sprint-week";

export type CurrentSprint = { id: string; start_date: string; end_date: string };

/** This week's lane, or null when there is none. Any client that may read lanes will do. */
export async function currentSprintLane(client: SupabaseClient, now = new Date()): Promise<CurrentSprint | null> {
  const { data, error } = await client.from("lanes").select("id, kind, start_date, end_date");
  if (error) throw error;
  return currentSprintIn((data ?? []) as WeekLaneRow[], now);
}

/** The same rule over lanes already read. */
export function currentSprintIn(lanes: WeekLaneRow[], now = new Date()): CurrentSprint | null {
  const lane = currentWeekLane(lanes, todayInSaoPaulo(now));
  return lane ? { id: lane.id, start_date: lane.start_date!, end_date: lane.end_date! } : null;
}

/**
 * This week's lane, created when it is missing, for something that must go into the current sprint. A new week
 * is named by its Monday (`sprint-DD-MM-AAAA`), never by its position. Lanes are the admin's to write (RLS), so
 * this takes the admin client and is called only by the server after it has decided the move. Two syncs creating
 * the same week at once end with one lane.
 */
export async function ensureCurrentSprintLane(admin: SupabaseClient, now = new Date()): Promise<string> {
  const found = await currentSprintLane(admin, now);
  if (found) return found.id;
  const lane = newWeekLane(todayInSaoPaulo(now));
  const { error } = await admin.from("lanes").upsert({ ...lane, sort_order: 0 }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  return lane.id;
}
