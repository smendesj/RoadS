// The period a collector reads, given either as São Paulo calendar days (`--from`/`--to`, the last day
// included) or as exact instants (`--start`/`--end`, half-open [start, end)). Instants are how one report
// picks up exactly where the previous one stopped: its `--start` is the previous report's `period_end`,
// so work done on a send day after the numbers were collected falls into the next report, not into none.
// Pure on purpose: no "server-only", no "@/" imports.
import type { ReportWindow } from "../progress-report.ts";

const SAO_PAULO_MS = -3 * 3_600_000;

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Seconds are optional (20:05 is 20:05:00); a fraction is accepted down to the millisecond, which is all a
// JavaScript instant (and the stored period) holds; further digits must be zeros. The offset is mandatory.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

export const INSTANT_EXAMPLE = "2026-10-07T20:05:12-03:00";

/**
 * Epoch milliseconds of an ISO-8601 instant WITH an explicit offset (or Z) on a day that exists; null
 * otherwise. Date.parse alone is not enough: it rolls "02-30" over to March and reads a bare
 * "2026-10-07T20:05" as the machine's local time, which is exactly the ambiguity refused here.
 */
export function parseInstant(value: string): number | null {
  const m = INSTANT.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const fraction = m[7] ?? "";
  if (/[1-9]/.test(fraction.slice(3))) return null; // finer than a millisecond: it could not be kept as given
  const offsetOk = m[8] === "Z" || (Number(m[9]) <= 14 && Number(m[10]) <= 59);
  const valid =
    year >= 2000 && year <= 2199 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetOk;
  if (!valid) return null;
  const sign = m[8] === "Z" ? 0 : m[8].startsWith("-") ? -1 : 1;
  const offsetMs = sign * (Number(m[9] ?? 0) * 60 + Number(m[10] ?? 0)) * 60_000;
  const ms = Number(fraction.slice(0, 3).padEnd(3, "0"));
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMs;
}

/**
 * The same instant written with the -03:00 offset the report windows use, e.g. "2026-10-07T20:05:12-03:00";
 * the milliseconds are kept when there are any ("2026-10-07T20:05:12.345-03:00"), so the instant never moves.
 */
export function saoPauloInstant(ms: number): string {
  const iso = new Date(ms + SAO_PAULO_MS).toISOString();
  return ms % 1000 === 0 ? iso.replace(/\.\d{3}Z$/, "-03:00") : iso.replace(/Z$/, "-03:00");
}

/** `--start` and `--end` as a half-open window [start, end), written with the -03:00 offset. */
export function windowFromInstants(start: string, end: string): { ok: true; window: ReportWindow } | { ok: false; error: string } {
  const a = parseInstant(start);
  if (a === null) return { ok: false, error: `--start: instante inválido («${start}»). Use data e hora ISO com o deslocamento, por exemplo ${INSTANT_EXAMPLE} ou 2026-10-07T23:05:12Z.` };
  const b = parseInstant(end);
  if (b === null) return { ok: false, error: `--end: instante inválido («${end}»). Use data e hora ISO com o deslocamento, por exemplo ${INSTANT_EXAMPLE} ou 2026-10-07T23:05:12Z.` };
  if (b <= a) return { ok: false, error: "--end precisa ser depois de --start (o período vai de --start, incluído, até --end, excluído)." };
  return { ok: true, window: { start: saoPauloInstant(a), end: saoPauloInstant(b) } };
}

/** Which of the two ways of naming the period the command line used, or what is wrong with it. */
export type PeriodArgs = { from?: string; to?: string; start?: string; end?: string };
export type PeriodChoice = { kind: "days"; from: string; to: string } | { kind: "instants"; start: string; end: string };

/**
 * Days (`--from`/`--to`) or instants (`--start`/`--end`), never both, and each pair whole. Only the shape of
 * the command line is judged here; the values are checked by whoever turns them into a window.
 */
export function choosePeriod(args: PeriodArgs): { ok: true; period: PeriodChoice } | { ok: false; error: string } {
  const days = args.from !== undefined || args.to !== undefined;
  const instants = args.start !== undefined || args.end !== undefined;
  if (days && instants) return { ok: false, error: "Use --from/--to (dias) ou --start/--end (instantes), não os dois juntos." };
  if (instants) {
    if (args.start === undefined || args.end === undefined) return { ok: false, error: "--start e --end andam juntos: informe os dois." };
    return { ok: true, period: { kind: "instants", start: args.start, end: args.end } };
  }
  if (args.from === undefined || args.to === undefined) return { ok: false, error: "Faltam --from e --to (dias, AAAA-MM-DD) ou --start e --end (instantes ISO com deslocamento)." };
  return { ok: true, period: { kind: "days", from: args.from, to: args.to } };
}

const SP_LABEL = (ms: number): string => {
  const iso = new Date(ms + SAO_PAULO_MS).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
};

/** "07/10/2026 20:05 a 09/10/2026 20:10" (São Paulo time; the end is excluded). Null when the window is unreadable. */
export function instantRangeLabel(window: ReportWindow): string | null {
  const a = Date.parse(window.start);
  const b = Date.parse(window.end);
  return Number.isFinite(a) && Number.isFinite(b) ? `${SP_LABEL(a)} a ${SP_LABEL(b)}` : null;
}
