import "server-only";

// Live sync for the Roadmap's Kanban (Open and Done) and the Dashboard's Sprint block, pulled straight from
// Essencis-Labs GitHub Project #7's "Status" field (Open/Development/Blocker/Done). The same
// sync also keeps the Roadmap in step with the repo's open issues (reconcileRoadmapWithIssues).
// Requires GITHUB_TOKEN (server-only) — a classic PAT with `repo`+`read:org`+`project`,
// generated from an account that's actually a member of the Essencis-Labs org (a
// fine-grained PAT from the wrong account reads back as "no_access", not an error).
// Without a token at all, this reports "not_configured" instead of faking success.
//
// Each column lists its cards in the order of the Project's "Kanban" view (kanbanSort in board.ts), each card with
// when its Status last changed (the Roadmap's Done shows the last 14 days of it), and counts the ELIMS cards it
// leaves out, so the Roadmap can say why its totals are smaller than GitHub's.
//
// Runs from two places: the Dashboard and the Roadmap (via syncBoardAsViewer in actions/sync.ts, which checks
// the caller has a real session first): their buttons, the pages keeping themselves in step on their own, and a
// move into or out of the current sprint (src/lib/auto-sync.ts has when and the brakes); and
// the daily cron route (src/app/api/cron/sync-board, gated on CRON_SECRET
// instead — there's no user session in a cron invocation). Both funnel through
// syncBoard(), which also persists the result to board_sync_state so a page
// reload — or a visitor who never clicks the button — still sees the last real
// sync instead of always falling back to mock data.
//
// The same sync keeps the Roadmap's current sprint and the Project's Development telling the same story
// (src/lib/sprint-status-sync.ts): the Project moving an issue moves it in the Roadmap, and the Roadmap
// moving one writes its Status on the Project, when the sync is run by someone who pushes (a scrum master, an admin,
// the cron or FrontlightS; a dev's sync reports what it would write). The Roadmap's own moves are queued with origin "project" so FrontlightS writes them too.
//
// This is deliberately NOT a "use server" file: everything exported from one of those is an HTTP
// endpoint any signed-in user can call directly, and syncBoard authorizes nobody (the cron has no
// session) and writes with the admin client.

import { createGeoCloudIssue, EFFORT_FIELD_ID, GEOCLOUD_REPO, PRIORIDADE_FIELD_ID, clearProjectField, readBoardFields, readIssueChangeTimes, readIssueState, setProjectDate, setProjectOption, setProjectStatus, STACK_FIELD_ID, updateIssue, type IssueChange, type IssueChangeTimes } from "@/lib/github";
import { importableIssues, isTestData, mayGetIssue } from "@/lib/test-data";
import { decideField, extractSolucao, labelsAfter, sameBase, nativeTypeOf, replaceSolucao, statusOfIssue, statusWrites, tipoOfLabels, weekOfIssue, weekOfLane, weekPull, type ItemStatus, type LabelledField } from "@/lib/bilateral-sync";
import { syncItemComments, type CommentsSummary } from "@/lib/comments-sync";
import { syncItemAssignees, type AssigneesSummary } from "@/lib/assignees-sync";
import { BOARD_REPO, boardCard, kanbanSort, otherRepoCounts, projectCard, sortCards, withStatusWrites, type BoardCard, type BoardStatus, type ProjectCard, type SortableCard, type SortKey } from "@/lib/board";
import { isEffort, isStack, isTipo, PRIORIDADE_OPTION_IDS, prioridadeOfOption, STACK_OPTION_IDS, stackOfOption, type Stack } from "@/lib/issue-fields";
import type { Prioridade } from "@/lib/types";
import { laneForLabels, releaseLane, tipoForLabels, TYPE_LANES } from "@/lib/issue-lane";
import { moveLanePayload } from "@/lib/move-payload";
import { planRotation, rotationIsIdle } from "@/lib/sprint-rotation";
import { sprintIdFor, todayInSaoPaulo, weekLanes } from "@/lib/sprint-week";
import { parseSlices, slicesQuery } from "@/lib/slices";
import { removeClosedBeforeTheirWeek as runClosedRemoval, type ClosedRemovalDeps } from "@/lib/closed-before-week";
import { currentSprintIn, currentSprintLane, ensureCurrentSprintLane } from "@/lib/current-sprint";
import { EMPTY_SPRINT_SUMMARY, runSprintSync, type SprintCandidate, type SprintSyncDeps, type SprintSyncSummary } from "@/lib/sprint-status-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteFutureWeekIfEmpty, deleteWeekIfEmpty, ensureWeekLane } from "@/lib/week-lanes";
import { brakedSync } from "@/lib/sync-claim";
import { SYNC_FAILED } from "@/lib/sync-message";
import { inPool } from "@/lib/pool";
import { SYNC_COOLDOWN_MS, SYNC_MAX_DURATION_S } from "@/lib/sync-cooldown";

const STATUS_META: Record<string, { key: string; tone: "neutral" | "brand" | "red" | "green" }> = {
  Open: { key: "open", tone: "neutral" },
  Development: { key: "dev", tone: "brand" },
  Blocker: { key: "blocker", tone: "red" },
  Done: { key: "done", tone: "green" },
};

export type SyncColumn = {
  key: string;
  title: string;
  tone: "neutral" | "brand" | "red" | "green";
  count: number;
  /** Each card with `statusAt`, when its Status last changed on the Project (absent in a snapshot older than 16/10/2026). */
  items: BoardCard[];
  /** Cards of this Status on Project #7 from other repositories (ELIMS), which the board never shows: only counted. */
  elims?: number;
};

export type RoadmapReconcile = {
  added: number;
  removed: number;
  issuesCreated: number;
  untyped?: number;
  error?: string;
  /** What the current sprint and the Project's Development did for each other; absent when there was no card to judge. */
  sprint?: SprintSyncSummary;
  /** How many Roadmap titles followed a rename of their issue on GitHub. */
  retitled?: number;
  /** The two-way sync of Title and Description: values brought in, written to GitHub and failed; absent when none. */
  fields?: FieldsSummary;
  /** The two-way sync of Comments (issue #23): brought in, written to GitHub and failed; absent when none. */
  comments?: CommentsSummary;
  /** The two-way sync of Assignees (issue #23): brought in, written to GitHub and failed; absent when none. */
  assignees?: AssigneesSummary;
};

export type FieldsSummary = { pulled: number; pushed: number; failed: number; error?: string };

