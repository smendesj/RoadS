"use server";

// Live sync for the Dashboard's Kanban section, pulled straight from
// Essencis-Labs GitHub Project #7's "Status" field (Open/Development/Blocker/Done).
// Requires GITHUB_TOKEN (server-only) — a PAT or GitHub App token with `read:project`
// (and repo/issue read) on the Essencis-Labs org. Without it, this reports
// "not_configured" instead of pretending to have synced.
//
// Runs from two places: the Dashboard's manual button (via the client action
// below) and the hourly cron route (src/app/api/cron/sync-board). Both funnel
// through syncBoard(), which also persists the result to board_sync_state so a
// page reload — or a visitor who never clicks the button — still sees the last
// real sync instead of always falling back to mock data.

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

export type SyncResult =
  | { ok: true; columns: SyncColumn[]; syncedAt: string }
  | { ok: false; reason: "not_configured" | "no_access" | "error"; message?: string };

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
  const samples = new Map<string, { title: string; ref: string; url: string }[]>();

  try {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res = await fetch("https://api.github.com/graphql", {
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
          message: "O token não enxerga o Project #7 (falta aprovar o fine-grained PAT nas configurações da organização, ou falta o escopo Projects).",
        };
      }

      const items = project.items;
      for (const node of items.nodes) {
        const statusName: string | undefined = node.fieldValueByName?.name;
        if (!statusName || !STATUS_META[statusName] || !node.content?.number) continue;
        counts.set(statusName, (counts.get(statusName) ?? 0) + 1);
        const list = samples.get(statusName) ?? [];
        if (list.length < 3) {
          list.push({ title: node.content.title, ref: `#${node.content.number}`, url: node.content.url });
          samples.set(statusName, list);
        }
      }

      if (!items.pageInfo.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }

    const columns: SyncColumn[] = Object.entries(STATUS_META).map(([title, meta]) => ({
      key: meta.key,
      title,
      tone: meta.tone,
      count: counts.get(title) ?? 0,
      items: samples.get(title) ?? [],
    }));
    const syncedAt = new Date().toISOString();

    try {
      const admin = createAdminClient();
      await admin.from("board_sync_state").upsert({ id: true, columns, synced_at: syncedAt });
    } catch (persistError) {
      console.error("syncBoard: failed to persist snapshot", persistError);
    }

    return { ok: true, columns, syncedAt };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

export async function getLatestBoardSnapshot(): Promise<{ columns: SyncColumn[]; syncedAt: string } | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("board_sync_state").select("columns, synced_at").eq("id", true).maybeSingle();
  if (!data) return null;
  return { columns: data.columns as SyncColumn[], syncedAt: data.synced_at as string };
}
