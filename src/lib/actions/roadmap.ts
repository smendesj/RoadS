"use server";

import { getLatestBoardSnapshot } from "@/lib/actions/sync";
import { withIssueStatus } from "@/lib/board";
import type { SyncColumn } from "@/lib/board-sync";
import { createGeoCloudIssue, readIssueLabels } from "@/lib/github";
import { isStack, isTipo, type NewIssueFields, type Stack, type Tipo } from "@/lib/issue-fields";
import { KANBAN, NEW_ITEM_LANE, unplanLane } from "@/lib/issue-lane";
import { moveLanePayload } from "@/lib/move-payload";
import { mayGetIssue } from "@/lib/test-data";
import { commentAuthorName } from "@/lib/comment-author";
import { currentSprintLane } from "@/lib/current-sprint";
import { sprintLanesByDate, todayInSaoPaulo, weekDates, weekLanes, weekTitle } from "@/lib/sprint-week";
import { weekRow } from "@/lib/week-plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { deleteFutureWeekIfEmpty, ensureWeekLane } from "@/lib/week-lanes";
import { nextOrderIn, planWeekDrop, writeWeekOrder } from "@/lib/week-order";
import { NEW_ITEM_TITLE, type Effort, type Lane, type Prioridade, type Produto, type RoadmapGroup, type RoadmapItem, type ViewAs } from "@/lib/types";

type ItemRow = {
  id: string;
  lane_id: string;
  title: string;
  description: string;
  produto: RoadmapItem["produto"];
  prioridade: Prioridade;
  effort: Effort;
  github_issue_url: string | null;
  tipo?: RoadmapItem["tipo"];
  stack?: string | null;
  created_by: string | null;
  created_at?: string;
  notes: {
    id: string;
    author_id: string | null;
    author_role: string | null;
    author_name: string | null;
    github_login: string | null;
    created_at: string;
    updated_at: string | null;
    deleted_at: string | null;
    body: string;
  }[];
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
    number: Number(row.github_issue_url?.match(/\/issues\/(\d+)/)?.[1]) || null,
    tipo: row.tipo ?? null,
    stack: row.stack ?? null,
    createdBy: row.created_by,
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    // A Comment deleted in RoadS is kept, hidden, until the sync deletes its comment on GitHub (comment-sync.ts).
    notes: row.notes
      .filter((n) => !n.deleted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => ({
        id: n.id,
        author: (n.author_role === "dev" ? "dev" : "scrum_master") as ViewAs,
        when: n.created_at.slice(5, 10).split("-").reverse().join("/"),
        text: n.body,
        authorId: n.author_id,
        authorName: n.author_name ?? n.github_login,
        edited: Boolean(n.updated_at),
      })),
  };
}

