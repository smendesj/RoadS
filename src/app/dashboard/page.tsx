import { NavBar } from "@/components/NavBar";
import { dashboardData } from "@/lib/mock-data";
import { badgeClass } from "@/lib/tones";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "RoadS — Dashboard" };

export default function DashboardPage() {
  const { branch, kpis, columns, entregas, paralelo, proxima } = dashboardData;

  return (
    <div className="min-h-screen">
      <NavBar active="dashboard" roleLabel="Dev" />

      <div className="flex flex-col gap-8 p-10">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-extrabold text-rs-text">Dashboard</h1>
            <p className="text-[15px] text-rs-text-soft">
              GeoCloud · <span className="font-mono">{branch}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-rs-border bg-rs-card px-3.5 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            <span className="text-[13px] text-rs-text-soft">Board sincronizado</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-5">
          {kpis.map((kpi) => (
            <a
              key={kpi.label}
              href="/roadmap"
              className="flex flex-col gap-2 rounded-2xl border border-rs-border bg-rs-card p-6 transition-shadow hover:shadow-lg"
            >
              <span className={badgeClass(kpi.tone) + " w-fit uppercase tracking-wide"}>{kpi.label}</span>
              <span className="text-4xl font-extrabold text-rs-text">{kpi.value}</span>
              <span className="text-[13px] text-rs-text-faint">{kpi.hint}</span>
            </a>
          ))}
        </div>

        <div className="flex flex-col gap-3.5">
          <span className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Kanban</span>
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
        </div>

        <div className="grid grid-cols-[2fr_1fr] items-start gap-5">
          <div className="flex flex-col gap-1 rounded-2xl border border-rs-border bg-rs-card p-7">
            <span className="mb-2 text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">
              Esta sprint · comprometido 7,5 dias
            </span>
            {entregas.map((e) => (
              <a
                key={e.ref}
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3.5 border-t border-rs-bg py-3.5"
              >
                <span className={badgeClass(e.tone) + " rounded-full whitespace-nowrap"}>{e.status}</span>
                <span className="flex-grow text-[15px] font-semibold text-rs-text">{e.title}</span>
                <span className="text-[13px] text-rs-text-faint">{e.effort}</span>
                <span className="font-mono text-[13px] text-rs-brand-text">{e.ref}</span>
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-6">
              <span className="text-[13px] font-bold uppercase tracking-wide text-rs-text-soft">Em paralelo</span>
              {paralelo.map((p) => (
                <a key={p.title} href={p.url} target="_blank" rel="noreferrer" className="border-t border-rs-bg py-2 text-sm text-rs-text">
                  {p.title}
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-rs-border bg-rs-card p-6">
              <span className="text-[13px] font-bold uppercase tracking-wide text-rs-brand-text">Próxima semana</span>
              {proxima.map((p) => (
                <div key={p.title} className="border-t border-rs-bg py-2 text-sm text-rs-text">
                  {p.title}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="py-3 text-center text-xs text-rs-text-faint">
          RoadS · dados reais do GitHub Projects, Essencis-Labs #7 · substitui a apresentação semanal
        </div>
      </div>
    </div>
  );
}
