import type { Metadata } from "next";
import { loadCurrentReport, loadSentList, requireReportViewer } from "./data";
import { ResumoScreen } from "./screen";

export const metadata: Metadata = { title: "RoadS — Resumo" };

// Admin and scrum master only: everyone else is sent back to the Dashboard. An admin reviews the draft;
// a scrum master only reads what was sent. Reading goes through the user's own database session, so Row
// Level Security says no on its own; the server actions the screen calls check the role again.
export default async function ResumoPage() {
  const viewer = await requireReportViewer();
  const [load, sent] = await Promise.all([loadCurrentReport(viewer.role), loadSentList()]);
  return <ResumoScreen viewer={viewer} load={load} sent={sent} isCurrentView />;
}
