"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { markProgressReportSent, saveProgressEdit, setProgressChecked } from "@/lib/actions/progress";
import {
  PRODUCTION_ORIGIN,
  shotPath,
  visualPath,
  type EmailBuild,
  type LintIssue,
  type Overrides,
  type ProgressReportRow,
} from "@/lib/progress-report";
import { browserPorts, buildClipboardPayload, copyRich, copyText } from "@/lib/progress/clipboard";
import { buildEmail, emailSubject } from "@/lib/progress/email";
import { resolveContent, resolveFlags, resolveHidden, locateKey } from "@/lib/progress/resolve";
import { formatStamp, isConferenceCurrent, previewDocument, reasonMessage, reportPeriodLabel } from "@/lib/progress/report-view";
import { applyEdit } from "@/lib/progress/review";
import { ProgressReportConference } from "./ProgressReportConference";
import { ProgressReportEditor, type SaveEdit, type SaveOutcome } from "./ProgressReportEditor";

/* ---------- the e-mail, as the preview and the clipboard each need it ---------- */

// The preview points at the app's own image route (a relative path); the copy carries the production
// address, because the mail client that receives it fetches the images from there, not from localhost.
function emailFor(row: ProgressReportRow, overrides: Overrides, absolute: boolean): EmailBuild {
  const origin = absolute ? PRODUCTION_ORIGIN : "";
  return buildEmail(resolveContent({ content: row.content, overrides }), {
    visualUrl: origin + visualPath(row.share_token, row.pushed_at),
    shotUrls: (row.content.shots ?? []).map((shot, i) => origin + shotPath(row.share_token, row.pushed_at, i + 1, shot.mime === "image/png" ? "png" : "jpg")),
    roadsUrl: PRODUCTION_ORIGIN,
  });
}

/* ---------- answers of the server actions ---------- */

type Reply = { ok: true; rev: number; warnings?: LintIssue[] } | { ok: false; reason: string };