export type SyncResult =
  | { ok: true; columns: SyncColumn[]; syncedAt: string; roadmap: RoadmapReconcile; /** The brake answered with the last snapshot: nothing was read from GitHub, and it lets go in `retryInMs`. */ cached?: true; retryInMs?: number }
  | { ok: false; reason: "not_configured" | "no_access" | "unauthenticated" | "error"; message?: string };

const QUERY = `
  query($after: String) {
    organization(login: "Essencis-Labs") {
      projectV2(number: 7) {
        views(first: 20) { nodes { name sortByFields(first: 5) { nodes { direction field { ... on ProjectV2FieldCommon { name } } } } } }
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { ... on Issue { number title url createdAt updatedAt repository { nameWithOwner } } }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }
            }
            fieldValues(first: 30) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { optionId updatedAt field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldDateValue { date updatedAt field { ... on ProjectV2FieldCommon { id } } }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * A claimed run that hasn't finished after this long is taken as stuck (a function killed by its timeout): the same
 * as SYNC_MAX_DURATION_S, the maxDuration of every route and page that syncs, so a run still alive is never taken as
 * stuck and run twice.
 */
const MAX_RUN_MS = SYNC_MAX_DURATION_S * 1000;

// The one door to the sync, for every caller: the brake and the claim of src/lib/sync-claim.ts in front of the run.
// `brakeMs` is the caller's brake: 30 s for a press, FrontlightS and the cron; 5 min for a page's own sync.
// `push`: whether this run may write RoadS edits to GitHub (src/lib/bilateral-sync.ts, mayPush): the cron and
// FrontlightS do, a press does when the one pressing is a scrum master or an admin; otherwise the run only pulls.
export async function syncBoard({ brakeMs = SYNC_COOLDOWN_MS, push = true }: { brakeMs?: number; push?: boolean } = {}): Promise<SyncResult> {
  // Lazily, inside the catch below: a server without the service key answers { ok: false } instead of throwing.
  let client: ReturnType<typeof createAdminClient> | null = null;
  const admin = () => (client ??= createAdminClient());
  return brakedSync(
    {
      now: () => Date.now(),
      configured: () => Boolean(process.env.GITHUB_TOKEN),
      latestSnapshot: async () => {
        const { data } = await admin().from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
        return data ? { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string } : null;
      },
      claim: async (ms) => {
        const { data, error } = await admin().rpc("claim_board_sync", { p_brake_ms: ms, p_max_run_ms: MAX_RUN_MS });
        if (error) throw error;
        const row = (data as { claimed: boolean; claimed_at: string | null }[] | null)?.[0];
        return { claimed: row?.claimed ?? false, claimedAt: row?.claimed_at ?? null };
      },
      finish: async (claimedAt) => {
        const { error } = await admin().rpc("finish_board_sync", { p_claimed_at: claimedAt });
        if (error) throw error;
      },
      run: () => runBoardSync({ push }),
    },
    { brakeMs }
  ).catch((e): SyncResult => ({ ok: false, reason: "error", message: e instanceof Error ? e.message : SYNC_FAILED }));
}

async function runBoardSync({ push }: { push: boolean }): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: "not_configured" };

  const onProject = new Set<number>();
  const cards = new Map<number, ProjectCard>();
  const counts = new Map<string, number>();
  const itemsByStatus = new Map<string, SortableCard[]>();
  const byUrl = new Map<string, SortableCard>();
  const elims = new Map<BoardStatus, number>();
  let sort: SortKey[] = [];

  try {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: Response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { after } }),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, reason: "error", message: `GitHub answered ${res.status}` };

      const json = await res.json();
      if (json.errors?.length) return { ok: false, reason: "error", message: json.errors[0].message };

      const project = json.data?.organization?.projectV2;
      if (!project) {
        return {
          ok: false,
          reason: "no_access",
          message: "The token cannot see Project #7 — create a classic PAT (not fine-grained) with the repo, read:org and project scopes, from an account that is a member of the Essencis-Labs org.",
        };
      }

      // The order of the Kanban view on GitHub, so the Roadmap's Kanban lists each column the same way.
      if (page === 0) sort = kanbanSort(project.views?.nodes);
      for (const [status, n] of otherRepoCounts(project.items.nodes)) elims.set(status, (elims.get(status) ?? 0) + n);

      const items = project.items;
      for (const node of items.nodes) {
        // On the project whatever its Status; an issue taken off the project leaves the Roadmap too.
        if (node.content?.number && node.content.repository?.nameWithOwner === BOARD_REPO) onProject.add(node.content.number);
        const card = projectCard(node);
        if (card) cards.set(card.number, card);
        const entry = boardCard(node);
        if (!entry) continue;
        counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
        const list = itemsByStatus.get(entry.status) ?? [];
        const sortable = { card: entry.card, createdAt: node.content.createdAt ?? "", updatedAt: node.content.updatedAt ?? "" };
        list.push(sortable);
        byUrl.set(entry.card.url, sortable);
        itemsByStatus.set(entry.status, list);
      }

      if (!items.pageInfo.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }

    let columns: SyncColumn[] = Object.entries(STATUS_META).map(([title, meta]) => ({
      key: meta.key,
      title,
      tone: meta.tone,
      count: counts.get(title) ?? 0,
      items: sortCards(itemsByStatus.get(title) ?? [], sort),
      elims: elims.get(title as BoardStatus) ?? 0,
    }));
    const syncedAt = new Date().toISOString();

    // A week that is over hands what is left of it to today's week; a failure doesn't fail the sync.
    const doneUrls = new Set(columns.find((c) => c.key === "done")?.items.map((i) => i.url));
    await rotateSprints(doneUrls).catch((e) => console.error("syncBoard: sprint rotation failed", e));

    // The open issues on the project, read once for the two steps below (and only if one of them asks).
    let openRead: Promise<OpenIssue[]> | null = null;
    const readOpen = () => (openRead ??= fetchOpenIssues(token).then((list) => list.filter((i) => onProject.has(i.number))));

    // The current sprint and the Project's Development follow each other. A failure here doesn't fail the sync.
    let sprint: SprintSyncSummary | undefined;
    if (cards.size) {
      try {
        const run = await syncSprintWithProject(token, cards, await readOpen(), push);
        sprint = run.summary;
        // What was written to the Project shows on the Roadmap and the Dashboard now, not only after the next sync.
        // A card moved by a write takes its place by the view's sort (with no sort, it stays last: GitHub's manual order
        // can't be known for it until the next sync).
        columns = withStatusWrites(columns, run.written).map((c) => ({
          ...c,
          items: sortCards(c.items.map((i) => byUrl.get(i.url) ?? { card: i, createdAt: "", updatedAt: "" }), sort),
        }));
      } catch (e) {
        console.error("syncBoard: sprint and project sync failed", e);
        sprint = { ...EMPTY_SPRINT_SUMMARY, error: e instanceof Error ? e.message : "Failed to align the current sprint with the Project." };
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("board_sync_state").upsert({ id: true, columns, synced_at: syncedAt });
    } catch (persistError) {
      console.error("syncBoard: failed to persist snapshot", persistError);
    }

    // Each item's fields go both ways with its issue (syncIssueFields); a failure here doesn't fail the board sync.
    const fields: (FieldsSummary & { retitled?: number }) | null = cards.size
      ? await readOpen()
          .then((open) => syncIssueFields(token, open, push, cards))
          .catch((e) => {
            console.error("syncBoard: two-way fields failed", e);
            return { pulled: 0, pushed: 0, failed: 0, error: e instanceof Error ? e.message : "Failed to sync the issue fields." };
          })
      : null;
    const retitled = fields?.retitled ?? 0;

    // The Comments of each item go both ways with its issue's comments (comments-sync.ts, issue #23); a failure here
    // doesn't fail the board sync.
    const comments: CommentsSummary | null = cards.size
      ? await readOpen()
          .then((open) => syncItemComments(token, open.map((i) => i.number), push))
          .catch((e) => {
            console.error("syncBoard: Comments failed", e);
            return { pulled: 0, pushed: 0, failed: 0, error: e instanceof Error ? e.message : "Failed to sync the Comments." };
          })
      : null;
    const commentCounts = comments && (comments.pulled || comments.pushed || comments.failed || comments.error) ? comments : null;

    // The Assignees of each item go both ways with its issue's (assignees-sync.ts, issue #23); a failure here doesn't
    // fail the board sync.
    const assignees: AssigneesSummary | null = cards.size
      ? await readOpen()
          .then((open) => syncItemAssignees(token, open.map((i) => i.number), push))
          .catch((e) => {
            console.error("syncBoard: Assignees failed", e);
            return { pulled: 0, pushed: 0, failed: 0, error: e instanceof Error ? e.message : "Failed to sync the Assignees." };
          })
      : null;
    const assigneeCounts = assignees && (assignees.pulled || assignees.pushed || assignees.failed || assignees.error) ? assignees : null;

    // The Roadmap follows the repo's open issues; a failure here doesn't fail the board sync.
    const roadmap: RoadmapReconcile = await reconcileRoadmapWithIssues(token, onProject, readOpen, cards).catch((e) => {
      console.error("syncBoard: roadmap reconcile failed", e);
      return { added: 0, removed: 0, issuesCreated: 0, error: e instanceof Error ? e.message : "Failed to update the Roadmap." };
    });

    // The sub-issues of the sprint's issues, for the Dashboard's Slices block. Read last, after the steps above
    // settled which issues are in the sprint; a failure keeps the slices of the last sync.
    await syncSlices(token).catch((e) => console.error("syncBoard: slices failed", e));

    const fieldCounts: FieldsSummary | null =
      fields && (fields.pulled || fields.pushed || fields.failed || fields.error)
        ? { pulled: fields.pulled, pushed: fields.pushed, failed: fields.failed, ...(fields.error ? { error: fields.error } : {}) }
        : null;
    return {
      ok: true,
      columns,
      syncedAt,
      roadmap: {
        ...roadmap,
        ...(sprint ? { sprint } : {}),
        ...(retitled ? { retitled } : {}),
        ...(fieldCounts ? { fields: fieldCounts } : {}),
        ...(commentCounts ? { comments: commentCounts } : {}),
        ...(assigneeCounts ? { assignees: assigneeCounts } : {}),
      },
    };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Unknown error" };
  }
}

// Turns the week once a week's last day has passed (src/lib/sprint-rotation.ts has the plan): only the week that
// ended moves. Its Done items leave (a remove each); the rest go, in their order, on top of today's week, created
// when it is missing (src/lib/week-lanes.ts), with a move_lane each (origin "rotation"); the items already there go
// down with a new order only; the lane that ended goes once empty. The weeks to come are never touched. Any dated
// sprint lane is a week, so before migration 0031 the positional "atual" ends like any other and "proxima" takes
// its items, but "atual" stays, empty, for 0031 to rename with the changes just queued that name it; after it, the
// lanes are named by their date.
// Two syncs turning at once can't do it twice: every write takes an item only where this sync saw it (the update
// and the delete are guarded by its lane, and only a row that changed is queued), and a lane goes only empty.
async function rotateSprints(doneUrls: Set<string>, now = new Date()): Promise<void> {
  const admin = createAdminClient();
  const { data: lanes, error: lanesError } = await admin.from("lanes").select("id, kind, start_date, end_date").eq("kind", "sprint");
  if (lanesError) throw lanesError;
  const weeks = weekLanes(lanes ?? []);
  if (!weeks.length) return;
  const { data: items, error: itemsError } = await admin
    .from("roadmap_items")
    .select("id, lane_id, sort_order, title, github_issue_url")
    .in("lane_id", weeks.map((w) => w.id));
  if (itemsError) throw itemsError;

  const plan = planRotation({
    today: todayInSaoPaulo(now),
    lanes: weeks,
    items: (items ?? []).map((it) => ({ id: it.id, laneId: it.lane_id, sortOrder: it.sort_order, url: it.github_issue_url })),
    doneUrls,
  });
  if (rotationIsIdle(plan)) return;
  const byId = new Map((items ?? []).map((it) => [it.id, it]));

  for (const { id, laneId } of plan.finished) {
    const item = byId.get(id)!;
    // Queued first, so no item leaves without its change: with item_id null, since the row is about to go, and the
    // payload carrying it all. Then the delete, only of the item still in the week this sync saw it in; when it
    // fails or finds nothing (another sync took it), the change just queued is withdrawn. The item's notes go
    // only with a delete that happened.
    const { data: queued, error: queueError } = await admin
      .from("roadmap_sync_queue")
      .insert({
        item_id: null,
        action: "remove",
        payload: { item_id: id, lane_id: laneId, title: item.title, github_issue_url: item.github_issue_url, reason: "sprint ended, issue done" },
      })
      .select("id")
      .single();
    if (queueError) throw queueError;
    const { data: removed, error } = await admin.from("roadmap_items").delete().eq("id", id).eq("lane_id", laneId).select();
    if (error || !removed?.length) {
      await admin.from("roadmap_sync_queue").delete().eq("id", queued.id);
      if (error) throw error;
    }
  }

  if (plan.target) {
    const to = plan.createTarget ? await ensureWeekLane(admin, plan.target, now) : plan.target;
    for (const r of plan.reorders) {
      const { error } = await admin.from("roadmap_items").update({ sort_order: r.sortOrder }).eq("id", r.id).eq("lane_id", to);
      if (error) throw error;
    }
    for (const m of plan.moves) {
      const item = byId.get(m.id)!;
      const { data: moved, error } = await admin
        .from("roadmap_items")
        .update({ lane_id: to, sort_order: m.sortOrder })
        .eq("id", m.id)
        .eq("lane_id", m.from)
        .select("id");
      if (error) throw error;
      if (!moved?.length) continue;
      const { error: queueError } = await admin.from("roadmap_sync_queue").insert({
        item_id: m.id,
        action: "move_lane",
        payload: moveLanePayload({ from: m.from, to, title: item.title, reason: "sprint ended, carried over", origin: "rotation" }),
      });
      if (queueError) {
        await admin.from("roadmap_items").update({ lane_id: m.from, sort_order: item.sort_order }).eq("id", m.id);
        throw queueError;
      }
    }
  }

  for (const laneId of plan.deleteLanes) await deleteWeekIfEmpty(admin, laneId);
}

type Admin = ReturnType<typeof createAdminClient>;

// Title, Description, Type, Stack, Priority and Effort go both ways between each item and its open issue
// (src/lib/bilateral-sync.ts has the rule). The Description is the issue's "## Solução" section; the Type is its type:
// label, and the issue's native type follows it; Stack, Priority and Effort are its card's fields on Project #7, matched
// by id (Effort by its option's name, see EFFORT_FIELD_ID), and Stack and Priority carry the labels they imply (area:,
// priority:high). A field the issue leaves empty is a gap RoadS fills with a value edited in RoadS (never a default); an option RoadS doesn't
// offer (a Stack named after a person) leaves the field alone. A value brought in is queued as a modify so FrontlightS
// sees it, as titles always were; a value written to GitHub changes only that field of the issue (labels of other
// families are kept). What the issue said is remembered per field (github_seen), and the title also in github_title,
// which older readers use. One item failing is counted and the others go on.
type SyncedField = "title" | "description" | "tipo" | "stack" | "prioridade" | "effort" | "status" | "week";
const ISSUE_FIELDS = ["title", "description", "tipo"] as const;
const BOARD_FIELDS = { stack: STACK_FIELD_ID, prioridade: PRIORIDADE_FIELD_ID, effort: EFFORT_FIELD_ID } as const;
type BoardField = keyof typeof BOARD_FIELDS;
/** How many items the field sync handles at once: few enough for GitHub's limits on writes. */
const FIELDS_POOL = 6;

async function syncIssueFields(
  token: string,
  open: OpenIssue[],
  push: boolean,
  cards: Map<number, ProjectCard>
): Promise<FieldsSummary & { retitled: number }> {
  const admin = createAdminClient();
  const { data: items, error } = await admin
    .from("roadmap_items")
    .select("id, lane_id, title, description, tipo, stack, prioridade, effort, status, github_issue_url, github_seen, field_changed_at");
  if (error) throw error;
  // An open item's Status on the card is Development in the current sprint and Open outside it.
  const currentId = (await currentSprintLane(admin).catch(() => null))?.id ?? null;
  // The lanes tell an item's Week (the Monday of its week lane) and the block a Week emptied on GitHub sends it to.
  const { data: lanes, error: lanesError } = await admin.from("lanes").select("id, kind, start_date");
  if (lanesError) throw lanesError;
  const laneById = new Map((lanes ?? []).map((l) => [l.id, l]));
  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));
  const today = todayInSaoPaulo(new Date());

  // The board's options as they are now, read once: Effort's names both ways, and no write to an option the board
  // no longer has. Unreadable, the card fields wait for the next sync and the issue's own fields still go.
  const fields = await readBoardFields(token).catch((e) => {
    console.error("syncBoard: board options unreadable, card fields skipped", e);
    return null;
  });
  const options = fields?.options ?? null;
  // The Week is a date field made on the board by hand, so it is found by its name (and taken only as a date field).
  const weekId = fields?.byName.get("Week");
  const weekField = weekId && options?.get(weekId) === null ? weekId : null;
  const effortOf = (id: string) => {
    const name = options?.get(EFFORT_FIELD_ID)?.get(id);
    return name && isEffort(name) ? name : null;
  };
  const fromOption: Record<BoardField, (id: string) => string | null> = { stack: stackOfOption, prioridade: prioridadeOfOption, effort: effortOf };
  const optionFor = (field: BoardField, value: string): string | null => {
    const id =
      field === "stack"
        ? STACK_OPTION_IDS[value as Stack]
        : field === "prioridade"
          ? PRIORIDADE_OPTION_IDS[value as Prioridade]
          : [...(options?.get(EFFORT_FIELD_ID) ?? new Map<string, string>())].find(([, name]) => name === value)?.[0];
    return id && options?.get(BOARD_FIELDS[field])?.has(id) ? id : null;
  };

  const byNumber = new Map(open.map((i) => [i.number, i]));
  type Side = { roads: string; github: string; githubAt?: string | null };
  type Row = { id: string; laneId: string; tipo: string | null; number: number; issue: OpenIssue; card?: ProjectCard; seen: Record<string, string>; changedAt: Record<string, string>; values: Partial<Record<SyncedField, Side>> };
  const rows: Row[] = [];
  for (const item of items ?? []) {
    if (isTestData(item.title)) continue;
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    const issue = byNumber.get(number);
    if (!issue) continue;
    const seen: Record<string, string> = { ...((item.github_seen as Record<string, string> | null) ?? {}) };
    // A body without a Solução section says nothing about the Description: it reads as unchanged on GitHub.
    const githubDescription = extractSolucao(issue.body) ?? seen.description ?? item.description ?? "";
    const values: Row["values"] = {
      title: { roads: item.title, github: issue.title.trim() },
      description: { roads: item.description ?? "", github: githubDescription },
      tipo: { roads: item.tipo ?? "", github: tipoOfLabels(issue.labels) ?? "" },
    };
    // The card's fields, when the card and its values were read: an empty field reads "", an option RoadS doesn't
    // offer leaves the field out.
    const card = cards.get(number);
    // The Status: Done and Blocker on the card are the item's own; Open and Development are both an open item.
    if (card) values.status = { roads: item.status ?? "Open", github: statusOfIssue({ closed: false, card: card.status }), githubAt: card.statusAt };
    if (card && weekField) {
      const value = card.dates?.[weekField];
      values.week = { roads: weekOfLane(laneById.get(item.lane_id)), github: weekOfIssue(value?.date), githubAt: value?.updatedAt ?? null };
    }
    if (card?.options && options) {
      const roadsOf: Record<BoardField, string> = { stack: isStack(item.stack) ? item.stack : "", prioridade: item.prioridade ?? "", effort: item.effort ?? "" };
      for (const field of Object.keys(BOARD_FIELDS) as BoardField[]) {
        const value = card.options[BOARD_FIELDS[field]];
        const github = value ? fromOption[field](value.optionId) : "";
        if (github !== null) values[field] = { roads: roadsOf[field], github, githubAt: value?.updatedAt ?? null };
      }
    }
    rows.push({ id: item.id, laneId: item.lane_id, tipo: item.tipo, number, issue, card, seen, changedAt: (item.field_changed_at as Record<string, string> | null) ?? {}, values });
  }

  const moved = (row: Row, field: SyncedField) => {
    const v = row.values[field];
    return !!v && field in row.seen && v.roads !== row.seen[field] && v.github !== row.seen[field] && v.roads !== v.github;
  };
  // GitHub's change times of the issue's own fields are read only for the fields both sides moved, the one case the
  // rule needs them; the card's fields carry theirs.
  const bothMoved = rows.filter((r) => ISSUE_FIELDS.some((f) => moved(r, f)));
  const times = bothMoved.length ? await readIssueChangeTimes(token, bothMoved.map((r) => r.number)) : new Map<number, IssueChangeTimes>();
  const githubAtOf = (field: SyncedField, side: Side, t?: IssueChangeTimes) =>
    field === "title" ? t?.titleAt : field === "description" ? t?.bodyAt : field === "tipo" ? t?.labelAt : side.githubAt;

  // A Week changed on GitHub moves the item there (its week created when missing, the item last in it) or back to its
  // block, the way the sprint sync moves one: only from where this sync saw it, queued as a move_lane with origin
  // "project", undone if the queue refuses; a future week it leaves empty goes. Answers whether it moved.
  async function moveToWeek(row: Row, to: NonNullable<ReturnType<typeof weekPull>>): Promise<boolean> {
    const target = to.to === "week" ? await ensureWeekLane(admin, sprintIdFor(to.monday)) : releaseLane(row.issue.labels, row.tipo, groupIds);
    if (!target || target === row.laneId) return false;
    const sortOrder = to.to === "week" ? await nextSprintOrder(admin, target) : row.number;
    const { data: moved, error } = await admin
      .from("roadmap_items")
      .update({ lane_id: target, sort_order: sortOrder })
      .eq("id", row.id)
      .eq("lane_id", row.laneId)
      .select("id, title");
    if (error) throw error;
    if (!moved?.length) return false;
    const { error: queueError } = await admin.from("roadmap_sync_queue").insert({
      item_id: row.id,
      action: "move_lane",
      payload: moveLanePayload({ from: row.laneId, to: target, title: moved[0].title, reason: "week follows the issue on GitHub", origin: "project" }),
    });
    if (queueError) {
      await admin.from("roadmap_items").update({ lane_id: row.laneId }).eq("id", row.id);
      throw queueError;
    }
    if (laneById.get(row.laneId)?.kind === "sprint") await deleteFutureWeekIfEmpty(admin, row.laneId).catch(() => {});
    return true;
  }

  // The items go a few at a time (one by one, a round of a hundred took tens of seconds); the moves into a week
  // still go one after another, so two items going to the same week never take the same place in it.
  let moves: Promise<unknown> = Promise.resolve();
  const oneMoveAtATime = <T>(move: () => Promise<T>): Promise<T> => {
    const done = moves.then(move);
    moves = done.catch(() => {});
    return done;
  };

  const summary = { pulled: 0, pushed: 0, failed: 0, retitled: 0 };
  await inPool(rows, FIELDS_POOL, async (row) => {
    try {
      const pulled: Partial<Record<SyncedField, string>> = {};
      const change: IssueChange = {};
      const cardWrites: [string, string][] = [];
      let cardStatus: ReturnType<typeof statusWrites>["card"] | null = null;
      let cardWeek: string | null = null;
      let weekMove: NonNullable<ReturnType<typeof weekPull>> | null = null;
      const relabel = new Set<LabelledField>();
      const pushedFields: SyncedField[] = [];
      const seen = { ...row.seen };
      for (const [field, side] of Object.entries(row.values) as [SyncedField, Side][]) {
        const { roads, github } = side;
        const decision = decideField({
          roads,
          base: field in row.seen ? row.seen[field] : null,
          github,
          roadsAt: row.changedAt[field] ?? null,
          githubAt: githubAtOf(field, side, times.get(row.number)) ?? null,
          fillGap: field !== "title" && field !== "description" && field !== "status",
        });
        if (decision === "pull" && field === "week") {
          // A Week brought in moves the item; a week gone by moves nothing and is looked at again next time.
          weekMove = weekPull(github, today);
          if (weekMove) seen.week = github;
        } else if (decision === "pull") {
          pulled[field] = github;
          seen[field] = github;
          // A Stack or Priority changed on the board brings the labels it implies along on the issue.
          if (field === "stack" || field === "prioridade") relabel.add(field);
        } else if (decision === "push" && push) {
          if (field === "title") change.title = roads;
          else if (field === "description") change.body = replaceSolucao(row.issue.body, roads);
          else if (field === "tipo") relabel.add("tipo");
          else if (field === "status") {
            // Done closes the issue as completed, leaving Done reopens it, and the card's Status follows.
            const writes = statusWrites(roads as ItemStatus, github as ItemStatus, row.laneId === currentId);
            if (writes.issue) Object.assign(change, writes.issue);
            cardStatus = writes.card;
          } else if (field === "week") {
            cardWeek = roads; // the Monday, or "" to empty the field when the item left its week
          } else {
            const option = row.card && optionFor(field, roads);
            if (!option) continue; // the board has no such option (yet): nothing is written, and nothing remembered
            cardWrites.push([BOARD_FIELDS[field], option]);
            if (field !== "effort") relabel.add(field);
          }
          seen[field] = roads;
          pushedFields.push(field);
        } else if (decision === "none") {
          seen[field] = github;
        }
      }

      // The labels the final values imply, and the native type the Type implies: written only by those who push.
      let gapsFilled = false;
      if (push) {
        // What the issue says once this sync is done: a value written to it, else what it already says.
        const final = (field: "tipo" | "stack" | "prioridade") => (pushedFields.includes(field) ? row.values[field]?.roads : row.values[field]?.github) ?? "";
        const [t, s, p] = [final("tipo"), final("stack"), final("prioridade")];
        const tipo = isTipo(t) ? t : null;
        const labels = labelsAfter(
          row.issue.labels,
          { tipo, stack: isStack(s) ? s : null, prioridade: Object.hasOwn(PRIORIDADE_OPTION_IDS, p) ? (p as Prioridade) : null },
          relabel
        );
        if (labels.join("\n") !== row.issue.labels.join("\n")) change.labels = labels;
        if (tipo && row.issue.type !== nativeTypeOf(tipo)) change.type = nativeTypeOf(tipo);
        gapsFilled = (change.labels !== undefined || change.type !== undefined) && !pushedFields.length;
      }

      if (Object.keys(change).length) await updateIssue(token, row.number, change);
      for (const [field, option] of cardWrites) await setProjectOption(token, row.card!.itemId, field, option);
      if (cardStatus) await setProjectStatus(token, row.card!.itemId, cardStatus);
      if (cardWeek !== null) {
        if (cardWeek) await setProjectDate(token, row.card!.itemId, weekField!, cardWeek);
        else await clearProjectField(token, row.card!.itemId, weekField!);
      }
      const move = weekMove;
      if (move && (await oneMoveAtATime(() => moveToWeek(row, move)))) summary.pulled++;
      // Written only when something changed: the base, or a value brought in.
      if (Object.keys(pulled).length || !sameBase(seen, row.seen)) {
        const update: Record<string, unknown> = { github_seen: seen, github_title: seen.title ?? null, ...pulled };
        const { error: updateError } = await admin.from("roadmap_items").update(update).eq("id", row.id);
        if (updateError) throw updateError;
      }
      if (Object.keys(pulled).length) {
        const { error: queueError } = await admin.from("roadmap_sync_queue").insert({
          item_id: row.id,
          action: "modify",
          payload: { ...pulled, reason: "field follows the issue on GitHub" },
        });
        if (queueError) throw queueError;
      }
      summary.pulled += Object.keys(pulled).length;
      if (pulled.title !== undefined) summary.retitled++;
      // A write that only filled the issue's gaps (labels, native type) counts as one field written.
      summary.pushed += pushedFields.length + (gapsFilled ? 1 : 0);
    } catch (e) {
      console.error("syncBoard: two-way fields failed for an item", e);
      summary.failed++;
    }
  });

  // An item taken out of Done in RoadS holds a closed issue, which isn't among the open ones read above: it is read on
  // its own and reopened, and its card follows. Only those who push do this.
  for (const item of push ? (items ?? []) : []) {
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    const seen = (item.github_seen as Record<string, string> | null) ?? {};
    const status: ItemStatus = item.status ?? "Open";
    if (!number || byNumber.has(number) || isTestData(item.title) || seen.status !== "Done" || status === "Done") continue;
    try {
      if ((await readIssueState(token, number)) === "closed") {
        const writes = statusWrites(status, "Done", item.lane_id === currentId);
        if (writes.issue) await updateIssue(token, number, writes.issue);
        const card = cards.get(number);
        if (card) await setProjectStatus(token, card.itemId, writes.card);
        summary.pushed++;
      }
      const { error: updateError } = await admin.from("roadmap_items").update({ github_seen: { ...seen, status } }).eq("id", item.id);
      if (updateError) throw updateError;
    } catch (e) {
      console.error("syncBoard: reopening an issue failed", e);
      summary.failed++;
    }
  }
  return summary;
}

// The parts of the issues in the current sprint (the boxes of their acceptance criteria and their open sub-issues),
// stored with the board snapshot for the Dashboard's Sprint block.
async function syncSlices(token: string): Promise<void> {
  const admin = createAdminClient();
  const current = await currentSprintLane(admin);
  const { data: items, error } = current
    ? await admin.from("roadmap_items").select("github_issue_url").eq("lane_id", current.id).order("sort_order")
    : { data: [], error: null };
  if (error) throw error;
  const numbers = (items ?? []).map((it) => Number(it.github_issue_url?.match(ISSUE_URL)?.[1])).filter((n) => n > 0);

  let groups: ReturnType<typeof parseSlices> = [];
  if (numbers.length) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: slicesQuery(numbers) }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} reading the sub-issues`);
    const json = await res.json();
    if (!json.data) throw new Error(json.errors?.[0]?.message ?? "GitHub did not return the sub-issues");
    groups = parseSlices(json.data, numbers);
  }
  const { error: writeError } = await admin.from("board_sync_state").update({ slices: groups }).eq("id", true);
  if (writeError) throw writeError;
}

