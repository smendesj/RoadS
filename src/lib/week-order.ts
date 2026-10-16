import "server-only";

// The order of the items in a week (roadmap_items.sort_order), as the Roadmap's week, the Dashboard's Sprint block
// and roadmap-state's `position` all read it. A drop places an item before a card or last (dropOrder in
// src/lib/roadmap-move.ts has the rule); the neighbours it renumbers may belong to anyone, so they are written with
// the service-role client, and only by the server AFTER it has authorized the item being dropped (getItemAccess in
// actions/roadmap.ts). Not a "use server" file: nothing here is an endpoint.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dropOrder } from "@/lib/roadmap-move";

export type WeekDrop = { sortOrder: number; neighbors: { id: string; sortOrder: number }[]; unchanged: boolean };

/**
 * Where `itemId` goes in the week `laneId`: before the item `beforeId` of that week, or last when it is null. Null
 * when `beforeId` is not an item of the week (or is the item itself). `unchanged` says the item is already in that
 * week, at that place, with nothing around it to renumber.
 */
export async function planWeekDrop(admin: SupabaseClient, laneId: string, itemId: string, beforeId: string | null): Promise<WeekDrop | null> {
  const { data, error } = await admin.from("roadmap_items").select("id, sort_order").eq("lane_id", laneId).order("sort_order").order("id");
  if (error) throw error;
  const items = (data ?? []).map((row) => ({ id: row.id as string, sortOrder: row.sort_order as number }));
  const plan = dropOrder(items, itemId, beforeId);
  if (!plan) return null;
  const stored = items.find((it) => it.id === itemId);
  return { ...plan, unchanged: !!stored && stored.sortOrder === plan.sortOrder && plan.neighbors.length === 0 };
}

/** Writes the neighbours' new numbers (the dropped item itself is written by the caller, under its own session). */
export async function writeWeekOrder(admin: SupabaseClient, neighbors: { id: string; sortOrder: number }[]): Promise<void> {
  const results = await Promise.all(neighbors.map((n) => admin.from("roadmap_items").update({ sort_order: n.sortOrder }).eq("id", n.id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/** The number that puts a new item last in a lane: one past the highest there, 0 in an empty lane. */
export async function nextOrderIn(client: SupabaseClient, laneId: string): Promise<number> {
  const { data, error } = await client.from("roadmap_items").select("sort_order").eq("lane_id", laneId).order("sort_order", { ascending: false }).limit(1);
  if (error) throw error;
  return ((data?.[0]?.sort_order as number | undefined) ?? -1) + 1;
}
