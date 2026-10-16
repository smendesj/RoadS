"use server";

// Everything on the Dashboard above the Kanban is derived from the Roadmap (lanes + items in
// Supabase), crossed with the last GitHub Project #7 snapshot for each item's issue status. So a
// Scrum Master's change on /roadmap shows up here on the next "Sincronizar" (or page load), with
// no hand-kept data in between.

import { getRoadmapBoard } from "@/lib/actions/roadmap";
import { getLatestBoardSnapshot, syncBoardAsViewer } from "@/lib/actions/sync";
import { statusByUrl } from "@/lib/board";
import type { SyncColumn } from "@/lib/board-sync";
import { sliceBlocks, type SliceBlock, type SliceGroup } from "@/lib/slices";
import { brakeMessage, roadmapChanged, roadmapSyncMessage, syncFailureMessage } from "@/lib/sync-message";
import { currentSprintLane } from "@/lib/current-sprint";
import { createClient } from "@/lib/supabase/server";
import type { Tone } from "@/lib/tones";

export type DashboardModel = {
  branch: string;
  kpis: { label: string; value: string; hint: string; tone: Tone }[];
  entregas: { title: string; status: string; tone: Tone; effort: string; ref: string; url: string | null }[];
  slices: SliceBlock[];
  columns: SyncColumn[];
  syncedAt: string | null;
};

const STATUS_LABEL: Record<string, { status: string; tone: Tone }> = {
  open: { status: "A FAZER", tone: "neutral" },
  dev: { status: "EM ANDAMENTO", tone: "brand" },
  blocker: { status: "BLOQUEADO", tone: "red" },
  done: { status: "CONCLUÍDO", tone: "green" },
};
const NO_ISSUE = { status: "SEM ISSUE", tone: "neutral" as Tone };

// Weekly branch name from the current week's raw dates (the lane whose dates hold today): SPRINT-28_09-02_10.
async function currentSprintBranch(): Promise<string> {
  const supabase = await createClient();
  const data = await currentSprintLane(supabase).catch(() => null);
  if (!data) return "—";
  const [, sm, sd] = data.start_date.split("-");
  const [, em, ed] = data.end_date.split("-");
  return `SPRINT-${sd}_${sm}-${ed}_${em}`;
}

async function buildDashboard(columns: SyncColumn[], syncedAt: string | null, slices: SliceGroup[]): Promise<DashboardModel> {
  const [{ lanes }, branch] = await Promise.all([getRoadmapBoard(), currentSprintBranch()]);

  // Issue URL -> Kanban status key, from the snapshot (every issue, per status).
  const statusOf = statusByUrl(columns);

  // In the order the week was given on the Roadmap (sort_order), the same as the week and roadmap-state's position.
  const atual = lanes.find((l) => l.current);
  const sprintItems = atual?.items ?? [];

  const entregas = sprintItems.map((it) => {
    const key = it.url ? statusOf.get(it.url) : undefined;
    const label = key ? STATUS_LABEL[key] : NO_ISSUE;
    return {
      title: it.title,
      status: label.status,
      tone: label.tone,
      effort: it.effort,
      ref: it.url ? `#${it.url.split("/").pop()}` : "—",
      url: it.url,
    };
  });

  const countStatus = (key: string) => sprintItems.filter((it) => it.url && statusOf.get(it.url) === key).length;

  const inDev = countStatus("dev");
  const done = countStatus("done");
  const sprintBlocked = countStatus("blocker");
  const boardBlockers = columns.find((c) => c.key === "blocker")?.count ?? 0;

  const kpis: DashboardModel["kpis"] = [
    { label: "Development", value: String(inDev), hint: atual?.title ?? "Nenhuma sprint nesta semana", tone: "neutral" },
    {
      label: "Concluídas",
      value: `${done} de ${sprintItems.length}`,
      hint: "Comprometidas esta semana",
      tone: "green",
    },
    {
      label: "Bloqueios",
      value: String(boardBlockers),
      hint: boardBlockers === 0 ? "Nenhum agora" : sprintBlocked > 0 ? `${sprintBlocked} nesta sprint` : "Fora desta sprint",
      tone: boardBlockers === 0 ? "green" : "red",
    },
  ];

  return {
    branch,
    kpis,
    entregas,
    slices: sliceBlocks(slices, statusOf),
    columns,
    syncedAt,
  };
}

export async function getDashboard(fallbackColumns: SyncColumn[]): Promise<DashboardModel> {
  const snapshot = await getLatestBoardSnapshot();
  return buildDashboard(snapshot?.columns ?? fallbackColumns, snapshot?.syncedAt ?? null, snapshot?.slices ?? []);
}

// The "Sincronizar" button: pull GitHub Project #7 again, then rebuild everything from the Roadmap.
// If the GitHub part fails, the Roadmap part still refreshes over the last good snapshot, and the
// error is reported alongside.
// `notice` is what the sync did to the Roadmap and to the sprint, the same line the Roadmap tab shows, so a sync
// started here says what it moved too (and what it would write to the Project).
// `auto` is the page syncing by itself (see src/lib/auto-sync.ts): same work, the longer brake, and a notice only
// when the sync changed something. `cached` says the brake answered with the last snapshot (no news, no new error).
export async function syncDashboard(opts?: { auto?: boolean }): Promise<{ model: DashboardModel; error: string | null; notice: string | null; cached?: true }> {
  const auto = opts != null && typeof opts === "object" && opts.auto === true;
  const result = await syncBoardAsViewer({ auto });
  if (result.ok) {
    const error = result.roadmap.error ? `Kanban atualizado, mas o Roadmap não: ${result.roadmap.error}` : null;
    // The sync stored the sub-issues of the sprint with the board; read them back from there.
    const stored = await getLatestBoardSnapshot();
    const quiet = auto && (result.cached || !roadmapChanged(result.roadmap));
    return {
      model: await buildDashboard(result.columns, result.syncedAt, stored?.slices ?? []),
      error,
      notice: error || quiet ? null : result.cached ? brakeMessage(result.retryInMs) : roadmapSyncMessage(result.roadmap),
      ...(result.cached ? { cached: true as const } : {}),
    };
  }

  const snapshot = await getLatestBoardSnapshot();
  const error = syncFailureMessage(result);
  return { model: await buildDashboard(snapshot?.columns ?? [], snapshot?.syncedAt ?? null, snapshot?.slices ?? []), error, notice: null };
}
