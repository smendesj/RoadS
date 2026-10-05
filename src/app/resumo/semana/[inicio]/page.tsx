import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeekPresentation } from "@/components/WeekPresentation";
import { shotPath } from "@/lib/progress-report";
import { reportPeriodLabel } from "@/lib/progress/report-view";
import { visualAlt, visualModel } from "@/lib/progress/visual";
import { combineWeek } from "@/lib/progress/week";
import { loadWeek, requireReportViewer, weekProduct, weekStartParam } from "../../data";

export const metadata: Metadata = { title: "RoadS — Semana" };

// The week's presentation, for the Monday scrum: the reports SENT in the week that starts on that Monday, put
// together (src/lib/progress/week.ts). Admin and scrum master, like the Resumo tab; everyone else is sent back.
// Reading goes through the user's own database session (Row Level Security), and only sent reports are asked
// for. A malformed date, a day that is not a Monday and a week with nothing sent all end the same way.
export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ inicio: string }>;
  searchParams: Promise<{ produto?: string | string[] }>;
}) {
  await requireReportViewer();
  const start = weekStartParam((await params).inicio);
  const produto = weekProduct((await searchParams).produto);
  if (!start || !produto) notFound();

  const { rows, failed } = await loadWeek(start, produto);
  if (failed) throw new Error("week read failed");
  if (rows.length === 0) notFound();

  const week = combineWeek(rows);
  const shotUrls = week.shotSources.map((s) => shotPath(s.token, s.pushedAt, s.n, s.ext));
  // The picture of the week's usage: the latest push of the week in the address, so a new report refreshes it.
  const version = Math.max(...rows.map((r) => Date.parse(r.pushed_at))).toString(36);
  const query = produto === "GeoCloud" ? `v=${version}` : `produto=${produto}&v=${version}`;
  return (
    <WeekPresentation
      produto={produto}
      content={week.content}
      shotUrls={shotUrls}
      visual={{ url: `/resumo/semana/${start}/uso?${query}`, title: visualModel(week.content).title, alt: visualAlt(week.content) }}
      periodLabel={reportPeriodLabel(week.content.window)}
    />
  );
}
