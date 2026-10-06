import "server-only";

// Live sync for the Dashboard's Kanban section, pulled straight from
// Essencis-Labs GitHub Project #7's "Status" field (Open/Development/Blocker/Done). The same
// sync also keeps the Roadmap in step with the repo's open issues (reconcileRoadmapWithIssues).
// Requires GITHUB_TOKEN (server-only) — a classic PAT with `repo`+`read:org`+`project`,
// generated from an account that's actually a member of the Essencis-Labs org (a
// fine-grained PAT from the wrong account reads back as "no_access", not an error).
// Without a token at all, this reports "not_configured" instead of faking success.
//
// Runs from two places: the Dashboard's and Roadmap's manual buttons (via syncBoardAsViewer in
// actions/sync.ts, which checks the caller has a real session first) and
// the daily cron route (src/app/api/cron/sync-board, gated on CRON_SECRET
// instead — there's no user session in a cron invocation). Both funnel through
// syncBoard(), which also persists the result to board_sync_state so a page
// reload — or a visitor who never clicks the button — still sees the last real
// sync instead of always falling back to mock data.
//
// The same sync keeps the Roadmap's current sprint and the Project's Development telling the same story
// (src/lib/sprint-status-sync.ts): the Project moving an issue moves it in the Roadmap, and the Roadmap
// moving one writes its Status on the Project, but only when PROJECT_STATUS_WRITE=on (off, it reports what it
// would write). The Roadmap's own moves are queued with origin "project" so FrontlightS writes them too.
//
// This is deliberately NOT a "use server" file: everything exported from one of those is an HTTP
// endpoint any signed-in user can call directly, and syncBoard authorizes nobody (the cron has no
// session) and writes with the admin client.

import { createGeoCloudIssue, GEOCLOUD_REPO, setProjectStatus } from "@/lib/github";
import { BOARD_REPO, boardCard, projectCard, withStatusWrites, type ProjectCard } from "@/lib/board";
import { isStack, isTipo } from "@/lib/issue-fields";
import { laneForLabels, tipoForLabels, TYPE_LANES } from "@/lib/issue-lane";
import { moveLanePayload } from "@/lib/move-payload";
import { planRotation, SPRINT_IDS, type SprintDates, type SprintId } from "@/lib/sprint-rotation";
import { parseSlices, slicesQuery } from "@/lib/slices";
import { CURRENT_SPRINT, EMPTY_SPRINT_SUMMARY, runSprintSync, type SprintCandidate, type SprintSyncDeps, type SprintSyncSummary } from "@/lib/sprint-status-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEW_ITEM_TITLE } from "@/lib/types";

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
  items: { title: string; ref: string; url: string }[];
};

export type RoadmapReconcile = {
  added: number;
  removed: number;
  issuesCreated: number;
  untyped?: number;
  error?: string;
  /** What the current sprint and the Project's Development did for each other; absent when there was no card to judge. */
  sprint?: SprintSyncSummary;
};

export type SyncResult =
  | { ok: true; columns: SyncColumn[]; syncedAt: string; roadmap: RoadmapReconcile }
  | { ok: false; reason: "not_configured" | "no_access" | "unauthenticated" | "error"; message?: string };

const QUERY = `
  query($after: String) {
    organization(login: "Essencis-Labs") {
      projectV2(number: 7) {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { ... on Issue { number title url repository { nameWithOwner } } }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }
            }
          }
        }
      }
    }
  }
`;