// Where the next item goes in the current sprint: after the last one there.
async function nextSprintOrder(admin: Admin, laneId: string): Promise<number> {
  const { data, error } = await admin.from("roadmap_items").select("sort_order").eq("lane_id", laneId).order("sort_order", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.sort_order ?? -1) + 1;
}

// The current sprint and the Project's Development are one fact (src/lib/sprint-status-sync.ts has the rule).
// This reads the items and their last placement, hands the rule the real ports, and says what it did.
// Only open GeoCloud issues that are on the Project take part: a closed one is the sprint's history.
async function syncSprintWithProject(
  token: string,
  cards: Map<number, ProjectCard>,
  open: OpenIssue[],
  push: boolean
): Promise<{ summary: SprintSyncSummary; written: { url: string; status: "Open" | "Development" }[] }> {
  const admin = createAdminClient();
  const [{ data: lanes, error: lanesError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("lanes").select("id, kind, start_date, end_date"),
    admin.from("roadmap_items").select("id, lane_id, sort_order, title, tipo, github_issue_url, created_at"),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;

  // The week told by the calendar; a pull into it creates its lane when this week has none yet.
  const current = currentSprintIn(lanes ?? [])?.id ?? null;
  let pullInto: Promise<string> | null = null;
  const sprintLane = () => (pullInto ??= ensureCurrentSprintLane(admin));

  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));
  const openByNumber = new Map(open.map((i) => [i.number, i]));
  const byId = new Map<string, { laneId: string; sortOrder: number; title: string; url: string; number: number }>();
  const candidates: SprintCandidate[] = [];
  for (const item of items ?? []) {
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    const card = cards.get(number);
    const issue = openByNumber.get(number);
    if (!number || !card || !issue) continue;
    // Back to the block of its type label, or of the type it is stored with (the same rule a drop on the Kanban uses).
    const releaseTo = releaseLane(issue.labels, item.tipo, groupIds);
    byId.set(item.id, { laneId: item.lane_id, sortOrder: item.sort_order, title: item.title, url: item.github_issue_url!, number });
    candidates.push({
      id: item.id,
      laneId: item.lane_id,
      createdAt: item.created_at,
      releaseTo,
      card: { projectItemId: card.itemId, status: card.status, statusAt: card.statusAt },
    });
  }

  // The item moves and then the move is queued; if the queue refuses, the item goes back, so the Roadmap and
  // the files FrontlightS writes never disagree about a move that happened. The update only takes an item that
  // is still where this sync saw it: if a button sync and the daily run overlap, the second finds it already
  // moved and queues nothing, so a move is never written twice.
  async function move(id: string, to: string, sortOrder: number, reason: string) {
    const item = byId.get(id)!;
    const { data: moved, error } = await admin.from("roadmap_items").update({ lane_id: to, sort_order: sortOrder }).eq("id", id).eq("lane_id", item.laneId).select("id");
    if (error) throw error;
    if (!moved?.length) return;
    const { error: queueError } = await admin.from("roadmap_sync_queue").insert({
      item_id: id,
      action: "move_lane",
      payload: moveLanePayload({ from: item.laneId, to, title: item.title, reason, origin: "project" }),
    });
    if (queueError) {
      await admin.from("roadmap_items").update({ lane_id: item.laneId, sort_order: item.sortOrder }).eq("id", id);
      throw queueError;
    }
  }

  const deps: SprintSyncDeps = {
    // Written by those who push (issue #22: no flag any more); a dev's sync only reports what it would write.
    writeEnabled: push,
    // The newest add / move_lane row of each item is when the Roadmap last placed it.
    movedAt: async (ids) => {
      const found = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(
          ids.slice(i, i + 10).map(async (id) => {
            const { data, error } = await admin
              .from("roadmap_sync_queue")
              .select("created_at")
              .eq("item_id", id)
              .in("action", ["add", "move_lane"])
              .order("created_at", { ascending: false })
              .limit(1);
            if (error) throw error;
            if (data?.[0]) found.set(id, data[0].created_at);
          })
        );
      }
      return found;
    },
    pull: async ({ id }) => {
      const lane = await sprintLane();
      await move(id, lane, await nextSprintOrder(admin, lane), "moved to Development on the Project");
      // Pulled out of a future week it was the last item of: that week stops existing (src/lib/week-lanes.ts).
      await deleteFutureWeekIfEmpty(admin, byId.get(id)!.laneId).catch((e) => console.error("deleteFutureWeekIfEmpty failed; the empty week stays", e));
    },
    release: async ({ id, to }) => move(id, to, byId.get(id)!.number, "taken out of Development on the Project"),
    writeStatus: (projectItemId, status) => setProjectStatus(token, projectItemId, status),
  };

  const { summary, written } = await runSprintSync(candidates, deps, current);
  return { summary, written: written.map((w) => ({ url: byId.get(w.id)!.url, status: w.status })) };
}