// The Roadmap: its weeks, the type lanes (where an item with no week sits: no screen shows them as such, they feed
// the Kanban's Open), and the Project #7 snapshot's columns with the ELIMS cards counted, which the Kanban is built
// from on the screen (src/lib/kanban.ts), so a card dragged to a week is labelled with it at once.
export async function getRoadmapBoard(): Promise<{ lanes: Lane[]; groups: RoadmapGroup[]; columns: SyncColumn[] }> {
  const supabase = await createServerSupabase();

  const { data: lanes, error: lanesError } = await supabase
    .from("lanes")
    .select("id, title, kind, start_date, end_date, sort_order")
    .order("sort_order");
  if (lanesError) throw lanesError;

  const { data: items, error: itemsError } = await supabase
    .from("roadmap_items")
    .select("id, lane_id, sort_order, title, description, produto, prioridade, effort, github_issue_url, tipo, stack, created_by, created_at, notes:item_notes(id, author_id, author_role, author_name, github_login, created_at, updated_at, deleted_at, body)")
    .order("sort_order")
    .order("id");
  if (itemsError) throw itemsError;

  const byLane = new Map<string, ItemRow[]>();
  for (const it of (items ?? []) as unknown as (ItemRow & { lane_id: string })[]) {
    const list = byLane.get(it.lane_id) ?? [];
    list.push(it);
    byLane.set(it.lane_id, list);
  }

  // The sprints are weeks (src/lib/sprint-week.ts), titled by their dates only: the row of src/lib/week-plan.ts, every
  // stored week and the ones from this week to the last stored one that the database lacks, plus one empty week at
  // the end (virtual: shown, not stored), in date order, with the one whose dates hold today in São Paulo marked as
  // the current one. The sprint lanes that are no week (the e2e fixture, a lane with no dates) come after them.
  const sprintRows = (lanes ?? []).filter((lane) => lane.kind === "sprint");
  const weeks = weekLanes(sprintRows);
  const row: Lane[] = weekRow(weeks, todayInSaoPaulo(new Date())).map((week) => ({
    id: week.id,
    title: weekTitle(week.start, week.end),
    dates: weekDates(week.start, week.end),
    start: week.start,
    current: week.current,
    ...(week.virtual ? { virtual: true } : {}),
    items: (byLane.get(week.id) ?? []).map(toRoadmapItem),
  }));
  const others: Lane[] = sprintLanesByDate(sprintRows.filter((lane) => !weeks.includes(lane))).map((lane) => ({
    id: lane.id,
    title: lane.start_date && lane.end_date ? weekTitle(lane.start_date, lane.end_date) : lane.title,
    dates: lane.start_date && lane.end_date ? weekDates(lane.start_date, lane.end_date) : "",
    ...(lane.start_date ? { start: lane.start_date } : {}),
    current: false,
    items: (byLane.get(lane.id) ?? []).map(toRoadmapItem),
  }));
  const sprintLanes = [...row, ...others];
  const groups: RoadmapGroup[] = (lanes ?? [])
    .filter((lane) => lane.kind !== "sprint")
    .map((lane) => ({ id: lane.id, title: lane.title, items: (byLane.get(lane.id) ?? []).map(toRoadmapItem) }));

  // The sprints show which items are already delivered, from the same Project #7 snapshot the Kanban and the Dashboard read.
  const snapshot = await getLatestBoardSnapshot();
  const columns = snapshot?.columns ?? [];
  return { lanes: withIssueStatus(sprintLanes, columns), groups, columns };
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

// "+ Novo item", in the Kanban's Open: the one place an item is born, with no week, in a type lane (NEW_ITEM_LANE). The
// lane is the server's to choose, never the caller's; planning it is dragging it to a week afterwards.
export async function createRoadmapItem(): Promise<RoadmapItem> {
  const { userId } = await requireScrumMasterActor();
  const supabase = await createServerSupabase();

  const laneId = NEW_ITEM_LANE;
  const sortOrder = await nextOrderIn(supabase, laneId);
  const { data, error } = await supabase
    .from("roadmap_items")
    .insert({
      lane_id: laneId,
      sort_order: sortOrder,
      title: NEW_ITEM_TITLE,
      description: "Escreva aqui, em linguagem natural, o que precisa ser feito.",
      produto: "GeoCloud",
      prioridade: "Medium",
      effort: "Medium",
      created_by: userId,
    })
    .select("id, lane_id, title, description, produto, prioridade, effort, github_issue_url, tipo, stack, created_by, created_at")
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
  ItemAccess & {
    item: {
      lane_id: string;
      title: string;
      produto: Produto;
      description: string;
      github_issue_url: string | null;
      tipo: Tipo | null;
      stack: Stack | null;
      field_changed_at: Record<string, string> | null;
    };
  }
> {
  const supabase = await createServerSupabase();
  const { data: item, error } = await supabase
    .from("roadmap_items")
    .select("lane_id, title, produto, description, github_issue_url, tipo, stack, created_by, field_changed_at")
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
    content?: { title: string; description: string; produto: Produto; tipo: Tipo; stack: Stack };
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
    // When each field was last edited here: the two-way sync settles a field both sides changed by these times.
    const changedAt = { ...(access.item.field_changed_at ?? {}) };
    const now = update.updated_at as string;
    if (title !== access.item.title) changedAt.title = now;
    if (update.description !== access.item.description) changedAt.description = now;
    update.field_changed_at = changedAt;
    update.produto = input.content.produto;
    if (!isTipo(input.content.tipo) || !isStack(input.content.stack)) throw new Error("type_and_stack_required");
    update.tipo = input.content.tipo;
    update.stack = input.content.stack;
  }

  const { error: updateError } = await supabase.from("roadmap_items").update(update).eq("id", itemId);
  if (updateError) throw updateError;

  if (input.note.trim()) {
    // The name the Comment is signed with when the sync writes it on the issue (comment-sync.ts).
    const { data: author } = await supabase.auth.getUser();
    const { error: noteError } = await supabase.from("item_notes").insert({
      item_id: itemId,
      author_id: userId,
      author_role: authorRole,
      author_name: commentAuthorName(author.user, realRole),
      body: input.note.trim(),
    });
    if (noteError) throw noteError;
  }

  // Born in the current week, the issue is Development on the Project from the start (Open when that can't be read).
  const current = await currentSprintLane(supabase).catch(() => null);
  const issue = await ensureIssue(
    itemId,
    {
      title: input.content ? (update.title as string) : access.item.title,
      description: input.content ? (update.description as string) : access.item.description,
      github_issue_url: access.item.github_issue_url,
      prioridade: input.prioridade,
      effort: input.effort,
      tipo: input.content ? input.content.tipo : access.item.tipo ?? "feature",
      stack: input.content ? input.content.stack : access.item.stack ?? "Geral",
    },
    access.item.lane_id === current?.id ? "Development" : "Open"
  );

  await queueChange(itemId, "modify", {
    prioridade: input.prioridade,
    effort: input.effort,
    note: input.note.trim() || null,
    ...(input.content ? { title: update.title, description: update.description, produto: update.produto, tipo: update.tipo, stack: update.stack } : {}),
    ...(issue ? { github_issue_url: issue.url } : {}),
  });
}

// Every Roadmap item is a GitHub issue. A GeoCloud item saved without one (a "+ Novo item" once it
// has a real title) gets its issue here, Open on Project #7 (Development if it is in the current sprint); test data
// (src/lib/test-data.ts) never does. A failure doesn't fail the save: the
// next board sync retries it.
async function ensureIssue(
  itemId: string,
  item: NewIssueFields & { github_issue_url: string | null },
  status: "Open" | "Development"
): Promise<{ url: string; number: number } | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!mayGetIssue(item) || !token) return null;
  try {
    const issue = await createGeoCloudIssue(token, item, status);
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

  await dropFutureWeekIfEmpty(access.item.lane_id);
}

