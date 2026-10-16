import "server-only";

// Creating and deleting the lane of a week (src/lib/week-plan.ts has the rules). Lanes are the admin's to write
// (RLS, 0016), so these take the service-role client and are called only by the server, AFTER it has authorized
// the item that makes the week appear or empty (getItemAccess in actions/roadmap.ts, or the sync's own decision).
// Not a "use server" file: nothing here is an endpoint.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestLane, todayInSaoPaulo } from "@/lib/sprint-week";
import { weekFate, weekToCreate } from "@/lib/week-plan";

/**
 * The lane of the week `weekId` names, created when it is missing, and its id. Idempotent: two calls at once end
 * with one lane. Refused (throws "invalid_week") unless `weekId` is a real Monday's `sprint-DD-MM-AAAA`, not before
 * the current week (the current one passes) and within the 52-week horizon; the title and dates are derived from
 * the id, never taken from the caller. A sprint lane that already holds that Monday (a positional one, before
 * migration 0031) is the week, and its id is returned instead.
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

/**
 * Deletes a sprint lane when it holds no item, whatever its week (the rotation deletes the one that ended this way),
 * positional lanes included; never a group lane nor the e2e fixture. One call (migration 0030): the lane goes only
 * if it is still empty, never with an item in it. Answers whether it was deleted.
 */
export async function deleteWeekIfEmpty(admin: SupabaseClient, laneId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("delete_week_lane_if_empty", { p_lane_id: laneId });
  if (error) throw error;
  return data === true;
}

/**
 * Deletes a FUTURE week's lane (first day after the current week's Monday) when it holds no item: what a move, a
 * delete or a pull out of a week does once it has left it empty. The current week, an ended one, a group lane and
 * a lane with no dates are left alone. Answers whether it was deleted.
 */
export async function deleteFutureWeekIfEmpty(admin: SupabaseClient, laneId: string, now = new Date()): Promise<boolean> {
  const { data: lane, error } = await admin.from("lanes").select("kind, start_date").eq("id", laneId).maybeSingle();
  if (error) throw error;
  if (!lane || lane.kind !== "sprint" || !lane.start_date) return false;
  if (weekFate(lane.start_date, todayInSaoPaulo(now)) !== "future") return false;
  return deleteWeekIfEmpty(admin, laneId);
}
