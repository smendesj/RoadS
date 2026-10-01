// The "conferência" table: the numbers of the report, day by day, laid out so the person who sends the
// report can compare them with what they remember (and with Claude's own panel) before ticking "números
// conferidos". There is deliberately no "active time" column: a sum of short gaps undercounted a
// 13-hour day by half, so a day is shown by its sessions, its first and last prompt and its messages.
// Pure on purpose: no "server-only", no "@/" imports.
import { localDay, type ConferenceRow, type CoverageGap, type TokenCount, type UsageModel } from "../progress-report.ts";

/**
 * A row of the table. It is the contract's ConferenceRow plus three optional extras the screen can
 * use: the prompts typed by the person, the total by the OTHER counting method (so the screen can say
 * "tokens (reais): X · o painel /stats do Claude mostraria: Y"), and `warning`, set on the lines that
 * warn about a coverage gap instead of describing a day.
 *
 * Day rows come first, one per São Paulo day, in order; the warning lines follow, by time. Every
 * time field is an instant exactly as the collector sent it: show it with clockSP / sessionSpan.
 * A warning line has the day it belongs to in `date`, zeros everywhere else, and its whole text in
 * `note`, so a table that knows nothing about `warning` still prints it.
 */
export type ConferenceLine = ConferenceRow & {
  humanPrompts?: number;
  otherMethodTokens?: number;
  warning?: true;
};

/** Total tokens of a day, cache included (what Claude's own panel adds up too). */
export const totalTokens = (t: TokenCount): number => t.input + t.output + t.cacheRead + t.cacheWrite;

/* ---------- São Paulo time, for showing ---------- */

const CLOCK = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "HH:MM" in São Paulo (midnight is 00:00); "—" for something that is not an instant. */
export function clockSP(at: string | Date): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = CLOCK.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** "09:10–11:00": a session as the table shows it, in São Paulo time (it may end after midnight). */
export const sessionSpan = (s: { start: string; end: string }): string => `${clockSP(s.start)}–${clockSP(s.end)}`;

/** "2026-01-06" as "06/01". */
export function dayLabel(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[2]}/${m[1]}` : date;
}

/* ---------- the rows ---------- */

// A window of years would make a table nobody can read (and a loop nobody wants): cap what is listed.
const MAX_WINDOW_DAYS = 366;

const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The São Paulo days the half-open window [start, end) touches. Empty when the window cannot be read. */
function windowDays({ start, end }: UsageModel["window"]): string[] {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const last = localDay(new Date(to - 1));
  const days: string[] = [];
  for (let d = localDay(new Date(from)); d <= last && days.length < MAX_WINDOW_DAYS; d = nextDay(d)) days.push(d);
  return days;
}

// Unreadable instants go last instead of breaking the order of the rest.
const instant = (at: string): number => {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};
const byInstant = (a: string, b: string): number => (instant(a) < instant(b) ? -1 : instant(a) > instant(b) ? 1 : 0);

function gapLine(gap: CoverageGap): ConferenceLine {
  const readable = Number.isFinite(Date.parse(gap.at));
  const ref = gap.ref.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const when = readable ? `em ${dayLabel(localDay(gap.at))} às ${clockSP(gap.at)}` : "em data desconhecida";
  const near =
    gap.nearestMessageMinutes === null || !Number.isFinite(gap.nearestMessageMinutes)
      ? "sem nenhuma mensagem do Claude registrada no período"
      : `sem mensagem do Claude por perto (a mais próxima está a ${Math.round(gap.nearestMessageMinutes)} min)`;
  return {
    date: readable ? localDay(gap.at) : "",
    sessions: [],
    firstPromptAt: null,
    lastPromptAt: null,
    messages: 0,
    tokens: 0,
    note: `Aviso: trabalho no GitHub ${when} (${ref}) ${near}. Pode haver uso do Claude que não foi medido.`,
    warning: true,
  };
}

/**
 * One row per São Paulo day of the report window, a day without sessions included (with zeros: a
 * quiet day must be visible, not missing), then one warning line per coverage gap, by time. A day
 * that came with data from outside the window is listed too: nothing the collector counted may
 * vanish from the table the numbers are checked on. The `note` of a day comes from `usage.notes`.
 */
export function conferenceRows(usage: UsageModel, gaps: CoverageGap[] = []): ConferenceLine[] {
  const byDate = new Map(usage.days.map((d) => [d.date, d]));
  const dates = [...new Set([...windowDays(usage.window), ...usage.days.map((d) => d.date)])].sort();

  // A count the collector sent for some days is shown as 0 on the quiet ones, not left blank.
  const countsPrompts = usage.days.some((d) => d.humanPrompts !== undefined);
  const countsOther = usage.days.some((d) => d.otherMethodTokens !== undefined);

  const rows = dates.map((date): ConferenceLine => {
    const d = byDate.get(date);
    const note = (usage.notes ?? [])
      .filter((n) => n.date === date)
      .map((n) => n.text)
      .join(" · ");
    const humanPrompts = d?.humanPrompts ?? (countsPrompts ? 0 : undefined);
    const otherMethodTokens = d?.otherMethodTokens ?? (countsOther ? 0 : undefined);
    return {
      date,
      sessions: (d?.sessions ?? [])
        .map(({ start, end }) => ({ start, end }))
        .sort((a, b) => byInstant(a.start, b.start)),
      firstPromptAt: d?.firstPromptAt ?? null,
      lastPromptAt: d?.lastPromptAt ?? null,
      messages: d?.messages ?? 0,
      tokens: d ? totalTokens(d.tokens) : 0,
      ...(note ? { note } : {}),
      ...(humanPrompts !== undefined ? { humanPrompts } : {}),
      ...(otherMethodTokens !== undefined ? { otherMethodTokens } : {}),
    };
  });

  return [...rows, ...[...gaps].sort((a, b) => byInstant(a.at, b.at)).map(gapLine)];
}
