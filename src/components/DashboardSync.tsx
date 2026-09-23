"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { badgeClass } from "@/lib/tones";
import { syncBoard, type SyncColumn } from "@/lib/actions/sync";

type SyncContextValue = {
  columns: SyncColumn[];
  syncedAt: string | null;
  error: string | null;
  isPending: boolean;
  sync: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside DashboardSyncProvider");
  return ctx;
}

export function DashboardSyncProvider({
  initialColumns,
  initialSyncedAt = null,
  children,
}: {
  initialColumns: SyncColumn[];
  initialSyncedAt?: string | null;
  children: ReactNode;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [syncedAt, setSyncedAt] = useState<string | null>(initialSyncedAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function sync() {
    setError(null);
    startTransition(async () => {
      const result = await syncBoard();
      if (result.ok) {
        setColumns(result.columns);
        setSyncedAt(result.syncedAt);
      } else if (result.reason === "not_configured") {
        setError("Sincronização ainda não configurada (falta GITHUB_TOKEN no servidor).");
      } else {
        setError(result.message ?? "Erro ao sincronizar.");
      }
    });
  }

  return <SyncContext.Provider value={{ columns, syncedAt, error, isPending, sync }}>{children}</SyncContext.Provider>;
}

export function SyncPill() {
  const { isPending, error, syncedAt, sync } = useSync();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={sync}
        disabled={isPending}
        className="flex items-center gap-2 rounded-full border border-rs-border bg-rs-card px-3.5 py-2 disabled:opacity-70"
      >
        <span className={`h-2 w-2 rounded-full bg-green-500 ${isPending ? "animate-pulse" : ""}`} />
        <span className="text-[13px] text-rs-text-soft">{isPending ? "Sincronizando..." : "Board sincronizado"}</span>
      </button>
      {error ? (
        <span className="max-w-[260px] text-right text-[11px] text-red-500">{error}</span>
      ) : (
        syncedAt && (
          <span className="text-[11px] text-rs-text-faint">
            Última sincronização: {new Date(syncedAt).toLocaleTimeString("pt-BR")}
          </span>
        )
      )}
    </div>
  );
}

export function KanbanColumns() {
  const { columns } = useSync();
  return (
    <div className="grid grid-cols-4 gap-5">
      {columns.map((col) => (
        <div key={col.key} className="flex flex-col gap-3 rounded-2xl border border-rs-border bg-rs-card p-4.5">
          <div className="flex items-center justify-between">
            <span className={badgeClass(col.tone)}>{col.title}</span>
            <span className="text-[13px] font-bold text-rs-text-faint">{col.count}</span>
          </div>
          <div className="flex flex-col gap-2">
            {col.items.map((it) => (
              <a
                key={it.ref}
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
              <div className="p-2.5 text-[13px] text-rs-text-faint">Nenhum bloqueio agora.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