export async function syncBoard(): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: "not_configured" };

  const onProject = new Set<number>();
  const cards = new Map<number, ProjectCard>();
  const counts = new Map<string, number>();
  const itemsByStatus = new Map<string, { title: string; ref: string; url: string }[]>();

  try {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: Response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { after } }),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, reason: "error", message: `GitHub respondeu ${res.status}` };

      const json = await res.json();
      if (json.errors?.length) return { ok: false, reason: "error", message: json.errors[0].message };

      const project = json.data?.organization?.projectV2;
      if (!project) {
        return {
          ok: false,
          reason: "no_access",
          message: "O token não enxerga o Project #7 — gere um classic PAT (não fine-grained) com escopos repo, read:org e project, a partir de uma conta que seja membro da org Essencis-Labs.",
        };
      }

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
        list.push(entry.card);
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
      items: itemsByStatus.get(title) ?? [],
    }));
    const syncedAt = new Date().toISOString();

    // A sprint whose week is over hands the current spot to the next one; a failure doesn't fail the sync.
    const doneUrls = new Set(columns.find((c) => c.key === "done")?.items.map((i) => i.url));
    await rotateSprints(doneUrls).catch((e) => console.error("syncBoard: sprint rotation failed", e));

    // The open issues on the project, read once for the two steps below (and only if one of them asks).
    let openRead: Promise<OpenIssue[]> | null = null;
    const readOpen = () => (openRead ??= fetchOpenIssues(token).then((list) => list.filter((i) => onProject.has(i.number))));

    // The current sprint and the Project's Development follow each other. A failure here doesn't fail the sync.
    let sprint: SprintSyncSummary | undefined;
    if (cards.size) {
      try {
        const run = await syncSprintWithProject(token, cards, await readOpen());
        sprint = run.summary;
        // What was written to the Project shows on the Dashboard now, not only after the next sync.
        columns = withStatusWrites(columns, run.written);
      } catch (e) {
        console.error("syncBoard: sprint and project sync failed", e);
        sprint = { ...EMPTY_SPRINT_SUMMARY, error: e instanceof Error ? e.message : "Erro ao alinhar a sprint atual com o Project." };
      }
    }

    try {
      const admin = createAdminClient();
      await admin.from("board_sync_state").upsert({ id: true, columns, synced_at: syncedAt });
    } catch (persistError) {
      console.error("syncBoard: failed to persist snapshot", persistError);
    }

    // The Roadmap follows the repo's open issues; a failure here doesn't fail the board sync.
    const roadmap: RoadmapReconcile = await reconcileRoadmapWithIssues(token, onProject, readOpen, cards).catch((e) => {
      console.error("syncBoard: roadmap reconcile failed", e);
      return { added: 0, removed: 0, issuesCreated: 0, error: e instanceof Error ? e.message : "Erro ao atualizar o Roadmap." };
    });

    // The sub-issues of the sprint's issues, for the Dashboard's Slices block. Read last, after the steps above
    // settled which issues are in the sprint; a failure keeps the slices of the last sync.
    await syncSlices(token).catch((e) => console.error("syncBoard: slices failed", e));

    return { ok: true, columns, syncedAt, roadmap: sprint ? { ...roadmap, sprint } : roadmap };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