// What comes back from the server is checked once, here, so the rest of the screen deals with two shapes only.
// A thrown error (the action refuses outright, or the network drops) reads as "unavailable".
async function run(call: () => Promise<unknown>): Promise<Reply> {
  try {
    const r = (await call()) as { ok?: unknown; rev?: unknown; warnings?: unknown; reason?: unknown } | null;
    if (r && r.ok === true && typeof r.rev === "number") {
      return { ok: true, rev: r.rev, warnings: Array.isArray(r.warnings) ? (r.warnings as LintIssue[]) : undefined };
    }
    return { ok: false, reason: typeof r?.reason === "string" ? r.reason : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

type Notice = { tone: "ok" | "error"; text: string };

/* ---------- pieces ---------- */

const panel = "rounded-2xl border border-rs-border bg-rs-card";
const sectionTitle = "text-[13px] font-bold uppercase tracking-wide text-rs-text-soft";
const button =
  "rounded-lg px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rs-brand disabled:cursor-not-allowed disabled:opacity-50";

// A frame with scripts off. "allow-same-origin" is on purpose and harmless without "allow-scripts": the page
// can then keep the reader's scroll position when the text changes (the frame reloads with each edit), which
// it cannot do across an opaque origin. Nothing inside the frame can run code either way.
function PreviewFrame({ html, className }: { html: string; className: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const scrolledTo = useRef(0);

  // Runs after React has handed the frame its new document and before that document replaces the old one:
  // the old one still knows where the reader was.
  useLayoutEffect(() => {
    try {
      scrolledTo.current = frame.current?.contentWindow?.scrollY ?? 0;
    } catch {
      scrolledTo.current = 0;
    }
  }, [html]);

  return (
    <iframe
      ref={frame}
      title="Prévia do e-mail"
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={() => {
        try {
          frame.current?.contentWindow?.scrollTo(0, scrolledTo.current);
        } catch {
          // The frame is not reachable: it simply starts at the top.
        }
      }}
      style={{ colorScheme: "light" }}
      className={`w-full rounded-2xl border border-rs-border bg-white ${className}`}
    />
  );
}

function Seal({ sent, sentAt }: { sent: boolean; sentAt: string | null }) {
  return (
    <span
      data-seal={sent ? "sent" : "draft"}
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
        sent ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      }`}
    >
      {sent ? `Enviado em ${formatStamp(sentAt)}` : "Rascunho"}
    </span>
  );
}

function Facts({ row }: { row: ProgressReportRow }) {
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-rs-text-soft">
      <div className="flex gap-1.5">
        <dt>Período</dt>
        <dd className="font-semibold text-rs-text">{reportPeriodLabel({ start: row.period_start, end: row.period_end })}</dd>
      </div>
      {row.produto !== "GeoCloud" && (
        <div className="flex gap-1.5">
          <dt>Produto</dt>
          <dd className="font-semibold text-rs-text">{row.produto}</dd>
        </div>
      )}
      <div className="flex gap-1.5">
        <dt>Atualizado em</dt>
        <dd className="font-semibold text-rs-text">{formatStamp(row.pushed_at)}</dd>
      </div>
    </dl>
  );
}

/* ---------- the scrum master's view: the sent e-mail, to read ---------- */

function ReadOnlyPreview({ row }: { row: ProgressReportRow }) {
  const html = useMemo(() => previewDocument(emailFor(row, row.overrides ?? {}, false).html), [row]);
  return (
    <div className="flex flex-col gap-5">
      <div className={`${panel} flex flex-col gap-2.5 p-4 sm:p-6`}>
        <div className="flex flex-wrap items-center gap-3">
          <Seal sent sentAt={row.sent_at} />
        </div>
        <Facts row={row} />
      </div>
      <section aria-label="Prévia do e-mail" className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Prévia do e-mail</h2>
        <PreviewFrame html={html} className="h-[75vh]" />
      </section>
    </div>
  );
}

/* ---------- the admin's view: review, check, copy, mark as sent ---------- */

function ReviewPreview({ row }: { row: ProgressReportRow }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();

  const [overrides, setOverrides] = useState<Overrides>(row.overrides ?? {});
  const [checked, setChecked] = useState(isConferenceCurrent(row));
  const [checkedAt, setCheckedAt] = useState(row.checked_at);
  const [status, setStatus] = useState(row.status);
  const [sentAt, setSentAt] = useState(row.sent_at);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [stale, setStale] = useState(false);

  // Every change to the report carries the `rev` it was made over, and each one bumps it. So the actions
  // run one after another, each with the `rev` the previous one returned: tabbing from one field to the next
  // must not make the second save look stale.
  const revRef = useRef(row.rev);
  const overridesRef = useRef(overrides);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    setPending((n) => n + 1);
    const result = queue.current.then(task, task);
    queue.current = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => setPending((n) => n - 1));
  }

  function refuse(reason: string) {
    if (reason === "stale") setStale(true);
    setNotice({ tone: "error", text: reasonMessage(reason) });
  }

  const readOnly = status === "sent";
  const live = useMemo(() => ({ content: row.content, overrides }), [row.content, overrides]);
  const resolved = useMemo(() => resolveContent(live), [live]);
  const hidden = useMemo(() => resolveHidden(live), [live]);
  const flags = useMemo(() => new Set(resolveFlags(live)), [live]);
  const html = useMemo(() => previewDocument(emailFor(row, overrides, false).html), [row, overrides]);

  // One edit. The same rules the server applies run here first, so a refusal ("vazio", "longo demais")
  // shows at once; the server then decides for real, and only its "ok" changes what the screen holds.
  const save: SaveEdit = (key, value) =>
    enqueue<SaveOutcome>(async () => {
      const local = applyEdit(overridesRef.current, key, value, locateKey(row.content, key)?.pushed ?? "");
      if ("error" in local) return { ok: false, message: reasonMessage(local.error) };

      const reply = await run(() => saveProgressEdit({ id: row.id, rev: revRef.current, key, value }));
      if (!reply.ok) {
        if (reply.reason === "stale") setStale(true);
        return { ok: false, message: reasonMessage(reply.reason) };
      }
      revRef.current = reply.rev;
      overridesRef.current = local.overrides;
      setOverrides(local.overrides);
      return { ok: true, stored: local.overrides[key].value, warnings: reply.warnings ?? local.warnings };
    });

  function toggleChecked(next: boolean) {
    setChecked(next);
    setNotice(null);
    void enqueue(async () => {
      const reply = await run(() => setProgressChecked({ id: row.id, rev: revRef.current, checked: next }));
      if (!reply.ok) {
        setChecked(!next);
        return refuse(reply.reason);
      }
      revRef.current = reply.rev;
      setCheckedAt(next ? new Date().toISOString() : null);
    });
  }

  function markSent() {
    if (!window.confirm("Marcar este resumo como enviado? Depois disso ele fica congelado e não pode mais ser editado.")) return;
    setNotice(null);
    void enqueue(async () => {
      const reply = await run(() => markProgressReportSent({ id: row.id, rev: revRef.current }));
      if (!reply.ok) return refuse(reply.reason);
      revRef.current = reply.rev;
      setStatus("sent");
      setSentAt(new Date().toISOString());
      setNotice({ tone: "ok", text: "Marcado como enviado." });
      // Brings the stored stamps back; the page remounts this screen on the new `rev`.
      startRefresh(() => router.refresh());
    });
  }

  // Saves still on their way land first, so the copy always carries the last thing that was typed.
  async function copyEmail() {
    setNotice(null);
    await queue.current;
    const build = emailFor(row, overridesRef.current, true);
    if (build.html.trim() === "") return setNotice({ tone: "error", text: "Ainda não há e-mail para copiar." });
    const result = await copyRich(buildClipboardPayload(build), browserPorts());
    setNotice(
      result.ok
        ? { tone: "ok", text: "Copiado. Cole numa mensagem nova do Outlook." }
        : { tone: "error", text: "Não foi possível copiar automaticamente. Clique na prévia, use Ctrl+A e depois Ctrl+C." }
    );
  }

  async function copySubject() {
    setNotice(null);
    await queue.current;
    const subject = emailSubject(resolveContent({ content: row.content, overrides: overridesRef.current }));
    if (subject.trim() === "") return setNotice({ tone: "error", text: "Ainda não há assunto para copiar." });
    const result = await copyText(subject, browserPorts());
    setNotice(result.ok ? { tone: "ok", text: "Assunto copiado." } : { tone: "error", text: "Não foi possível copiar o assunto automaticamente." });
  }

  const busy = pending > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className={`${panel} flex flex-col gap-3 p-4 sm:p-6`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Seal sent={readOnly} sentAt={sentAt} />
          <Facts row={row} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => void copyEmail()} className={`${button} bg-rs-brand text-white hover:opacity-90`}>
            Copiar para o e-mail
          </button>
          <button type="button" onClick={() => void copySubject()} className={`${button} border border-rs-border bg-rs-card text-rs-text-soft hover:border-rs-brand hover:text-rs-brand-text`}>
            Copiar assunto
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={markSent}
              disabled={!checked || busy}
              aria-describedby="resumo-enviar-dica"
              className={`${button} border border-green-600 bg-green-600 text-white hover:bg-green-700 dark:border-green-500 dark:bg-green-700`}
            >
              Marcar como enviado
            </button>
          )}
        </div>

        {!readOnly && (
          <p id="resumo-enviar-dica" className="text-[12px] text-rs-text-faint">
            {checked
              ? "Depois de enviar o e-mail, marque como enviado: o resumo e a imagem do e-mail ficam congelados."
              : "Para liberar «Marcar como enviado», confira os números e marque «Conferi os números»."}
          </p>
        )}

        <p
          role="status"
          aria-live="polite"
          data-notice={notice?.tone ?? ""}
          className={`min-h-[1.25rem] text-[13px] font-semibold ${notice?.tone === "error" ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
        >
          {notice?.text ?? ""}
        </p>

        {stale && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <span>{reasonMessage("stale")}</span>
            <button type="button" onClick={() => startRefresh(() => router.refresh())} className="font-bold underline">
              Recarregar
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <section aria-label="Prévia do e-mail" className="flex flex-col gap-2 xl:sticky xl:top-4">
          <h2 className={sectionTitle}>Prévia do e-mail</h2>
          <PreviewFrame html={html} className="h-[70vh] xl:h-[calc(100vh-8rem)]" />
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <ProgressReportConference
            usage={resolved.usage}
            gaps={resolved.gaps}
            checked={checked}
            checkedAt={checkedAt}
            readOnly={readOnly}
            busy={busy}
            onToggle={toggleChecked}
          />
          <ProgressReportEditor
            raw={row.content}
            resolved={resolved}
            hidden={hidden}
            overrides={overrides}
            flags={flags}
            readOnly={readOnly}
            save={save}
          />
        </div>
      </div>
    </div>
  );
}

// The page remounts this (new key) whenever the report moves on, so the state above always starts from
// what the server holds. `canReview` is the admin; anyone else only ever gets a sent report to read.
export function ProgressReportPreview({ row, canReview }: { row: ProgressReportRow; canReview: boolean }) {
  return canReview ? <ReviewPreview row={row} /> : <ReadOnlyPreview row={row} />;
}
