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
// This is deliberately NOT a "use server" file: everything exported from one of those is an HTTP
// endpoint any signed-in user can call directly, and syncBoard authorizes nobody (the cron has no
// session) and writes with the admin client.

import { createGeoCloudIssue, GEOCLOUD_REPO } from "@/lib/github";
import { boardCard } from "@/lib/board";
import { isStack, isTipo } from "@/lib/issue-fields";
import { laneForLabels, tipoForLabels, TYPE_LANES } from "@/lib/issue-lane";
import { planRotation, SPRINT_IDS, type SprintDates, type SprintId } from "@/lib/sprint-rotation";
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

export type RoadmapReconcile = { added: number; removed: number; issuesCreated: number; untyped?: number; error?: string };

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
            content { ... on Issue { number title url repository { nameWithOwner } } }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
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

    const columns: SyncColumn[] = Object.entries(STATUS_META).map(([title, meta]) => ({
      key: meta.key,
      title,
      tone: meta.tone,
      count: counts.get(title) ?? 0,
      items: itemsByStatus.get(title) ?? [],
    }));
    const syncedAt = new Date().toISOString();

    try {
      const admin = createAdminClient();
      await admin.from("board_sync_state").upsert({ id: true, columns, synced_at: syncedAt });
    } catch (persistError) {
      console.error("syncBoard: failed to persist snapshot", persistError);
    }

    // A sprint whose week is over hands the current spot to the next one; a failure doesn't fail the sync.
    const doneUrls = new Set(columns.find((c) => c.key === "done")?.items.map((i) => i.url));
    await rotateSprints(doneUrls).catch((e) => console.error("syncBoard: sprint rotation failed", e));

    // The Roadmap follows the repo's open issues; a failure here doesn't fail the board sync.
    const roadmap = await reconcileRoadmapWithIssues(token).catch((e) => {
      console.error("syncBoard: roadmap reconcile failed", e);
      return { added: 0, removed: 0, issuesCreated: 0, error: e instanceof Error ? e.message : "Erro ao atualizar o Roadmap." };
    });

    return { ok: true, columns, syncedAt, roadmap };
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
        payload: { lane_id: p.to, from_lane_id: p.from, title: byId.get(p.id)!.title, reason: "sprints rotated" },
      });
    }
  }
}

// Every Roadmap item is a GitHub issue, and every open GeoCloud issue is on the Roadmap, ready to
// be dragged into a sprint. A GeoCloud item without an issue (its creation on save failed) gets
// one now, Open on Project #7. An open issue
// the Roadmap doesn't have yet lands in the group of its type label (laneForLabels). A Roadmap item whose issue is
// no longer open leaves the Roadmap, but only from the groups: an item already in a sprint stays
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

async function reconcileRoadmapWithIssues(token: string): Promise<RoadmapReconcile> {
  const open = await fetchOpenIssues(token);
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
      const issue = await createGeoCloudIssue(token, {
        title: item.title,
        description: item.description,
        prioridade: item.prioridade,
        effort: item.effort,
        tipo: isTipo(item.tipo) ? item.tipo : "feature",
        stack: isStack(item.stack) ? item.stack : "Geral",
      });
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
      payload: { item_id: item.id, lane_id: item.lane_id, title: item.title, github_issue_url: item.github_issue_url, reason: "issue closed outside a sprint" },
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
      payload: { lane_id: target, from_lane_id: item.lane_id, title: item.title, reason: "filed by type label" },
    });
  }

  // An issue with no type:* label stays out of the Roadmap until it gets one: there is no block for it.
  const notYet = open.filter((i) => !onRoadmap.has(i.number)).sort((a, b) => a.number - b.number);
  const missing = notYet.filter((i) => laneForLabels(i.labels));
  if (missing.length) {
    const { data: inserted, error } = await admin
      .from("roadmap_items")
      .insert(
        missing.map((i) => ({
          lane_id: laneForLabels(i.labels)!,
          sort_order: i.number,
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
