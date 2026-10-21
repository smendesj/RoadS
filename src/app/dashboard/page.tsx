import { NavBar } from "@/components/NavBar";
import { DashboardBranch, DashboardSyncProvider, KpiCards, SprintPanels, SyncPill } from "@/components/DashboardSync";
import { getDashboard } from "@/lib/actions/dashboard";
import { getViewerOrReset } from "@/lib/get-viewer";
import { dashboardData } from "@/lib/mock-data";
import { DASHBOARD } from "@/lib/text/dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "RoadS — Dashboard" };

// Its server actions sync the board. A sync may run this long (SYNC_MAX_DURATION_S in src/lib/sync-cooldown.ts; Next reads only a literal here).
export const maxDuration = 300;

export default async function DashboardPage() {
  const viewer = await getViewerOrReset();
  const isAdmin = viewer?.role === "admin";

  // Everything comes from the Roadmap + the last GitHub sync; the mock columns (only the KPIs read them) fill in
  // before the very first sync ever ran.
  const model = await getDashboard(dashboardData.columns);

  return (
    <div className="min-h-screen">
      <NavBar active="dashboard" role={viewer?.role ?? null} avatar={viewer?.avatar ?? null} showConfig={isAdmin} />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:gap-8 lg:p-10">
        <DashboardSyncProvider initialModel={model} canSync={viewer?.role != null}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">{DASHBOARD.title}</h1>
              <p className="text-[15px] text-rs-text-soft">
                GeoCloud · <DashboardBranch />
              </p>
            </div>
            <SyncPill />
          </div>

          <KpiCards />

          <SprintPanels />
        </DashboardSyncProvider>

        <div className="py-3 text-center text-xs text-rs-text-faint">
          {DASHBOARD.footer}
        </div>
      </div>
    </div>
  );
}