// Every Roadmap item is a GitHub issue, and every open GeoCloud issue that is on Project #7 is on the
// Roadmap, ready to be dragged into a sprint. A GeoCloud item without an issue (its creation on save
// failed) gets one now, Open on Project #7; test data (src/lib/test-data.ts) never does, and is never imported. An open issue
// the Roadmap doesn't have yet lands in the group of its type label (laneForLabels). A Roadmap item whose issue is
// no longer open, or no longer on the project, leaves the Roadmap from the groups; one whose issue was closed before its
// week came leaves that week too (src/lib/closed-before-week.ts); in the current week or one that ended it stays as
// delivered. Items without an issue, or with an issue from another repo, are left alone.
// Each add/remove is queued in roadmap_sync_queue so FrontlightS writes it into ROADMAP.md.
const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;

/** An open issue as the sync reads it; `type` is its native type's name (Bug, Feature, Task), null without one. */
type OpenIssue = { number: number; title: string; url: string; body: string; labels: string[]; type: string | null };

async function fetchOpenIssues(token: string): Promise<OpenIssue[]> {
  const issues: OpenIssue[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`https://api.github.com/repos/${GEOCLOUD_REPO}/issues?state=open&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} listing the open issues`);
    const batch: { number: number; title: string; html_url: string; body: string | null; labels: { name: string }[]; type?: { name?: string } | null; pull_request?: unknown }[] = await res.json();
    for (const it of batch) {
      if (!it.pull_request) issues.push({ number: it.number, title: it.title, url: it.html_url, body: it.body ?? "", labels: it.labels.map((l) => l.name), type: it.type?.name ?? null });
    }
    if (batch.length < 100) return issues;
  }
  throw new Error("Too many open issues to list");
}

