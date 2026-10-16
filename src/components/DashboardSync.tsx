"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { SyncButton } from "@/components/SyncButton";
import { badgeClass } from "@/lib/tones";
import { syncDashboard, type DashboardModel } from "@/lib/actions/dashboard";
import { useAutoSync } from "@/lib/use-auto-sync";
import { useLocalTime } from "@/lib/use-local-time";

type SyncContextValue = {
  model: DashboardModel;
  error: string | null;
  notice: string | null;
  isPending: boolean;
  canSync: boolean;
  sync: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside DashboardSyncProvider");
  return ctx;
}

// Holds the whole Dashboard. "Sincronizar" pulls GitHub Project #7 and re-reads the Roadmap, so every block below
// reflects the latest state. The Kanban is no longer here: it is on the Roadmap, under the weeks.
export function DashboardSyncProvider({
  initialModel,
  canSync,
  children,
}: {
  initialModel: DashboardModel;
  canSync: boolean;
  children: ReactNode;
}) {
  const [model, setModel] = useState(initialModel);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function sync() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await syncDashboard();
        setModel(result.model);
        setError(result.error);
        setNotice(result.notice);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao sincronizar.");
      }
    });
  }

  // The page keeps itself in step with GitHub (src/lib/auto-sync.ts), quietly: no spinner, a notice only when the
  // sync changed something, and an answer from the brake leaves the last error standing (nothing was fixed). Never
  // while the button's own sync is under way.
  useAutoSync(() => {
    if (isPending) return;
    syncDashboard({ auto: true })
      .then((result) => {
        setModel(result.model);
        if (result.cached) return;
        setError(result.error);
        setNotice(result.notice);
      })
      .catch((e) => console.error("auto sync failed", e));
  }, canSync);

  return (
    <SyncContext.Provider value={{ model, error, notice, isPending, canSync, sync }}>{children}</SyncContext.Provider>
  );
}

export function DashboardBranch() {
  const { model } = useSync();
  return <span className="font-mono">{model.branch}</span>;
}

export function SyncPill() {
  const { isPending, error, notice, model, canSync, sync } = useSync();
  // Shown in the viewer's time zone, which only the browser knows: "—" holds the line until then.
  const syncedAt = useLocalTime(model.syncedAt);
  const lastSync = model.syncedAt && (
    <span className="text-[11px] text-rs-text-faint">Última sincronização: {syncedAt ?? "—"}</span>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      {canSync && <SyncButton onClick={sync} isPending={isPending} />}
      {error ? (
        <span className="max-w-[260px] text-right text-[11px] text-red-500">{error}</span>
      ) : (
        <>
          {notice && <span className="max-w-[260px] text-right text-[11px] text-rs-text-soft">{notice}</span>}
          {lastSync}
        </>
      )}
    </div>
  );
}

export function KpiCards() {
  const { model } = useSync();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-5">
      {model.kpis.map((kpi) => (
        <a
          key={kpi.label}
          href="/roadmap"
          className="flex flex-col gap-2 rounded-2xl border border-rs-border bg-rs-card p-4 transition-shadow hover:shadow-lg sm:p-6"
        >
          <span className={badgeClass(kpi.tone) + " w-fit uppercase tracking-wide"}>{kpi.label}</span>
          <span className="text-3xl font-extrabold text-rs-text sm:text-4xl">{kpi.value}</span>
          <span className="text-[13px] text-rs-text-faint">{kpi.hint}</span>
        </a>
      ))}
    </div>
  );
}

// The issues of the current sprint, each followed by its parts (src/lib/slices.ts): one indented row per box of its
// acceptance criteria (no link: the boxes are ticked on the issue) and one per sub-issue still open, with its link.
// "x de y" counts the parts by the rule of src/lib/parts.ts.
export function SprintPanels() {
  const { model } = useSync();
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-7">
      <span className="mb-2 text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Sprint</span>
      {model.entregas.map((e, i) => {
        const row = (
          <>
            <span className={badgeClass(e.tone) + " rounded-full whitespace-nowrap"}>{e.status}</span>
            <span className="order-first basis-full text-[15px] font-semibold text-rs-text sm:order-none sm:basis-0 sm:flex-grow">{e.title}</span>
            <span className="text-[13px] text-rs-text-faint">{e.effort}</span>
            {e.parts && (
              <span data-parts-count className="whitespace-nowrap text-[13px] text-rs-text-faint">
                {e.parts.done} de {e.parts.total}
              </span>
            )}
            <span className="font-mono text-[13px] text-rs-brand-text">{e.ref}</span>
          </>
        );
        const rowClass = "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 py-3.5 sm:flex-nowrap";
        return (
          <section key={`${e.url ?? e.title}|${i}`} data-issue className="flex flex-col border-t border-rs-bg">
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className={rowClass}>
                {row}
              </a>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
            {e.parts?.rows.map((part, j) => {
              const partClass = "flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-5 sm:flex-nowrap sm:pl-9";
              const inner = (
                <>
                  <span className={badgeClass(part.tone) + " rounded-full whitespace-nowrap"}>{part.status}</span>
                  <span className="order-first basis-full text-[14px] text-rs-text sm:order-none sm:basis-0 sm:flex-grow">{part.title}</span>
                  {part.ref && <span className="font-mono text-[12px] text-rs-brand-text">{part.ref}</span>}
                </>
              );
              return part.url ? (
                <a key={`${part.url}|${j}`} data-part="sub-issue" href={part.url} target="_blank" rel="noreferrer" className={partClass + " hover:opacity-80"}>
                  {inner}
                </a>
              ) : (
                <div key={`box|${j}`} data-part="box" className={partClass}>
                  {inner}
                </div>
              );
            })}
          </section>
        );
      })}
      {model.entregas.length === 0 && (
        <div className="border-t border-rs-bg py-3.5 text-sm text-rs-text-faint">Nenhum item na sprint atual.</div>
      )}
    </div>
  );
}