// Moves the three sprints up a step once the current one's last day has passed (see sprint-rotation.ts).
// The guarded update of "atual" claims the rotation, so the cron and a button sync running together
// can't rotate twice. Every removal and move is queued so FrontlightS mirrors it.
async function rotateSprints(doneUrls: Set<string>): Promise<void> {
  const admin = createAdminClient();
  const [{ data: lanes, error: lanesError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("lanes").select("id, start_date, end_date").in("id", [...SPRINT_IDS]),
    admin.from("roadmap_items").select("id, lane_id, title, github_issue_url").in("lane_id", [...SPRINT_IDS]),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;

  const dates = {} as Record<SprintId, SprintDates>;
  for (const id of SPRINT_IDS) {
    const lane = lanes?.find((l) => l.id === id);
    if (!lane?.start_date || !lane.end_date) return;
    dates[id] = { start: lane.start_date, end: lane.end_date };
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const plan = planRotation({
    today,
    dates,
    items: (items ?? []).map((it) => ({ id: it.id, laneId: it.lane_id, url: it.github_issue_url })),
    doneUrls,
  });
  if (plan.rotations === 0) return;

  const { data: claimed, error: claimError } = await admin
    .from("lanes")
    .update({ start_date: plan.dates.atual.start, end_date: plan.dates.atual.end })
    .eq("id", "atual")
    .eq("end_date", dates.atual.end)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return;
  for (const id of ["proxima", "terceira"] as const) {
    const { error } = await admin.from("lanes").update({ start_date: plan.dates[id].start, end_date: plan.dates[id].end }).eq("id", id);
    if (error) throw error;
  }

  const byId = new Map((items ?? []).map((it) => [it.id, it]));
  for (const id of plan.finished) {
    const item = byId.get(id)!;
    // Queue first: the queue's FK goes null once the row is deleted, so the payload carries it all.
    await admin.from("roadmap_sync_queue").insert({
      item_id: id,
      action: "remove",
      payload: { item_id: id, lane_id: item.lane_id, title: item.title, github_issue_url: item.github_issue_url, reason: "sprint ended, issue done" },
    });
    const { error } = await admin.from("roadmap_items").delete().eq("id", id);
    if (error) throw error;
  }
  for (const p of plan.placements) {
    const { error } = await admin.from("roadmap_items").update({ lane_id: p.to, sort_order: p.sortOrder }).eq("id", p.id);
    if (error) throw error;
    if (p.from !== p.to) {
      await admin.from("roadmap_sync_queue").insert({
        item_id: p.id,
        action: "move_lane",
        payload: moveLanePayload({ from: p.from, to: p.to, title: byId.get(p.id)!.title, reason: "sprints rotated", origin: "rotation" }),
      });
    }
  }
}

type Admin = ReturnType<typeof createAdminClient>;

// The Dashboard's Slices: every sub-issue of the issues in the current sprint, stored with the board snapshot.
async function syncSlices(token: string): Promise<void> {
  const admin = createAdminClient();
  const { data: items, error } = await admin.from("roadmap_items").select("github_issue_url").eq("lane_id", CURRENT_SPRINT).order("sort_order");
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
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao ler as sub-issues`);
    const json = await res.json();
    if (!json.data) throw new Error(json.errors?.[0]?.message ?? "GitHub não devolveu as sub-issues");
    groups = parseSlices(json.data, numbers);
  }
  const { error: writeError } = await admin.from("board_sync_state").update({ slices: groups }).eq("id", true);
  if (writeError) throw writeError;
}

// Where the next item goes in the current sprint: after the last one there.
async function nextSprintOrder(admin: Admin): Promise<number> {
  const { data, error } = await admin.from("roadmap_items").select("sort_order").eq("lane_id", CURRENT_SPRINT).order("sort_order", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.sort_order ?? -1) + 1;
}

// The current sprint and the Project's Development are one fact (src/lib/sprint-status-sync.ts has the rule).
// This reads the items and their last placement, hands the rule the real ports, and says what it did.
// Only open GeoCloud issues that are on the Project take part: a closed one is the sprint's history.
async function syncSprintWithProject(
  token: string,
  cards: Map<number, ProjectCard>,
  open: OpenIssue[]
): Promise<{ summary: SprintSyncSummary; written: { url: string; status: "Open" | "Development" }[] }> {
  const admin = createAdminClient();
  const [{ data: lanes, error: lanesError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("lanes").select("id, kind"),
    admin.from("roadmap_items").select("id, lane_id, sort_order, title, tipo, github_issue_url, created_at"),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;

  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));
  const openByNumber = new Map(open.map((i) => [i.number, i]));
  const byId = new Map<string, { laneId: string; sortOrder: number; title: string; url: string; number: number }>();
  const candidates: SprintCandidate[] = [];
  for (const item of items ?? []) {
    const number = Number(item.github_issue_url?.match(ISSUE_URL)?.[1]);
    const card = cards.get(number);
    const issue = openByNumber.get(number);
    if (!number || !card || !issue) continue;
    // Back to the block of its type label, or of the type it is stored with.
    const releaseTo = [laneForLabels(issue.labels), item.tipo ? `tipo-${item.tipo}` : null].find((lane) => lane && groupIds.has(lane)) ?? null;
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
    // Off until PROJECT_STATUS_WRITE=on: the sync then only reports what it would write to the Project.
    writeEnabled: process.env.PROJECT_STATUS_WRITE === "on",
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
    pull: async ({ id }) => move(id, CURRENT_SPRINT, await nextSprintOrder(admin), "moved to Development on the Project"),
    release: async ({ id, to }) => move(id, to, byId.get(id)!.number, "taken out of Development on the Project"),
    writeStatus: (projectItemId, status) => setProjectStatus(token, projectItemId, status),
  };

  const { summary, written } = await runSprintSync(candidates, deps);
  return { summary, written: written.map((w) => ({ url: byId.get(w.id)!.url, status: w.status })) };
}

// Every Roadmap item is a GitHub issue, and every open GeoCloud issue that is on Project #7 is on the
// Roadmap, ready to be dragged into a sprint. A GeoCloud item without an issue (its creation on save
// failed) gets one now, Open on Project #7. An open issue
// the Roadmap doesn't have yet lands in the group of its type label (laneForLabels). A Roadmap item whose issue is
// no longer open, or no longer on the project, leaves the Roadmap, but only from the groups: an item already in a sprint stays
// there as delivered. Items without an issue, or with an issue from another repo, are left alone.
// Each add/remove is queued in roadmap_sync_queue so FrontlightS writes it into ROADMAP.md.
const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;

type OpenIssue = { number: number; title: string; url: string; body: string; labels: string[] };

async function fetchOpenIssues(token: string): Promise<OpenIssue[]> {
  const issues: OpenIssue[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`https://api.github.com/repos/${GEOCLOUD_REPO}/issues?state=open&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao listar as issues abertas`);
    const batch: { number: number; title: string; html_url: string; body: string | null; labels: { name: string }[]; pull_request?: unknown }[] = await res.json();
    for (const it of batch) {
      if (!it.pull_request) issues.push({ number: it.number, title: it.title, url: it.html_url, body: it.body ?? "", labels: it.labels.map((l) => l.name) });
    }
    if (batch.length < 100) return issues;
  }
  throw new Error("Issues abertas demais para listar");
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
  if (onProject.size === 0) throw new Error("O Project #7 não devolveu issues do GeoCloud; o Roadmap não foi alterado.");
  const open = await readOpen();
  const openNumbers = new Set(open.map((i) => i.number));

  const admin = createAdminClient();
  const [{ data: lanes, error: lanesError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("lanes").select("id, kind"),
    admin.from("roadmap_items").select("id, lane_id, title, description, produto, prioridade, effort, tipo, stack, github_issue_url"),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;
  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));

  const onRoadmap = new Set<number>();
  const closed: { id: string; lane_id: string; title: string; github_issue_url: string }[] = [];
  let issuesCreated = 0;
  for (const item of items ?? []) {
    if (!item.github_issue_url && item.produto === "GeoCloud" && item.title !== NEW_ITEM_TITLE) {
      const issue = await createGeoCloudIssue(
        token,
        {
          title: item.title,
          description: item.description,
          prioridade: item.prioridade,
          effort: item.effort,
          tipo: isTipo(item.tipo) ? item.tipo : "feature",
          stack: isStack(item.stack) ? item.stack : "Geral",
        },
        item.lane_id === CURRENT_SPRINT ? "Development" : "Open"
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
  const notYet = open.filter((i) => !onRoadmap.has(i.number)).sort((a, b) => a.number - b.number);
  const missing = notYet.filter((i) => laneForLabels(i.labels));
  if (missing.length) {
    // An issue already in Development on the Project comes straight into the current sprint, after what is there.
    let nextInSprint = await nextSprintOrder(admin);
    const inSprint = (i: OpenIssue) => cards.get(i.number)?.status === "Development";
    const { data: inserted, error } = await admin
      .from("roadmap_items")
      .insert(
        missing.map((i) => ({
          lane_id: inSprint(i) ? CURRENT_SPRINT : laneForLabels(i.labels)!,
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

  return { added: missing.length, removed: closed.length, issuesCreated, untyped: notYet.length - missing.length };
}