// First paragraph of the issue body, as plain text, short enough for a card.
function summarize(body: string): string {
  const paragraph =
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^#+\s.*$/gm, "").replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim())
      .find(Boolean) ?? "";
  return paragraph.length > 280 ? `${paragraph.slice(0, 277).trimEnd()}...` : paragraph;
}

async function reconcileRoadmapWithIssues(
  token: string,
  onProject: Set<number>,
  readOpen: () => Promise<OpenIssue[]>,
  cards: Map<number, ProjectCard>
): Promise<RoadmapReconcile> {
  // The Roadmap is the open issues that are on Project #7. An empty project read means the read went
  // wrong, so nothing is removed on its account.
  if (onProject.size === 0) throw new Error("Project #7 returned no GeoCloud issues; the Roadmap was not changed.");
  const open = await readOpen();
  const openNumbers = new Set(open.map((i) => i.number));

  const admin = createAdminClient();
  const [{ data: lanes, error: lanesError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("lanes").select("id, kind, start_date, end_date"),
    admin.from("roadmap_items").select("id, lane_id, title, description, produto, prioridade, effort, tipo, stack, github_issue_url"),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;
  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));
  const current = currentSprintIn(lanes ?? [])?.id ?? null;

  const onRoadmap = new Set<number>();
  const closed: { id: string; lane_id: string; title: string; github_issue_url: string }[] = [];
  let issuesCreated = 0;
  for (const item of items ?? []) {
    if (item.produto === "GeoCloud" && mayGetIssue(item)) {
      const issue = await createGeoCloudIssue(
        token,
        {
          title: item.title,
          description: item.description,
          prioridade: item.prioridade,
          effort: item.effort,
          tipo: isTipo(item.tipo) ? item.tipo : "feature",
          stack: isStack(item.stack) ? item.stack : "General",
        },
        item.lane_id === current ? "Development" : "Open"
      );
      const { error } = await admin
        .from("roadmap_items")
        .update({ github_issue_url: issue.url, github_issue_number: issue.number })
        .eq("id", item.id);
      if (error) throw error;
      await admin.from("roadmap_sync_queue").insert({
        item_id: item.id,
        action: "modify",
        payload: { github_issue_url: issue.url, title: item.title, reason: "issue linked" },
      });
      issuesCreated++;
      // Just opened, so it's open: count it as on the Roadmap, never as closed.
      onRoadmap.add(issue.number);
      openNumbers.add(issue.number);
      continue;
    }
    const n = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    if (!n) continue;
    onRoadmap.add(n);
    if (!openNumbers.has(n) && groupIds.has(item.lane_id)) closed.push(item);
  }

  for (const item of closed) {
    // Queue first: the queue's FK goes null once the row is deleted, so the payload carries it all.
    await admin.from("roadmap_sync_queue").insert({
      item_id: item.id,
      action: "remove",
      payload: { item_id: item.id, lane_id: item.lane_id, title: item.title, github_issue_url: item.github_issue_url, reason: "issue closed or taken off the project, outside a sprint" },
    });
    const { error } = await admin.from("roadmap_items").delete().eq("id", item.id);
    if (error) throw error;
  }

  // An issue closed before its week came leaves that week (src/lib/closed-before-week.ts); the current week keeps its
  // closed ones until the turn of the week takes them out as done.
  const leftEarly = await removeClosedBeforeTheirWeek(admin, lanes ?? [], items ?? [], openNumbers, onProject);

  // Items in a type block follow their issue's type label to the block it names (an item the scrum
  // master dragged into any other group is left where it was put).
  for (const item of items ?? []) {
    const n = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    const issue = open.find((i) => i.number === n);
    if (!issue || !TYPE_LANES.includes(item.lane_id)) continue;
    const target = laneForLabels(issue.labels);
    if (!target || target === item.lane_id) continue;
    const { error } = await admin.from("roadmap_items").update({ lane_id: target, sort_order: issue.number }).eq("id", item.id);
    if (error) throw error;
    await admin.from("roadmap_sync_queue").insert({
      item_id: item.id,
      action: "move_lane",
      payload: moveLanePayload({ from: item.lane_id, to: target, title: item.title, reason: "filed by type label", origin: "label" }),
    });
  }

  // An issue with no type:* label stays out of the Roadmap until it gets one: there is no block for it.
  // Test data (src/lib/test-data.ts) is never imported, not even counted as untyped.
  const notYet = importableIssues(open.filter((i) => !onRoadmap.has(i.number))).sort((a, b) => a.number - b.number);
  const missing = notYet.filter((i) => laneForLabels(i.labels));
  if (missing.length) {
    // An issue already in Development on the Project comes straight into the current sprint, after what is there
    // (its lane is created when this week has none yet).
    const inSprint = (i: OpenIssue) => cards.get(i.number)?.status === "Development";
    const sprintLane = missing.some(inSprint) ? await ensureCurrentSprintLane(admin) : null;
    let nextInSprint = sprintLane ? await nextSprintOrder(admin, sprintLane) : 0;
    const { data: inserted, error } = await admin
      .from("roadmap_items")
      .insert(
        missing.map((i) => ({
          lane_id: inSprint(i) && sprintLane ? sprintLane : laneForLabels(i.labels)!,
          sort_order: inSprint(i) ? nextInSprint++ : i.number,
          title: i.title,
          description: summarize(i.body),
          produto: "GeoCloud",
          tipo: tipoForLabels(i.labels),
          github_issue_url: i.url,
          github_issue_number: i.number,
        }))
      )
      .select("id, lane_id, title, github_issue_url");
    if (error) throw error;
    await admin.from("roadmap_sync_queue").insert(
      (inserted ?? []).map((row) => ({
        item_id: row.id,
        action: "add",
        payload: { lane_id: row.lane_id, title: row.title, github_issue_url: row.github_issue_url, reason: "open issue imported from GitHub" },
      }))
    );
  }

  return { added: missing.length, removed: closed.length + leftEarly, issuesCreated, untyped: notYet.length - missing.length };
}

