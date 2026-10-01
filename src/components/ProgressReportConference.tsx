"use client";

import { useId, useMemo } from "react";
import type { CoverageGap, UsageModel } from "@/lib/progress-report";
import { clockSP, conferenceRows, dayLabel, sessionSpan, type ConferenceLine } from "@/lib/progress/conference";
import { formatStamp } from "@/lib/progress/report-view";
import { visualTitle } from "@/lib/progress/visual";

// The collector may send more than the contract's columns (see conference.ts): the prompts typed by the
// person and the total by the other counting method get a column when present; coverage-gap warnings
// come as their own lines, after the days.
type Row = ConferenceLine;

const count = new Intl.NumberFormat("pt-BR");

const th = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-rs-text-faint";
const num = "px-3 py-2.5 text-right tabular-nums";

// The numbers the e-mail leans on, day by day, and the box that unlocks "Marcar como enviado". The
// person ticking it is vouching that the numbers match what they know of the period; a new push of the
// draft cancels the tick (the page gets `checked` from the server, which already accounts for that).
export function ProgressReportConference({
  usage,
  gaps,
  checked,
  checkedAt,
  readOnly,
  busy,
  onToggle,
}: {
  usage: UsageModel;
  gaps: CoverageGap[] | undefined;
  checked: boolean;
  checkedAt: string | null;
  readOnly: boolean;
  busy: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const boxId = useId();
  const hintId = useId();
  const rows = useMemo(() => conferenceRows(usage, gaps ?? []), [usage, gaps]);
  const days = rows.filter((r) => !r.warning);
  const warnings = rows.filter((r) => r.warning);
  const showHuman = days.some((r) => r.humanPrompts !== undefined);
  const showOther = days.some((r) => r.otherMethodTokens !== undefined);
  const columns = 6 + (showHuman ? 1 : 0) + (showOther ? 1 : 0);

  const sessions = days.reduce((sum, r) => sum + r.sessions.length, 0);
  const messages = days.reduce((sum, r) => sum + r.messages, 0);
  const tokens = days.reduce((sum, r) => sum + r.tokens, 0);

  return (
    <section aria-labelledby="conferencia-titulo" data-panel="conferencia" className="flex flex-col gap-3 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="conferencia-titulo" className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">
          Conferência dos números
        </h2>
        <p className="text-[13px] text-rs-text-soft">
          {visualTitle(usage.label)}, dia a dia, no horário de São Paulo. Compare com o que você sabe do período; se algo parecer
          estranho, não marque.
        </p>
      </div>

      {warnings.length > 0 && (
        <div role="note" data-conference-warnings className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <b>Avisos de cobertura.</b> Há trabalho no GitHub sem mensagens do Claude por perto: parte do trabalho pode não estar sendo medida.
          <ul className="mt-1.5 flex flex-col gap-1">
            {warnings.map((w, i) => (
              <li key={`${w.date}-${i}`}>{w.note}</li>
            ))}
          </ul>
        </div>
      )}

      {days.length === 0 ? (
        <p className="text-sm text-rs-text-faint">Sem dados de uso neste período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-rs-border">
          <table className="w-full min-w-[520px] text-[13px]" data-conference-table>
            <caption className="sr-only">Uso do Claude por dia, no horário de São Paulo</caption>
            <thead>
              <tr className="border-b border-rs-border bg-rs-lane">
                <th scope="col" className={th}>Dia</th>
                <th scope="col" className={th}>Sessões</th>
                <th scope="col" className={th}>Primeiro pedido</th>
                <th scope="col" className={th}>Último pedido</th>
                <th scope="col" className={th + " text-right"}>Mensagens</th>
                {showHuman && <th scope="col" className={th + " text-right"}>Pedidos digitados</th>}
                <th scope="col" className={th + " text-right"}>{showOther ? "Tokens (reais)" : "Tokens"}</th>
                {showOther && <th scope="col" className={th + " text-right"}>O painel /stats do Claude mostraria</th>}
              </tr>
            </thead>
            <tbody>
              {days.map((r) => (
                <DayRows key={r.date} row={r} columns={columns} showHuman={showHuman} showOther={showOther} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-rs-border bg-rs-lane font-bold text-rs-text">
                <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                <td className="px-3 py-2.5">{count.format(sessions)} {sessions === 1 ? "sessão" : "sessões"}</td>
                <td />
                <td />
                <td className={num}>{count.format(messages)}</td>
                {showHuman && <td />}
                <td className={num}>{count.format(tokens)}</td>
                {showOther && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-rs-bg pt-3">
        <div className="flex items-center gap-3">
          <input
            id={boxId}
            type="checkbox"
            data-field="checked"
            checked={checked}
            disabled={readOnly || busy}
            onChange={(e) => onToggle(e.target.checked)}
            aria-describedby={hintId}
            className="h-5 w-5 shrink-0 cursor-pointer accent-rs-brand disabled:cursor-not-allowed"
          />
          <label htmlFor={boxId} className="cursor-pointer text-sm font-bold text-rs-text">
            Conferi os números
          </label>
        </div>
        <p id={hintId} className="pl-8 text-[12px] text-rs-text-faint">
          {readOnly
            ? "Este resumo já foi enviado."
            : checked
              ? `Números conferidos${checkedAt ? ` em ${formatStamp(checkedAt)}` : ""}. Um novo envio do Claude cancela esta marca.`
              : "Enquanto não marcar, «Marcar como enviado» fica bloqueado."}
        </p>
      </div>
    </section>
  );
}

function DayRows({ row, columns, showHuman, showOther }: { row: Row; columns: number; showHuman: boolean; showOther: boolean }) {
  const quiet = row.sessions.length === 0 && row.messages === 0;
  return (
    <>
      <tr className={`border-b border-rs-bg align-top ${quiet ? "text-rs-text-faint" : "text-rs-text"}`}>
        <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">{row.date ? dayLabel(row.date) : "—"}</th>
        <td className="px-3 py-2.5">
          {row.sessions.length === 0 ? (
            "—"
          ) : (
            <ul className="flex flex-col gap-0.5">
              {row.sessions.map((s, i) => (
                <li key={i} className="whitespace-nowrap tabular-nums">{sessionSpan(s)}</li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-3 py-2.5 tabular-nums">{row.firstPromptAt ? clockSP(row.firstPromptAt) : "—"}</td>
        <td className="px-3 py-2.5 tabular-nums">{row.lastPromptAt ? clockSP(row.lastPromptAt) : "—"}</td>
        <td className={num}>{count.format(row.messages)}</td>
        {showHuman && <td className={num}>{row.humanPrompts === undefined ? "—" : count.format(row.humanPrompts)}</td>}
        <td className={num}>{count.format(row.tokens)}</td>
        {showOther && <td className={num}>{row.otherMethodTokens === undefined ? "—" : count.format(row.otherMethodTokens)}</td>}
      </tr>
      {row.note && (
        <tr className="border-b border-rs-bg">
          <td colSpan={columns} className="px-3 pb-2.5 pt-0 text-[12px] text-amber-800 dark:text-amber-300">
            {row.note}
          </td>
        </tr>
      )}
    </>
  );
}
