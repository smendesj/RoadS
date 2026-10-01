"use client";

import { useId, useMemo } from "react";
import type { UsageModel } from "@/lib/progress-report";
import { clockSP, conferenceRows, dayLabel, type ConferenceLine } from "@/lib/progress/conference";
import { formatStamp } from "@/lib/progress/report-view";
import { compactCount, visualTitle, wholeNumber } from "@/lib/progress/visual";

// The numbers are the picture's own (messages, input and output tokens, written the same way), day by
// day. The collector may also send the prompts typed by the person, which get a column when present.
type Row = ConferenceLine;

const th = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-rs-text-faint";
const num = "px-3 py-2.5 text-right tabular-nums";

// The numbers the e-mail leans on, day by day, and the box that unlocks "Marcar como enviado". The
// person ticking it is vouching that the numbers match what they know of the period; a new push of the
// draft cancels the tick (the page gets `checked` from the server, which already accounts for that).
export function ProgressReportConference({
  usage,
  checked,
  checkedAt,
  readOnly,
  busy,
  onToggle,
}: {
  usage: UsageModel;
  checked: boolean;
  checkedAt: string | null;
  readOnly: boolean;
  busy: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const boxId = useId();
  const hintId = useId();
  const rows = useMemo(() => conferenceRows(usage), [usage]);
  const days = rows.filter((r) => !r.warning);
  const showHuman = days.some((r) => r.humanPrompts !== undefined);
  const columns = 6 + (showHuman ? 1 : 0);

  const messages = days.reduce((sum, r) => sum + r.messages, 0);
  const input = days.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
  const output = days.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);

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

      {days.length === 0 ? (
        <p className="text-sm text-rs-text-faint">Sem dados de uso neste período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-rs-border">
          <table className="w-full min-w-[520px] text-[13px]" data-conference-table>
            <caption className="sr-only">Uso do Claude por dia, no horário de São Paulo</caption>
            <thead>
              <tr className="border-b border-rs-border bg-rs-lane">
                <th scope="col" className={th}>Dia</th>
                <th scope="col" className={th}>Primeiro pedido</th>
                <th scope="col" className={th}>Último pedido</th>
                <th scope="col" className={th + " text-right"}>Mensagens</th>
                {showHuman && <th scope="col" className={th + " text-right"}>Pedidos digitados</th>}
                <th scope="col" className={th + " text-right"}>Tokens de entrada</th>
                <th scope="col" className={th + " text-right"}>Tokens de saída</th>
              </tr>
            </thead>
            <tbody>
              {days.map((r) => (
                <DayRows key={r.date} row={r} columns={columns} showHuman={showHuman} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-rs-border bg-rs-lane font-bold text-rs-text">
                <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                <td />
                <td />
                <td className={num}>{wholeNumber(messages)}</td>
                {showHuman && <td />}
                <td className={num}>{compactCount(input)}</td>
                <td className={num}>{compactCount(output)}</td>
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

function DayRows({ row, columns, showHuman }: { row: Row; columns: number; showHuman: boolean }) {
  const quiet = row.messages === 0;
  return (
    <>
      <tr className={`border-b border-rs-bg align-top ${quiet ? "text-rs-text-faint" : "text-rs-text"}`}>
        <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold">{row.date ? dayLabel(row.date) : "—"}</th>
        <td className="px-3 py-2.5 tabular-nums">{row.firstPromptAt ? clockSP(row.firstPromptAt) : "—"}</td>
        <td className="px-3 py-2.5 tabular-nums">{row.lastPromptAt ? clockSP(row.lastPromptAt) : "—"}</td>
        <td className={num}>{wholeNumber(row.messages)}</td>
        {showHuman && <td className={num}>{row.humanPrompts === undefined ? "—" : wholeNumber(row.humanPrompts)}</td>}
        <td className={num}>{compactCount(row.inputTokens ?? 0)}</td>
        <td className={num}>{compactCount(row.outputTokens ?? 0)}</td>
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
