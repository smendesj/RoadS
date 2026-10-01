import Link from "next/link";
import { loadCardReport } from "@/app/resumo/data";
import { ENTRY_STATUSES, STATUS_LABEL, type EntryStatus } from "@/lib/progress-report";
import { resolveContent } from "@/lib/progress/resolve";
import { EMPTY_REPORT_TEXT, formatStamp, isConferenceCurrent, reportPeriodLabel, statusCounts } from "@/lib/progress/report-view";
import { badgeClass, type Tone } from "@/lib/tones";

const STATUS_TONE: Record<EntryStatus, Tone> = {
  concluido: "green",
  em_validacao: "amber",
  em_andamento: "indigo",
  bloqueado: "red",
  proximo: "neutral",
};

const shell = "flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6";
const title = "text-[13px] font-bold uppercase tracking-wide text-rs-text-soft";

// The Dashboard's "Resumo para a diretoria" card, drawn on the server (it reads the report with the viewer's
// own session). Only the Dashboard page asks for it, and only for the admin, who reviews the drafts.
export async function ProgressReportCard() {
  const { row, failed } = await loadCardReport();

  // A failed read must never take the whole Dashboard down (the table may not exist yet, for one).
  if (failed) {
    return (
      <section aria-labelledby="resumo-card" data-report-card className={shell}>
        <h2 id="resumo-card" className={title}>Resumo para a diretoria</h2>
        <p className="border-t border-rs-bg py-2 text-sm text-rs-text-faint">Não foi possível carregar o resumo agora.</p>
      </section>
    );
  }

  if (!row) {
    return (
      <section aria-labelledby="resumo-card" data-report-card className={shell}>
        <h2 id="resumo-card" className={title}>Resumo para a diretoria</h2>
        <p className="border-t border-rs-bg py-2 text-sm text-rs-text-faint">{EMPTY_REPORT_TEXT}</p>
      </section>
    );
  }

  const content = resolveContent(row);
  const counts = statusCounts(content);
  const sent = row.status === "sent";
  const conferred = sent || isConferenceCurrent(row);

  return (
    <section aria-labelledby="resumo-card" data-report-card className={shell}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="resumo-card" className={title}>Resumo para a diretoria</h2>
        <span className={badgeClass(sent ? "green" : "amber") + " rounded-full whitespace-nowrap"}>{sent ? "Enviado" : "Rascunho"}</span>
      </div>

      <div className="border-t border-rs-bg pt-2.5 text-[15px] font-semibold text-rs-text">{reportPeriodLabel(content.window)}</div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Entradas por situação">
        {ENTRY_STATUSES.filter((s) => counts[s] > 0).map((s) => (
          <li key={s} className={badgeClass(STATUS_TONE[s]) + " gap-1"}>
            {STATUS_LABEL[s]} <b>{counts[s]}</b>
          </li>
        ))}
        {ENTRY_STATUSES.every((s) => counts[s] === 0) && <li className="text-[13px] text-rs-text-faint">Nenhuma entrada visível.</li>}
      </ul>

      <div className={`text-[13px] font-semibold ${conferred ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
        {conferred ? "Números conferidos" : "Falta conferir"}
      </div>

      <div className="text-[12px] text-rs-text-faint">
        {sent && row.sent_at ? `Enviado em ${formatStamp(row.sent_at)} · ` : ""}Atualizado em {formatStamp(row.pushed_at)}
      </div>

      <Link href="/resumo" className="w-fit text-[13px] font-bold text-rs-brand-text hover:underline">
        Abrir
      </Link>
    </section>
  );
}
