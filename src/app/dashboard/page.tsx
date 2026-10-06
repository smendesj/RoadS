import { NavBar } from "@/components/NavBar";
import { DashboardBranch, DashboardSyncProvider, KanbanColumns, KpiCards, SlicesPanel, SprintPanels, SyncPill } from "@/components/DashboardSync";
import { getDashboard } from "@/lib/actions/dashboard";
import { getViewerOrReset } from "@/lib/get-viewer";
import { dashboardData } from "@/lib/mock-data";
import { roleLabel as labelFor } from "@/lib/viewer";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "RoadS — Dashboard" };

export default async function DashboardPage() {
  const viewer = await getViewerOrReset();
  const roleLabel = labelFor(viewer?.role ?? null);
  const isAdmin = viewer?.role === "admin";

  // Everything comes from the Roadmap + the last GitHub sync; the mock columns only fill in
  // before the very first sync ever ran.
  const model = await getDashboard(dashboardData.columns);

  return (
    <div className="min-h-screen">
      <NavBar active="dashboard" roleLabel={roleLabel} avatar={viewer?.avatar ?? null} showConfig={isAdmin} />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:gap-8 lg:p-10">
        <DashboardSyncProvider initialModel={model} canSync={roleLabel !== "Visitante"}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">Dashboard</h1>
              <p className="text-[15px] text-rs-text-soft">
                GeoCloud · <DashboardBranch />
              </p>
            </div>
            <SyncPill />
          </div>

          <KpiCards />

          <SprintPanels />

          <SlicesPanel />

          <div className="flex flex-col gap-3.5">
            <span className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Kanban</span>
            <KanbanColumns />
          </div>
        </DashboardSyncProvider>

        <div className="py-3 text-center text-xs text-rs-text-faint">
          RoadS · dados reais do GitHub Projects, Essencis-Labs #7 no KANBAN
        </div>
      </div>
    </div>
  );
}