// A future week that an authorized move or delete has just left empty stops existing (src/lib/week-lanes.ts). The
// item's change is already saved, so a failure here doesn't undo it: the week stays, empty, until it empties again.
async function dropFutureWeekIfEmpty(laneId: string) {
  try {
    await deleteFutureWeekIfEmpty(createAdminClient(), laneId);
  } catch (e) {
    console.error("deleteFutureWeekIfEmpty failed; the empty week stays", e);
  }
}

// Dropped on a card of a week (`beforeId`), the item goes right before it, also within the week it is already in;
// anywhere else in a week ("Mover para" too), last. Its own number is written under the actor's session (the RLS of
// 0007 is the backstop); the neighbours it renumbers may be anyone's, so the server writes them with the service role,
// only now that the item is known to be the actor's to move (src/lib/week-order.ts). A group keeps its own order.
// Dropped on the Kanban (KANBAN), the item is unplanned into a type lane the server picks (unplanItem).
export async function moveRoadmapItemLane(itemId: string, targetLaneId: string, beforeId: string | null = null): Promise<void> {
  const actor = await requireScrumMasterActor();
  if (beforeId !== null && typeof beforeId !== "string") throw new Error("invalid_before");
  const supabase = await createServerSupabase();

  const access = await getItemAccess(itemId, actor);
  if (!access.canModify) throw new Error("forbidden");

  // Dropped on the Kanban: the item leaves its week for a type lane the server picks.
  if (targetLaneId === KANBAN) {
    if (beforeId !== null) throw new Error("invalid_before");
    return unplanItem(itemId, access.item);
  }

  // Dropped on a week the database doesn't have yet (the empty one at the end of the row, or a gap): the server
  // creates its lane, only now that the item is known to be the actor's to move, with the service role (lanes are
  // the admin's to write). The id is checked there: a real Monday, not before this week, within the horizon.
  const { data: existing, error: laneError } = await supabase.from("lanes").select("id, kind").eq("id", targetLaneId).maybeSingle();
  if (laneError) throw laneError;
  // The card to go before is an item of the target week: never one of a group, nor of a week not created yet.
  if (beforeId !== null && existing?.kind !== "sprint") throw new Error("invalid_before");
  const from = access.item.lane_id;
  const isWeek = !existing || existing.kind === "sprint";
  if (!isWeek && from === existing.id) return;
  const admin = createAdminClient();
  const created = existing ? null : await ensureWeekLane(admin, targetLaneId);
  const to = existing?.id ?? created!;
  const undoCreate = async () => {
    if (created) await deleteFutureWeekIfEmpty(admin, created).catch(() => {});
  };

  const place = isWeek ? await planWeekDrop(admin, to, itemId, beforeId) : null;
  if (isWeek && !place) {
    await undoCreate();
    throw new Error("invalid_before");
  }
  if (from === to && place?.unchanged) return;

  const { data: moved, error } = await supabase
    .from("roadmap_items")
    .update({ lane_id: to, ...(place ? { sort_order: place.sortOrder } : {}), updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select("id");
  if (error || !moved?.length) {
    await undoCreate();
    if (error) throw error;
    throw new Error("forbidden");
  }
  if (place?.neighbors.length) await writeWeekOrder(admin, place.neighbors);

  // A new order within the same week queues nothing: roadmap-state's `position` carries it.
  if (from === to) return;

  // Both lanes, like every other move_lane: Frontlights writes the departure into the sprint the item left.
  await queueChange(itemId, "move_lane", moveLanePayload({ from, to, title: access.item.title, origin: "app" }));

  // The future week it left, now empty, stops existing; the current week stays even when empty.
  await dropFutureWeekIfEmpty(from);
}

const GEOCLOUD_ISSUE = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;

// Unplanning: a card dropped from a week on the Kanban. Called only after getItemAccess said the item is the actor's to
// move. The item goes to the type lane of its issue's type label (read from GitHub now; with no token, or when the read
// fails, there is none), else of the type it is stored with, else where "+ Novo item" puts one (unplanLane in
// src/lib/issue-lane.ts, the rule the sync releases an item by). The server picks it, never the caller. An item already
// in no week stays. Queued like any move, with both lanes; the future week it left, now empty, goes. Leaving the
// current week, the Project goes back to Open through the sprint sync (only with its write switch on); leaving a week
// to come, nothing changes on the Project.
async function unplanItem(itemId: string, item: { lane_id: string; title: string; github_issue_url: string | null; tipo: Tipo | null }): Promise<void> {
  const supabase = await createServerSupabase();
  const { data: lanes, error: lanesError } = await supabase.from("lanes").select("id, kind");
  if (lanesError) throw lanesError;
  const from = item.lane_id;
  if ((lanes ?? []).find((l) => l.id === from)?.kind !== "sprint") return;

  const number = Number(item.github_issue_url?.match(GEOCLOUD_ISSUE)?.[1]) || null;
  const token = process.env.GITHUB_TOKEN;
  const labels =
    token && number
      ? await readIssueLabels(token, number).catch((e) => {
          console.error("readIssueLabels failed; unplanning by the stored type", e);
          return [];
        })
      : [];
  const to = unplanLane(labels, item.tipo, new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id)));
  // A type lane keeps its items by issue number, the way the sync files them; an item with no issue goes last.
  const sortOrder = number ?? (await nextOrderIn(supabase, to));

  const { data: moved, error } = await supabase
    .from("roadmap_items")
    .update({ lane_id: to, sort_order: sortOrder, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("lane_id", from)
    .select("id");
  if (error) throw error;
  if (!moved?.length) throw new Error("forbidden");

  await queueChange(itemId, "move_lane", moveLanePayload({ from, to, title: item.title, origin: "app" }));
  await dropFutureWeekIfEmpty(from);
}
