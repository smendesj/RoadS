"use server";

// Live sync for the Dashboard's Kanban section, pulled straight from
// Essencis-Labs GitHub Project #7's "Status" field (Open/Development/Blocker/Done). The same
// sync also keeps the Roadmap in step with the repo's open issues (reconcileRoadmapWithIssues).
// Requires GITHUB_TOKEN (server-only) — a classic PAT with `repo`+`read:org`+`project`,
// generated from an account that's actually a member of the Essencis-Labs org (a
// fine-grained PAT from the wrong account reads back as "no_access", not an error).
// Without a token at all, this reports "not_configured" instead of faking success.
//
// Runs from two places: the Dashboard's manual button (via syncBoardAsViewer,
// which checks the caller has a real dev/scrum_master/admin session first) and
// the daily cron route (src/app/api/cron/sync-board, gated on CRON_SECRET
// instead — there's no user session in a cron invocation). Both funnel through
// syncBoard(), which also persists the result to board_sync_state so a page
// reload — or a visitor who never clicks the button — still sees the last real
// sync instead of always falling back to mock data.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

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

export type RoadmapReconcile = { added: number; removed: number; error?: string };

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
            content { ... on Issue { number title url } }
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
        const statusName: string | undefined = node.fieldValueByName?.name;
        if (!statusName || !STATUS_META[statusName] || !node.content?.number) continue;
        counts.set(statusName, (counts.get(statusName) ?? 0) + 1);
        const list = itemsByStatus.get(statusName) ?? [];
        list.push({ title: node.content.title, ref: `#${node.content.number}`, url: node.content.url });
        itemsByStatus.set(statusName, list);
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

    // The Roadmap follows the repo's open issues; a failure here doesn't fail the board sync.
    const roadmap = await reconcileRoadmapWithIssues(token).catch((e) => {
      console.error("syncBoard: roadmap reconcile failed", e);
      return { added: 0, removed: 0, error: e instanceof Error ? e.message : "Erro ao atualizar o Roadmap." };
    });

    return { ok: true, columns, syncedAt, roadmap };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

// Every open issue of the GeoCloud repo is on the Roadmap, ready to be dragged into a sprint:
// one the Roadmap doesn't have yet lands in the TRIAGE_LANE group. A Roadmap item whose issue is
// no longer open leaves the Roadmap, but only from the groups: an item already in a sprint stays
// there as delivered. Items without an issue, or with an issue from another repo, are left alone.
// Each add/remove is queued in roadmap_sync_queue so FrontlightS writes it into ROADMAP.md.
const ISSUES_REPO = "Essencis-Labs/GeoCloudAI";
const TRIAGE_LANE = "triagem";
const ISSUE_URL = /github\.com\/Essencis-Labs\/GeoCloudAI\/issues\/(\d+)/i;

type OpenIssue = { number: number; title: string; url: string; body: string };

async function fetchOpenIssues(token: string): Promise<OpenIssue[]> {
  const issues: OpenIssue[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`https://api.github.com/repos/${ISSUES_REPO}/issues?state=open&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao listar as issues abertas`);
    const batch: { number: number; title: string; html_url: string; body: string | null; pull_request?: unknown }[] = await res.json();
    for (const it of batch) {
      if (!it.pull_request) issues.push({ number: it.number, title: it.title, url: it.html_url, body: it.body ?? "" });
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
    admin.from("roadmap_items").select("id, lane_id, title, github_issue_url"),
  ]);
  if (lanesError) throw lanesError;
  if (itemsError) throw itemsError;
  const groupIds = new Set((lanes ?? []).filter((l) => l.kind === "group").map((l) => l.id));

  const onRoadmap = new Set<number>();
  const closed: { id: string; lane_id: string; title: string; github_issue_url: string }[] = [];
  for (const item of items ?? []) {
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

  const missing = open.filter((i) => !onRoadmap.has(i.number)).sort((a, b) => a.number - b.number);
  if (missing.length) {
    const { data: last } = await admin
      .from("roadmap_items")
      .select("sort_order")
      .eq("lane_id", TRIAGE_LANE)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = (last?.sort_order ?? -1) + 1;
    const { data: inserted, error } = await admin
      .from("roadmap_items")
      .insert(
        missing.map((i, k) => ({
          lane_id: TRIAGE_LANE,
          sort_order: base + k,
          title: i.title,
          description: summarize(i.body),
          produto: "GeoCloud",
          github_issue_url: i.url,
          github_issue_number: i.number,
        }))
      )
      .select("id, title, github_issue_url");
    if (error) throw error;
    await admin.from("roadmap_sync_queue").insert(
      (inserted ?? []).map((row) => ({
        item_id: row.id,
        action: "add",
        payload: { lane_id: TRIAGE_LANE, title: row.title, github_issue_url: row.github_issue_url, reason: "open issue imported from GitHub" },
      }))
    );
  }

  return { added: missing.length, removed: closed.length };
}

// Client entry point for the manual "Board sincronizado" button — dev, scrum_master
// and admin can all trigger it (it's a read-refresh, not an edit, so there's no
// reason to restrict it the way Roadmap editing is restricted); anyone without a
// real session gets turned away before we spend a GitHub API call on them.
export async function syncBoardAsViewer(): Promise<SyncResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile?.role) return { ok: false, reason: "unauthenticated", message: "Entre para sincronizar o board." };

  return syncBoard();
}

export async function getLatestBoardSnapshot(): Promise<{ columns: SyncColumn[]; syncedAt: string } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
  if (!data) return null;
  return { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string };
}
