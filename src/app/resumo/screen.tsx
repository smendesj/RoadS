import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { ProgressReportPreview } from "@/components/ProgressReportPreview";
import { EMPTY_REPORT_TEXT, EMPTY_SENT_TEXT, formatStamp, reportPeriodLabel } from "@/lib/progress/report-view";
import { roleLabel, type Viewer } from "@/lib/viewer";
import { groupByWeek } from "@/lib/progress/week";
import { canReview, type ReportLoad, type SentSummary } from "./data";

const panel = "flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6";

function SentLink({ item, currentId }: { item: SentSummary; currentId: string | null }) {
  return (
    <Link
      href={`/resumo/${item.id}`}
      aria-current={item.id === currentId ? "page" : undefined}
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm hover:text-rs-brand-text ${
        item.id === currentId ? "font-bold text-rs-brand-text" : "text-rs-text"
      }`}
    >
      <span className="font-semibold">{reportPeriodLabel({ start: item.period_start, end: item.period_end })}</span>
      <span className="text-[13px] text-rs-text-faint">enviado em {formatStamp(item.sent_at)}</span>
    </Link>
  );
}

// The sent reports in weeks (Monday to Sunday). Between the reports of a week, centred, the link to present
// the whole week at the scrum; a week with one report so far has it right under that report.
function SentList({ sent, currentId }: { sent: { list: SentSummary[]; failed: boolean }; currentId: string | null }) {
  if (sent.failed) {
    return <p className="text-[13px] text-rs-text-faint">Não foi possível carregar a lista dos resumos enviados.</p>;
  }
  if (sent.list.length === 0) return null;
  return (
    <section aria-labelledby="resumo-enviados" className={panel}>
      <h2 id="resumo-enviados" className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">
        Enviados
      </h2>
      <div className="flex flex-col gap-3">
        {groupByWeek(sent.list).map((week) => {
          const middle = Math.ceil(week.items.length / 2);
          const present = (
            <li key="present" className="flex justify-center py-1.5">
              <Link
                href={`/resumo/semana/${week.start}`}
                data-present-week={week.start}
                className="rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white hover:opacity-90"
              >
                <span aria-hidden="true">▶ </span>Apresentar a semana
              </Link>
            </li>
          );
          const items = week.items.map((item) => (
            <li key={item.id} className="border-t border-rs-bg first:border-t-0">
              <SentLink item={item} currentId={currentId} />
            </li>
          ));
          return (
            <div key={week.start} data-week-group={week.start} className="rounded-xl border border-rs-border px-3 py-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-rs-text-faint">{week.label}</h3>
              <ul className="flex flex-col">{[...items.slice(0, middle), present, ...items.slice(middle)]}</ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The page of the Resumo tab, shared by /resumo (the current report) and /resumo/[id] (one report).
// The viewer was already checked by the page: this only draws. An admin gets the review screen; a scrum
// master gets the e-mail of a report that was already sent, to read and nothing else.
export function ResumoScreen({
  viewer,
  load,
  sent,
  isCurrentView,
}: {
  viewer: Viewer;
  load: ReportLoad;
  sent: { list: SentSummary[]; failed: boolean };
  /** True on /resumo: when the report on show was already sent, say that no newer draft exists. */
  isCurrentView: boolean;
}) {
  const { failed } = load;
  const reviewer = canReview(viewer.role);
  // The queries already leave drafts out for a scrum master; this keeps the screen right even if that ever slipped.
  const row = reviewer || load.row?.status === "sent" ? load.row : null;

  return (
    <div className="min-h-screen">
      <NavBar active="resumo" roleLabel={roleLabel(viewer.role)} avatar={viewer.avatar} showConfig={viewer.role === "admin"} />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">Resumo</h1>
          <p className="max-w-3xl text-[15px] text-rs-text-soft">
            {reviewer
              ? "Andamento do GeoCloud."
              : "Andamento do GeoCloud. Somente leitura."}
          </p>
        </div>

        {failed ? (
          <p role="alert" className={`${panel} text-sm text-rs-text-soft`}>
            Não foi possível carregar o resumo agora. Recarregue a página em instantes.
          </p>
        ) : !row ? (
          <p data-report-empty className={`${panel} text-sm text-rs-text-soft`}>
            {reviewer ? EMPTY_REPORT_TEXT : EMPTY_SENT_TEXT}
          </p>
        ) : (
          <>
            {reviewer && isCurrentView && row.status === "sent" && (
              <p className="rounded-xl border border-rs-border bg-rs-brand-soft px-4 py-3 text-[13px] text-rs-text">
                Este é o último resumo enviado. Quando o Frontlights enviar um novo rascunho, ele aparece aqui.
              </p>
            )}
            {/* The key restarts the editor from fresh server data whenever the report moves on (a new push, or after sending). */}
            <ProgressReportPreview key={`${row.id}:${row.rev}`} row={row} canReview={reviewer} />
          </>
        )}

        <SentList sent={sent} currentId={row?.id ?? null} />
      </div>
    </div>
  );
}
