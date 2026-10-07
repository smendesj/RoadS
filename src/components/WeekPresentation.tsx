"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STATUS_LABEL, type EntryStatus, type ProgressContent, type ProgressEntry } from "@/lib/progress-report";
import { amountLabel, openTitles, partsLabel, sprintChips } from "@/lib/progress/report-view";
import { placeShots, visibleOf } from "@/lib/progress/shot-place";

// The week of the Resumo, to present at the Monday scrum: the e-mail's content in the e-mail's order, as large
// as the screen allows. Nothing to check, edit, copy or send here. A fixed index jumps between the sections,
// "Tela cheia" hides the browser around it, and a print opens on its own over everything (Esc, the close button
// or a click closes it, and the focus goes back to the print). The usage picture's title and alt text come from
// the server, so the browser gets no drawing code.

type Zoom = { src: string; caption: string; from: HTMLElement | null } | null;

// Whether the page is in full screen, and whether it can be (an iPhone, for one, cannot: the button is then
// left out). Read from the browser; the server's answer is "no" to both.
const onFullScreenChange = (notify: () => void) => {
  document.addEventListener("fullscreenchange", notify);
  return () => document.removeEventListener("fullscreenchange", notify);
};
const never = () => () => {};

const SECTION = "scroll-mt-24 flex flex-col gap-6";
const H2 = "text-2xl font-extrabold uppercase tracking-wide text-rs-text-soft sm:text-3xl";
const STATUS_ACCENT: Record<EntryStatus, string> = {
  concluido: "border-green-600",
  em_validacao: "border-sky-600",
  em_andamento: "border-amber-500",
  bloqueado: "border-red-600",
  proximo: "border-rs-border",
};

