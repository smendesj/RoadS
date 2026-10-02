"use server";

import { getLatestBoardSnapshot } from "@/lib/actions/sync";
import { withIssueStatus } from "@/lib/board";
import { createGeoCloudIssue } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { NEW_ITEM_TITLE, type Effort, type Lane, type Prioridade, type Produto, type RoadmapGroup, type RoadmapItem, type ViewAs } from "@/lib/types";

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
  created_by: string | null;
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
    createdBy: row.created_by,
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
    .select("id, lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, created_by, notes:item_notes(id, author_role, created_at, body)")
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

  // The sprints show which items are already delivered, from the same Project #7 snapshot the Dashboard reads.
  const snapshot = await getLatestBoardSnapshot();
  return { lanes: withIssueStatus(sprintLanes, snapshot?.columns ?? []), groups };
}

async function requireScrumMasterActor(): Promise<{ userId: string; realRole: "scrum_master" | "admin" }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");

  const { data: profile } = await supabase.from("profiles").select("role, must_reset_password").eq("id", user.id).single();
  if (profile?.must_reset_password) throw new Error("must_reset_password");
  if (profile?.role !== "scrum_master" && profile?.role !== "admin") throw new Error("forbidden");

  return { userId: user.id, realRole: profile.role };
}

async function queueChange(itemId: string | null, action: "add" | "modify" | "remove" | "move_lane", payload: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  await supabase.from("roadmap_sync_queue").insert({ item_id: itemId, action, payload });
}

export async function createRoadmapItem(laneId: string): Promise<RoadmapItem> {
  const { userId } = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("roadmap_items")
    .insert({
      lane_id: laneId,
      title: NEW_ITEM_TITLE,
      description: "Escreva aqui, em linguagem natural, o que precisa ser feito.",
      produto: "GeoCloud",
      prioridade: "Medium",
      effort: "Medium",
      created_by: userId,
    })
    .select("id, lane_id, title, description, produto, prioridade, effort, github_issue_url, created_by")
    .single();
  if (error) throw error;

  await queueChange(data.id, "add", { lane_id: laneId, title: data.title });

  return toRoadmapItem({ ...data, notes: [] });
}

// Who may change what on an item:
//   * admin — anything;
//   * scrum_master on their own item (created_by = them) — everything, delete included;
//   * scrum_master on a seeded item (created_by null) — prioridade/effort/nota/lane only;
//   * scrum_master on another user's item — nothing.
// RLS + triggers in 0007 enforce the same rules in the DB.
type ItemAccess = { canModify: boolean; canEditContent: boolean; canDelete: boolean };

async function getItemAccess(
  itemId: string,
  actor: { userId: string; realRole: "scrum_master" | "admin" }
): Promise<
  ItemAccess & { item: { lane_id: string; title: string; produto: Produto; description: string; github_issue_url: string | null } }
> {
  const supabase = await createServerSupabase();
  const { data: item, error } = await supabase
    .from("roadmap_items")
    .select("lane_id, title, produto, description, github_issue_url, created_by")
    .eq("id", itemId)
    .single();
  if (error) throw error;

  const isAdmin = actor.realRole === "admin";
  const isOwn = item.created_by === actor.userId;
  return {
    item,
    canModify: isAdmin || isOwn || item.created_by === null,
    canEditContent: isAdmin || isOwn,
    canDelete: isAdmin || isOwn,
  };
}

