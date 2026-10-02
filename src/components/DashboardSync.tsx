"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { SyncButton } from "@/components/SyncButton";
import { badgeClass } from "@/lib/tones";
import { syncDashboard, type DashboardModel } from "@/lib/actions/dashboard";
import { useLocalTime } from "@/lib/use-local-time";

type SyncContextValue = {
  model: DashboardModel;
  error: string | null;
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

// Holds the whole Dashboard. "Sincronizar" pulls GitHub Project #7 and re-reads the Roadmap
// (sprints + roadmap), so every block below — not only the Kanban — reflects the latest state.
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
  const [isPending, startTransition] = useTransition();

  function sync() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await syncDashboard();
        setModel(result.model);
        setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao sincronizar.");
      }
    });
  }

  return (
    <SyncContext.Provider value={{ model, error, isPending, canSync, sync }}>{children}</SyncContext.Provider>
  );
}

export function DashboardBranch() {
  const { model } = useSync();
  return <span className="font-mono">{model.branch}</span>;
}

export function SyncPill() {
  const { isPending, error, model, canSync, sync } = useSync();
  // Shown in the viewer's time zone, which only the browser knows: "—" holds the line until then.
  const syncedAt = useLocalTime(model.syncedAt);
  const lastSync = model.syncedAt && (
    <span className="text-[11px] text-rs-text-faint">Última sincronização: {syncedAt ?? "—"}</span>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      {canSync && <SyncButton onClick={sync} isPending={isPending} />}
      {error ? <span className="max-w-[260px] text-right text-[11px] text-red-500">{error}</span> : lastSync}
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

// reportSlot is the server-drawn "Resumo para a diretoria" card (admin only); it sits right under
// "Em paralelo". A server component can't be imported in this client file, so the page hands it in.
export function SprintPanels({ reportSlot }: { reportSlot?: ReactNode }) {
  const { model } = useSync();
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-1 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-7">
        <span className="mb-2 text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Esta sprint</span>
        {model.entregas.map((e) => {
          const row = (
            <>
              <span className={badgeClass(e.tone) + " rounded-full whitespace-nowrap"}>{e.status}</span>
              <span className="order-first basis-full text-[15px] font-semibold text-rs-text sm:order-none sm:basis-0 sm:flex-grow">{e.title}</span>
              <span className="text-[13px] text-rs-text-faint">{e.effort}</span>
              <span className="font-mono text-[13px] text-rs-brand-text">{e.ref}</span>
            </>
          );
          return e.url ? (
            <a key={e.title} href={e.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-rs-bg py-3.5 sm:flex-nowrap">
              {row}
            </a>
          ) : (
            <div key={e.title} className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-rs-bg py-3.5 sm:flex-nowrap">
              {row}
            </div>
          );
        })}
        {model.entregas.length === 0 && (
          <div className="border-t border-rs-bg py-3.5 text-sm text-rs-text-faint">Nenhum item na sprint atual.</div>
        )}
      </div>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6">
          <span className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Em paralelo</span>
          {model.paralelo.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="border-t border-rs-bg py-2 text-sm text-rs-text">
              {p.title} <span className="font-mono text-[12px] text-rs-text-faint">{p.ref}</span>
            </a>
          ))}
          {model.paralelo.length === 0 && (
            <div className="border-t border-rs-bg py-2 text-sm text-rs-text-faint">Nada em andamento fora da sprint.</div>
          )}
        </div>
        {reportSlot}
        <div className="flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6">
          <span className="text-[13px] font-bold uppercase tracking-wide text-rs-brand-text">Próxima semana</span>
          {model.proxima.map((p) => (
            <div key={p.title} className="border-t border-rs-bg py-2 text-sm text-rs-text">
              {p.title} · {p.effort}
            </div>
          ))}
          {model.proxima.length === 0 && (
            <div className="border-t border-rs-bg py-2 text-sm text-rs-text-faint">Nada planejado ainda.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function KanbanColumns() {
  const { model } = useSync();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
      {model.columns.map((col) => (
        <div key={col.key} className="flex flex-col gap-3 rounded-2xl border border-rs-border bg-rs-card p-4.5">
          <div className="flex items-center justify-between">
            <span className={badgeClass(col.tone)}>{col.title}</span>
            <span className="text-[13px] font-bold text-rs-text-faint">{col.count}</span>
          </div>
          {/* Every issue in the column; the list caps at ~5 cards tall and scrolls for the rest. */}
          <div className="-mr-2 flex max-h-[320px] flex-col sm:max-h-[440px] gap-2 overflow-y-auto pr-2">
            {col.items.map((it) => (
              <a
                key={it.url}
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-[10px] bg-rs-lane p-2.5 text-[13px] text-rs-text hover:opacity-80"
              >
                {it.title}
                <div className="mt-0.5 font-mono text-[11px] text-rs-text-faint">{it.ref}</div>
              </a>
            ))}
            {col.items.length === 0 && (
              <div className="p-2.5 text-[13px] text-rs-text-faint">
                {col.key === "blocker" ? "Nenhum bloqueio agora." : "Nenhuma issue aqui."}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
