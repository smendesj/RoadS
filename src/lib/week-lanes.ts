import "server-only";

// Creating and deleting the lane of a week (src/lib/week-plan.ts has the rules). Lanes are the admin's to write
// (RLS, 0016), so these take the service-role client and are called only by the server, AFTER it has authorized
// the item that makes the week appear or empty (getItemAccess in actions/roadmap.ts, or the sync's own decision).
// Not a "use server" file: nothing here is an endpoint.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestLane, todayInSaoPaulo } from "@/lib/sprint-week";
import { weekFate, weekToCreate } from "@/lib/week-plan";

/**
 * The lane of the week `weekId` names, created when it is missing, and its id. Refused (throws "invalid_week")
 * unless `weekId` is a real Monday's `sprint-DD-MM-AAAA`, not before the current week and within the horizon; the
 * title and dates are derived from the id. A sprint lane that already holds that Monday (a positional one, before
 * migration 0030) is the week, and its id is returned instead. Two calls at once end with one lane.
 */
export async function ensureWeekLane(admin: SupabaseClient, weekId: string, now = new Date()): Promise<string> {
  const plan = weekToCreate(weekId, todayInSaoPaulo(now));
  if (!plan.ok) throw new Error("invalid_week");
  const { lane } = plan;

  const { data: holding, error: readError } = await admin
    .from("lanes")
    .select("id")
    .eq("kind", "sprint")
    .lte("start_date", lane.start_date)
    .gte("end_date", lane.start_date);
  if (readError) throw readError;
  const found = (holding ?? []).find((l) => !isTestLane(l.id));
  if (found) return found.id;

  const { error } = await admin.from("lanes").upsert({ ...lane, sort_order: 0 }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  return lane.id;
}

/** Deletes a FUTURE week's lane when it holds no item; the current week and any other lane are left alone. */
export async function deleteWeekIfEmpty(admin: SupabaseClient, weekId: string, now = new Date()): Promise<boolean> {
  if (weekFate(weekId, todayInSaoPaulo(now)) !== "future") return false;
  return deleteIfEmpty(admin, weekId);
}

/** Deletes a week's lane that has ENDED when it holds no item (the rotation, once it has emptied it). */
export async function deleteEndedWeekIfEmpty(admin: SupabaseClient, weekId: string, now = new Date()): Promise<boolean> {
  if (weekFate(weekId, todayInSaoPaulo(now)) !== "ended") return false;
  return deleteIfEmpty(admin, weekId);
}

// One call (migration 0031): the lane goes only if it is still a week and still empty, never with an item in it.
async function deleteIfEmpty(admin: SupabaseClient, weekId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("delete_week_lane_if_empty", { p_lane_id: weekId });
  if (error) throw error;
  return data === true;
}