export async function saveRoadmapItemEdit(
  itemId: string,
  input: {
    prioridade: Prioridade;
    effort: Effort;
    note: string;
    activeView: ViewAs;
    content?: { title: string; description: string; produto: Produto };
  }
): Promise<void> {
  const actor = await requireScrumMasterActor();
  const { userId, realRole } = actor;
  const supabase = await createServerSupabase();

  const access = await getItemAccess(itemId, actor);
  if (!access.canModify || (input.content && !access.canEditContent)) throw new Error("forbidden");

  // An admin can legitimately post as either hat; a real scrum_master's note is pinned to
  // scrum_master regardless of what the client claims, so it can't be spoofed as a dev note.
  const authorRole = realRole === "admin" ? input.activeView : "scrum_master";

  const update: Record<string, unknown> = {
    prioridade: input.prioridade,
    effort: input.effort,
    updated_at: new Date().toISOString(),
  };

  if (input.content) {
    const title = input.content.title.trim();
    if (!title) throw new Error("title_required");
    update.title = title;
    update.description = input.content.description.trim();
    update.produto = input.content.produto;
  }

  const { error: updateError } = await supabase.from("roadmap_items").update(update).eq("id", itemId);
  if (updateError) throw updateError;

  if (input.note.trim()) {
    const { error: noteError } = await supabase
      .from("item_notes")
      .insert({ item_id: itemId, author_id: userId, author_role: authorRole, body: input.note.trim() });
    if (noteError) throw noteError;
  }

  const issue = await ensureIssue(itemId, {
    title: input.content ? (update.title as string) : access.item.title,
    description: input.content ? (update.description as string) : access.item.description,
    produto: input.content ? input.content.produto : access.item.produto,
    github_issue_url: access.item.github_issue_url,
  });

  await queueChange(itemId, "modify", {
    prioridade: input.prioridade,
    effort: input.effort,
    note: input.note.trim() || null,
    ...(input.content ? { title: update.title, description: update.description, produto: update.produto } : {}),
    ...(issue ? { github_issue_url: issue.url } : {}),
  });
}

// Every Roadmap item is a GitHub issue. A GeoCloud item saved without one (a "+ Novo item" once it
// has a real title) gets its issue here, Open on Project #7. A failure doesn't fail the save: the
// next board sync retries it. ELIMS has no issue destination configured yet, so it waits.
async function ensureIssue(
  itemId: string,
  item: { title: string; description: string; produto: Produto; github_issue_url: string | null }
): Promise<{ url: string; number: number } | null> {
  const token = process.env.GITHUB_TOKEN;
  if (item.github_issue_url || item.produto !== "GeoCloud" || item.title === NEW_ITEM_TITLE || !token) return null;
  try {
    const issue = await createGeoCloudIssue(token, item.title, item.description);
    // Linking is bookkeeping, not a content edit, so it goes through the admin client: the
    // actor was already authorized above, and the 0007 triggers limit what their own session may set.
    const { error } = await createAdminClient()
      .from("roadmap_items")
      .update({ github_issue_url: issue.url, github_issue_number: issue.number })
      .eq("id", itemId);
    if (error) throw error;
    return issue;
  } catch (e) {
    console.error("ensureIssue failed; the next sync retries", e);
    return null;
  }
}

export async function deleteRoadmapItem(itemId: string): Promise<void> {
  const actor = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const access = await getItemAccess(itemId, actor);
  if (!access.canDelete) throw new Error("forbidden");

  // Queued before the delete so the row still exists for the FK; item_id then goes null via
  // "on delete set null" and the payload keeps the id for FrontlightS.
  await queueChange(itemId, "remove", { item_id: itemId, lane_id: access.item.lane_id, title: access.item.title });

  const { data: deleted, error } = await supabase.from("roadmap_items").delete().eq("id", itemId).select("id");
  if (error) throw error;
  if (!deleted?.length) throw new Error("forbidden");
}

export async function moveRoadmapItemLane(itemId: string, targetLaneId: string): Promise<void> {
  const actor = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const access = await getItemAccess(itemId, actor);
  if (!access.canModify) throw new Error("forbidden");

  const { data: moved, error } = await supabase
    .from("roadmap_items")
    .update({ lane_id: targetLaneId, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select("id");
  if (error) throw error;
  if (!moved?.length) throw new Error("forbidden");

  await queueChange(itemId, "move_lane", { lane_id: targetLaneId });
}