function Print({ src, caption, product, onOpen }: { src: string; caption: string; product: string; onOpen: (z: Zoom) => void }) {
  return (
    <figure className="flex flex-col gap-2">
      <button type="button" data-print onClick={(e) => onOpen({ src, caption, from: e.currentTarget })} className="block cursor-zoom-in overflow-hidden rounded-xl border border-rs-border bg-white" aria-label={`Ampliar: ${caption || "print"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the image route answers by token; nothing to optimise */}
        <img src={src} alt={caption || `Tela do ${product}`} className="block h-auto w-full" />
      </button>
      {caption && <figcaption className="text-lg text-rs-text-soft sm:text-xl">{caption}</figcaption>}
    </figure>
  );
}

export function WeekPresentation({
  produto,
  content,
  shotUrls,
  visual,
  periodLabel,
}: {
  produto: string;
  content: ProgressContent;
  shotUrls: string[];
  visual: { url: string; title: string; alt: string };
  periodLabel: string;
}) {
  const [zoom, setZoom] = useState<Zoom>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const canFullScreen = useSyncExternalStore(never, () => Boolean(document.fullscreenEnabled), () => false);
  const isFullScreen = useSyncExternalStore(onFullScreenChange, () => Boolean(document.fullscreenElement), () => false);

  const closeZoom = () => {
    const from = zoom?.from;
    setZoom(null);
    from?.focus();
  };

  useEffect(() => {
    if (!zoom) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
      if (e.key === "Tab") {
        e.preventDefault(); // the close button is the only thing to reach while the print is open
        closeButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closeZoom only reads `zoom`, which is the dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const visible = visibleOf(content);
  const by = (s: EntryStatus) => visible.filter((e) => e.status === s);
  // The week brings the prints of every report it is made of: no cap of one e-mail here.
  const { shotsOf, general } = placeShots(content, shotUrls, (u) => (u ? u : null), Infinity);
  const done = by("concluido").length;
  const upcoming = by("proximo");
  // A week with a sprint block says its chips in words (and has no "Em validação" one); an older one keeps its own.
  const chips = sprintChips(content);
  const covers = (content.sprint?.epics ?? []).filter((c) => c.parts.remaining > 0);
  const headerChips: { id: EntryStatus; label: string }[] = chips
    ? [
        { id: "concluido", label: `${STATUS_LABEL.concluido}: ${amountLabel(chips.delivered.parts, chips.delivered.issues)}` },
        { id: "em_andamento", label: `${STATUS_LABEL.em_andamento}: ${amountLabel(chips.going.parts, chips.going.issues)}` },
        ...(chips.blocked > 0 ? [{ id: "bloqueado" as const, label: `${STATUS_LABEL.bloqueado}: ${chips.blocked}` }] : []),
      ]
    : (["concluido", "em_validacao", "em_andamento", "bloqueado"] as const)
        .filter((s) => s !== "bloqueado" || by("bloqueado").length > 0)
        .map((s) => ({ id: s, label: `${STATUS_LABEL[s]}: ${by(s).length}` }));

  const sections: { id: string; label: string; show: boolean }[] = [
    { id: "concluido", label: STATUS_LABEL.concluido, show: done > 0 },
    { id: "em_validacao", label: STATUS_LABEL.em_validacao, show: by("em_validacao").length > 0 },
    { id: "em_andamento", label: STATUS_LABEL.em_andamento, show: by("em_andamento").length > 0 },
    { id: "sprint", label: "Em andamento na sprint", show: covers.length > 0 },
    { id: "dificuldades", label: "Dificuldades", show: true },
    { id: "proximos", label: "Próximos passos", show: upcoming.length > 0 || content.nextSteps.length > 0 },
    { id: "uso", label: "Uso do Claude", show: true },
  ];

  const entryBlock = (e: ProgressEntry) => (
    <article key={e.id} data-entry={e.issue} className={`flex flex-col gap-4 border-l-8 pl-5 sm:pl-8 ${STATUS_ACCENT[e.status]}`}>
      <h3 className="text-3xl font-bold text-rs-text sm:text-4xl">{e.title}</h3>
      {e.summary && <p className="text-xl text-rs-text sm:text-2xl">{e.summary}</p>}
      {partsLabel(e.subIssues) && <p data-parts className="text-lg text-rs-text-soft sm:text-xl">{partsLabel(e.subIssues)}</p>}
      {shotsOf(e.issue).map(({ shot, src }) => (src ? <Print key={shot.id} src={src} caption={shot.caption} product={produto} onOpen={setZoom} /> : null))}
    </article>
  );

  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div data-week className="min-h-screen bg-rs-bg">
      <nav aria-label="Seções da semana" className="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rs-border bg-rs-card/95 px-4 py-3 backdrop-blur sm:px-10">
        <Link href="/resumo" className="text-sm font-semibold text-rs-text-soft hover:text-rs-brand-text">
          ← Resumo
        </Link>
        {sections
          .filter((s) => s.show)
          .map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-base font-bold text-rs-text hover:text-rs-brand-text">
              {s.label}
            </a>
          ))}
        {canFullScreen && (
          <button type="button" onClick={fullScreen} aria-pressed={isFullScreen} className="ml-auto rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white">
            {isFullScreen ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        )}
      </nav>

      <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-16 px-4 py-10 sm:px-10 lg:px-16">
        <header className="flex flex-col gap-4">
          <h1 className="text-4xl font-extrabold text-rs-text sm:text-6xl">{produto}: andamento da semana</h1>
          <p className="text-xl text-rs-text-soft sm:text-2xl">Período: {periodLabel}</p>
          <p data-week-headline className="text-2xl text-rs-text sm:text-4xl">{content.headline}</p>
          <ul className="flex flex-wrap gap-3">
            {headerChips.map((c) => (
              <li key={c.id} data-chip={c.id} className="rounded-full bg-rs-card px-5 py-2 text-lg font-bold text-rs-text sm:text-xl">
                {c.label}
              </li>
            ))}
          </ul>
        </header>

        {(["concluido", "em_validacao", "em_andamento"] as const).map((s) =>
          by(s).length > 0 ? (
            <section key={s} id={s} className={SECTION}>
              <h2 className={H2}>{STATUS_LABEL[s]}</h2>
              {by(s).map(entryBlock)}
            </section>
          ) : null
        )}

        {covers.length > 0 && (
          <section id="sprint" className={SECTION}>
            <h2 className={H2}>Em andamento na sprint</h2>
            {covers.map((c) => (
              <article key={c.issue} data-cover={c.issue} className="flex flex-col gap-3 border-l-8 border-amber-500 pl-5 sm:pl-8">
                <h3 className="text-3xl font-bold text-rs-text sm:text-4xl">{c.title}</h3>
                {c.summary && <p className="text-xl text-rs-text sm:text-2xl">{c.summary}</p>}
                <p className="text-lg text-rs-text-soft sm:text-xl">
                  {c.parts.done} de {c.parts.total} sub-issues
                </p>
                {openTitles(c.open) && <p className="text-lg text-rs-text-soft sm:text-xl">Restam: {openTitles(c.open)}</p>}
              </article>
            ))}
          </section>
        )}

        <section id="dificuldades" className={SECTION}>
          <h2 className={H2}>Dificuldades e bloqueios</h2>
          {by("bloqueado").length === 0 && content.difficulties.length === 0 && <p className="text-xl text-rs-text sm:text-2xl">Nenhum bloqueio.</p>}
          {by("bloqueado").map(entryBlock)}
          {content.difficulties.map((d, i) => (
            <div key={d.id ?? i} className="flex flex-col gap-1 text-xl text-rs-text sm:text-2xl">
              <p>• {d.text}</p>
              {d.needs && (
                <p className="pl-6">
                  <b>O que precisamos:</b> {d.needs}
                </p>
              )}
            </div>
          ))}
        </section>

        {(upcoming.length > 0 || content.nextSteps.length > 0) && (
          <section id="proximos" className={SECTION}>
            <h2 className={H2}>Próximos passos</h2>
            {upcoming.map((e) => (
              <p key={e.id} className="text-xl text-rs-text sm:text-2xl">
                • <b>{e.title}</b>
                {e.summary ? ` — ${e.summary}` : ""}
              </p>
            ))}
            {content.nextSteps.map((n, i) => (
              <p key={n.id ?? i} className="text-xl text-rs-text sm:text-2xl">
                • {n.text}
              </p>
            ))}
          </section>
        )}

        {content.internal.count > 0 && content.internal.text && <p className="text-lg text-rs-text-soft sm:text-xl">{content.internal.text}</p>}

        {general.some((g) => g.src) && (
          <section className={SECTION} aria-label="Outros prints">
            {general.map(({ shot, src }) => (src ? <Print key={shot.id} src={src} caption={shot.caption} product={produto} onOpen={setZoom} /> : null))}
          </section>
        )}

        <section id="uso" className={SECTION}>
          <h2 className={H2}>{visual.title}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn on demand by the week's own route */}
          <img src={visual.url} alt={visual.alt} className="block h-auto w-full max-w-5xl rounded-xl" />
          <dl className="grid max-w-5xl grid-cols-3 gap-4">
            {[
              { value: content.usage.totals.sessions, label: "sessões" },
              { value: content.usage.totals.messages, label: "mensagens" },
              { value: done, label: "entregas concluídas" },
            ].map((n) => (
              <div key={n.label} className="flex flex-col">
                <dt className="order-2 text-lg text-rs-text-soft">{n.label}</dt>
                <dd className="text-4xl font-extrabold text-rs-text">{n.value.toLocaleString("pt-BR")}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      {zoom && (
        <div role="dialog" aria-modal="true" aria-label={zoom.caption || "Print ampliado"} data-zoom onClick={closeZoom} className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/90 p-4">
          <button ref={closeButton} type="button" onClick={(e) => (e.stopPropagation(), closeZoom())} className="absolute right-4 top-4 rounded-lg bg-white/90 px-4 py-2 text-sm font-bold text-black">
            Fechar
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- same image, larger */}
          <img src={zoom.src} alt={zoom.caption || `Tela do ${produto}`} className="max-h-[90vh] max-w-full object-contain" />
          {zoom.caption && <p className="text-xl text-white">{zoom.caption}</p>}
        </div>
      )}
    </div>
  );
}
