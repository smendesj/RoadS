"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Effort, Lane, Prioridade, RoadmapGroup, RoadmapItem, ViewAs } from "@/lib/types";

function formatDateRange(start: string, end: string): string {
  const [, sm, sd] = start.split("-");
  const [, em, ed] = end.split("-");
  return sm === em ? `${sd}–${ed}/${em}` : `${sd}/${sm}–${ed}/${em}`;
}

type ItemRow = {
  id: string;
  lane_id: string;
  title: string;
  description: string;
  produto: RoadmapItem["produto"];
  prioridade: Prioridade;
  effort: Effort;
  github_issue_url: string | null;
  notes: { id: string; author_role: string; created_at: string; body: string }[];
};

function toRoadmapItem(row: ItemRow): RoadmapItem {
  return {
    id: row.id,
    title: row.title,
    produto: row.produto,
    prioridade: row.prioridade,
    effort: row.effort,
    desc: row.description,
    url: row.github_issue_url,
    notes: row.notes
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => ({
        id: n.id,
        author: (n.author_role === "scrum_master" ? "scrum_master" : "dev") as ViewAs,
        when: n.created_at.slice(5, 10).split("-").reverse().join("/"),
        text: n.body,
      })),
  };
}

export async function getRoadmapBoard(): Promise<{ lanes: Lane[]; groups: RoadmapGroup[] }> {
  const supabase = await createServerSupabase();

  const { data: lanes, error: lanesError } = await supabase
    .from("lanes")
    .select("id, title, kind, start_date, end_date, sort_order")
    .order("sort_order");
  if (lanesError) throw lanesError;

  const { data: items, error: itemsError } = await supabase
    .from("roadmap_items")
    .select("id, lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, notes:item_notes(id, author_role, created_at, body)")
    .order("sort_order");
  if (itemsError) throw itemsError;

  const byLane = new Map<string, ItemRow[]>();
  for (const it of (items ?? []) as unknown as (ItemRow & { lane_id: string })[]) {
    const list = byLane.get(it.lane_id) ?? [];
    list.push(it);
    byLane.set(it.lane_id, list);
  }

  const sprintLanes: Lane[] = [];
  const groups: RoadmapGroup[] = [];
  for (const lane of lanes ?? []) {
    const laneItems = (byLane.get(lane.id) ?? []).map(toRoadmapItem);
    if (lane.kind === "sprint") {
      sprintLanes.push({
        id: lane.id,
        title: lane.title,
        dates: lane.start_date && lane.end_date ? formatDateRange(lane.start_date, lane.end_date) : "",
        items: laneItems,
      });
    } else {
      groups.push({ id: lane.id, title: lane.title, items: laneItems });
    }
  }

  return { lanes: sprintLanes, groups };
}

async function requireScrumMasterActor(): Promise<{ userId: string; realRole: "scrum_master" | "admin" }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "scrum_master" && profile?.role !== "admin") throw new Error("forbidden");

  return { userId: user.id, realRole: profile.role };
}

async function queueChange(itemId: string | null, action: "add" | "modify" | "remove" | "move_lane", payload: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  await supabase.from("guardians_sync_queue").insert({ item_id: itemId, action, payload });
}

export async function createRoadmapItem(laneId: string): Promise<RoadmapItem> {
  const { userId } = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("roadmap_items")
    .insert({
      lane_id: laneId,
      title: "Novo item — edite a descrição",
      description: "Escreva aqui, em linguagem natural, o que precisa ser feito.",
      produto: "GeoCloud",
      prioridade: "Medium",
      effort: "Medium",
      created_by: userId,
    })
    .select("id, lane_id, title, description, produto, prioridade, effort, github_issue_url")
    .single();
  if (error) throw error;

  await queueChange(data.id, "add", { lane_id: laneId, title: data.title });

  return toRoadmapItem({ ...data, notes: [] });
}

export async function saveRoadmapItemEdit(
  itemId: string,
  input: { prioridade: Prioridade; effort: Effort; note: string; activeView: ViewAs }
): Promise<void> {
  const { userId, realRole } = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  // An admin can legitimately post as either hat; a real scrum_master's note is pinned to
  // scrum_master regardless of what the client claims, so it can't be spoofed as a dev note.
  const authorRole = realRole === "admin" ? input.activeView : "scrum_master";

  const { error: updateError } = await supabase
    .from("roadmap_items")
    .update({ prioridade: input.prioridade, effort: input.effort, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (updateError) throw updateError;

  if (input.note.trim()) {
    const { error: noteError } = await supabase
      .from("item_notes")
      .insert({ item_id: itemId, author_id: userId, author_role: authorRole, body: input.note.trim() });
    if (noteError) throw noteError;
  }

  await queueChange(itemId, "modify", { prioridade: input.prioridade, effort: input.effort, note: input.note.trim() || null });
}

export async function moveRoadmapItemLane(itemId: string, targetLaneId: string): Promise<void> {
  await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from("roadmap_items")
    .update({ lane_id: targetLaneId, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;

  await queueChange(itemId, "move_lane", { lane_id: targetLaneId });
}
