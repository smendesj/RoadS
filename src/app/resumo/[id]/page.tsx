import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/progress/report-view";
import { loadReportById, loadSentList, requireReportViewer } from "../data";
import { ResumoScreen } from "../screen";

export const metadata: Metadata = { title: "RoadS — Resumo" };

// One report by id, of any product. Next 16 hands `params` over as a Promise. A malformed id, an id that
// does not exist and (for a scrum master) the id of a draft all end the same way: not found.
export default async function ResumoByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireReportViewer();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [load, sent] = await Promise.all([loadReportById(id, viewer.role), loadSentList()]);
  if (!load.failed && !load.row) notFound();
  return <ResumoScreen viewer={viewer} load={load} sent={sent} isCurrentView={false} />;
}