// Plugs the database into the removal of the items whose issue was closed before their week came (the sequence and
// its order live in removeClosedBeforeTheirWeek, src/lib/closed-before-week.ts, where they run under test).
async function removeClosedBeforeTheirWeek(
  admin: Admin,
  lanes: { id: string; kind: string; start_date: string | null; end_date: string | null }[],
  items: { id: string; lane_id: string; title: string; github_issue_url: string | null }[],
  open: Set<number>,
  onProject: Set<number>
): Promise<number> {
  const deps: ClosedRemovalDeps = {
    queue: async (row) => {
      const { data, error } = await admin.from("roadmap_sync_queue").insert(row).select("id").single();
      if (error) throw error;
      return data.id;
    },
    deleteFromWeek: async (id, laneId) => {
      const { data, error } = await admin.from("roadmap_items").delete().eq("id", id).eq("lane_id", laneId).select("id");
      if (error) throw error;
      return !!data?.length;
    },
    unqueue: async (queueId) => {
      await admin.from("roadmap_sync_queue").delete().eq("id", queueId);
    },
    deleteFutureWeekIfEmpty: (laneId) => deleteFutureWeekIfEmpty(admin, laneId),
  };
  return runClosedRemoval(
    {
      today: todayInSaoPaulo(new Date()),
      lanes,
      items: items.map((it) => ({
        id: it.id,
        laneId: it.lane_id,
        number: Number(it.github_issue_url?.match(ISSUE_URL)?.[1]) || null,
        title: it.title,
        githubIssueUrl: it.github_issue_url,
      })),
      open,
      onProject,
    },
    deps
  );
}
