// The small pure rules behind the report screens (Dashboard card, /resumo header, e-mail preview).
// Kept apart from the components so they run under `node --test`: no "server-only", no "@/" imports.
import { ENTRY_STATUSES, localDay } from "../progress-report.ts";
import type { EntryStatus, ProgressContent, ProgressReportRow, ReportWindow } from "../progress-report.ts";

/** What the card and the page say to an admin when no report exists yet (nothing was ever pushed). */
export const EMPTY_REPORT_TEXT = "Nenhum rascunho ainda. Inicie o Frontlights e escolha atualizar o resumo para a diretoria.";
/** What a scrum master sees when nothing has been sent yet: they never see drafts. */
export const EMPTY_SENT_TEXT = "Nenhum resumo enviado ainda.";

const SAO_PAULO = "America/Sao_Paulo";

// Dates are spelled out part by part, never through a locale's own pattern: Node (the server) and each
// browser ship different ICU data, and a different separator would make React discard the server HTML
// when the client hydrates. The zone is explicit for the same reason.
const dayParts = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, day: "2-digit", month: "2-digit" });
const stampParts = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SAO_PAULO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23", // midnight is 00:00, never 24:00
});

const partsOf = (format: Intl.DateTimeFormat, iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  return Object.fromEntries(format.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
};

/** "30/09" in São Paulo, or a dash for anything that is not a date. */
export function formatDay(iso: string | null | undefined): string {
  const p = partsOf(dayParts, iso);
  return p ? `${p.day}/${p.month}` : "—";
}

/** "01/10/2026 12:05" in São Paulo, or a dash for anything that is not a date. */
export function formatStamp(iso: string | null | undefined): string {
  const p = partsOf(stampParts, iso);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "—";
}

/**
 * "28/09 a 29/09": the first and the last day the window includes. The window's end is exclusive (it is
 * midnight of the day after the last one), so the last day is the day of the instant just before it.
 * A one-day or empty window names a single day rather than a backwards range.
 */
export function reportPeriodLabel(window: ReportWindow): string {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const first = localDay(new Date(start));
  const last = localDay(new Date(end - 1));
  const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  return last > first ? `${dm(first)} a ${dm(last)}` : dm(first);
}

/** Entries per status as the e-mail will show them: hidden ones are not counted. */
export function statusCounts(content: Pick<ProgressContent, "entries">): Record<EntryStatus, number> {
  const counts = Object.fromEntries(ENTRY_STATUSES.map((s) => [s, 0])) as Record<EntryStatus, number>;
  for (const e of content.entries) if (!e.hidden) counts[e.status] += 1;
  return counts;
}

/**
 * Ticking "números conferidos" vouches for the numbers of ONE push. A newer push of the draft (which
 * moves pushed_at forward) voids it, even though checked_at is still on the row.
 */
export function isConferenceCurrent(row: Pick<ProgressReportRow, "checked_at" | "pushed_at">): boolean {
  if (!row.checked_at) return false;
  const checked = Date.parse(row.checked_at);
  const pushed = Date.parse(row.pushed_at);
  return Number.isFinite(checked) && Number.isFinite(pushed) && checked >= pushed;
}

/** Ids come from the address bar: only the exact shape of a uuid is worth a database round trip. */
export const isUuid = (s: string): boolean => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);

// A sandboxed frame without scripts still follows a link that is clicked, and the app refuses to be framed
// (X-Frame-Options): the preview would turn into an error page. The preview is for reading, so links are inert.
const INERT_LINKS = "<style>a{pointer-events:none;cursor:default}</style>";

/** The e-mail HTML as the preview frame shows it. Only the preview gets this; the copied e-mail is untouched. */
export function previewDocument(html: string): string {
  const after = (tag: RegExp) => {
    const m = tag.exec(html);
    return m ? m.index + m[0].length : -1;
  };
  // Inside <head>, or right after <html> (which opens an implied head), or after the doctype: never before
  // a doctype, which would flip the e-mail into quirks mode and change how its tables lay out.
  const at = [after(/<head(\s[^>]*)?>/i), after(/<html(\s[^>]*)?>/i), after(/^\s*<!doctype[^>]*>/i)].find((i) => i >= 0);
  return at === undefined ? INERT_LINKS + html : html.slice(0, at) + INERT_LINKS + html.slice(at);
}

// The reasons a server action gives for refusing (see ReviewFailure in review.ts), one sentence each.
const REFUSAL: Record<string, string> = {
  stale: "Este resumo mudou desde que você abriu a página (um novo envio ou outra pessoa editando). Recarregue a página para continuar.",
  sent: "Este resumo já foi enviado e não pode mais ser alterado.",
  not_checked: "Marque «Conferi os números» antes de marcar como enviado.",
  not_found: "Este resumo não foi encontrado. Recarregue a página.",
  empty: "Este campo não pode ficar vazio.",
  too_long: "O texto é longo demais. Encurte a frase.",
  invalid: "Esse valor não foi aceito.",
  invalid_key: "Esse valor não foi aceito.",
  invalid_value: "Esse valor não foi aceito.",
  invalid_status: "Esse valor não foi aceito.",
  unavailable: "Não foi possível salvar agora. Tente de novo em instantes.",
  forbidden: "Você não tem permissão para fazer isso.",
  unauthenticated: "Sua sessão terminou. Entre de novo para continuar.",
  must_reset_password: "Crie uma nova senha para continuar.",
};
const REFUSAL_FALLBACK = "Não foi possível salvar agora. Tente de novo.";

/** A refusal reason from a server action, as a sentence for the screen. Unknown reasons still read well. */
export function reasonMessage(reason: string | null | undefined): string {
  return typeof reason === "string" && Object.hasOwn(REFUSAL, reason) ? REFUSAL[reason] : REFUSAL_FALLBACK;
}
