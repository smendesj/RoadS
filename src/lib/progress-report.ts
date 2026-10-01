// The contract of "Resumo para a diretoria": the short plain-language report the CEO gets by e-mail
// every two days. A pure module on purpose: no "server-only", no "@/" imports, no enums or JSX, and
// relative imports end in ".ts", so `node --experimental-strip-types` runs it and every track
// (collectors, ingest route, image, e-mail, screens) imports the very same types. Additive changes go
// through the lead only.
import type { Produto } from "./types.ts";

/** Absolute links inside an e-mail must point here, never at localhost or a preview deployment. */
export const PRODUCTION_ORIGIN = "https://roads-psi.vercel.app";

export const ENTRY_STATUSES = ["concluido", "em_validacao", "em_andamento", "bloqueado", "proximo"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const STATUS_LABEL: Record<EntryStatus, string> = {
  concluido: "Concluído",
  em_validacao: "Em validação",
  em_andamento: "Em andamento",
  bloqueado: "Bloqueado",
  proximo: "Próximo",
};

/** Half-open window [start, end): ISO strings with the -03:00 offset (São Paulo has no daylight saving). */
export type ReportWindow = { start: string; end: string };

/** The first window ever: the sprint the CEO asked about. */
const FIRST_WINDOW_START = "2026-09-28T00:00:00-03:00";

/** Calendar day (YYYY-MM-DD) of an instant, in São Paulo. */
export const localDay = (at: string | Date): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(at));

/**
 * The window of the next report: since the end of the last SENT report (not "the last 48 hours", so
 * nothing falls between two e-mails), up to today 00:00 in São Paulo, or up to now. Never negative.
 */
export function nextReportWindow(
  lastSentEnd: string | null,
  now: Date,
  opts: { includeToday?: boolean } = {}
): ReportWindow {
  const start = lastSentEnd ?? FIRST_WINDOW_START;
  const end = opts.includeToday ? now.toISOString() : `${localDay(now)}T00:00:00-03:00`;
  return { start, end: Date.parse(end) > Date.parse(start) ? end : start };
}

/** Days the report goes out, at the end of the day: Wednesday (Mon-Wed) and Friday (Thu-Fri). 0 = Sunday. */
export const SEND_WEEKDAYS: readonly number[] = [3, 5];

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) of an instant, in São Paulo. */
export const weekdaySP = (at: string | Date): number =>
  WEEKDAY_INDEX[new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date(at))] ?? -1;

export const isSendDay = (at: string | Date): boolean => SEND_WEEKDAYS.includes(weekdaySP(at));

/**
 * The window to collect now. On a send day the report is made at the end of that day, so that day's work
 * is in it (up to now); on any other day (a late report, or one prepared the morning after) it stops at
 * 00:00 of today, so yesterday is complete and today's work waits for the next report.
 */
export function defaultReportWindow(lastSentEnd: string | null, now: Date): ReportWindow {
  return nextReportWindow(lastSentEnd, now, { includeToday: isSendDay(now) });
}

/* ---------- Claude usage (numbers only: never prompts, answers, code or file paths) ---------- */

export type TokenCount = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * One working day of Claude use in São Paulo time. There is deliberately NO "active time" field: a
 * sum of short gaps undercounted a 13-hour day by half. The day is described by its sessions, its
 * first and last prompt (instants, never text) and its messages per hour.
 */
export type DayUsage = {
  date: string; // YYYY-MM-DD
  sessions: { start: string; end: string; messages: number; tokens: number }[];
  firstPromptAt: string | null;
  lastPromptAt: string | null;
  messages: number;
  humanPrompts?: number; // prompts typed by the person (slash commands and automatic notices excluded)
  tokens: TokenCount;
  /** Total tokens by the OTHER counting method, only to show in the conferência. */
  otherMethodTokens?: number;
  hourly: number[]; // 24 buckets of messages, hour 0..23
};

/**
 * How tokens and messages were counted. "stats" is what the /stats panel of Claude Code shows: one
 * count per content-block line, which inflates tokens about 2.5x. "real" counts each response of the
 * API once (what was actually served). The e-mail uses "real" unless the user chooses otherwise.
 */
export type CountMethod = "real" | "stats";

export type UsageModel = {
  /** Which work the usage counts. The issues of a report are always the product's; the usage may span several projects. */
  scope: string;
  /** Display names of the projects whose Claude use is counted (e.g. three connected ones); absent when just one. */
  products?: string[];
  window: ReportWindow;
  generatedAt: string;
  /** Title of the usage picture, set by the collector (e.g. "<Name> - AI usage"); the code never hard-codes a name. */
  label?: string;
  method?: CountMethod; // absent means "real"
  totals: { sessions: number; messages: number; humanPrompts?: number; activeDays: number; tokens: TokenCount };
  byModel: (TokenCount & { model: string; messages: number })[];
  favoriteModel: string | null;
  peakHour: number | null;
  days: DayUsage[];
  /** Caveats about what could not be measured, e.g. work done only from the phone in the cloud. */
  notes?: { date: string; text: string }[];
};

/** Git work (commit or merged PR) that no Claude message sits near: something is not being measured. */
export type CoverageGap = { at: string; ref: string; nearestMessageMinutes: number | null };

/** One line of the "conferência" table the user must tick before marking the report as sent. */
export type ConferenceRow = {
  date: string;
  sessions: { start: string; end: string }[];
  firstPromptAt: string | null;
  lastPromptAt: string | null;
  messages: number;
  tokens: number;
  note?: string;
  humanPrompts?: number; // prompts typed by the person that day
  otherMethodTokens?: number; // total by the OTHER counting method, to show "reais: X · o painel /stats mostraria: Y"
  warning?: true; // a coverage-gap warning line instead of a day (its whole text is in `note`)
};

/* ---------- The report ---------- */

/** A print of the product itself, already downscaled; at most two per report. */
export type Shot = { id: string; caption: string; mime: "image/jpeg" | "image/png"; data: string /* base64 */ };

export type ProgressEntry = {
  id: string; // "gc-<issue>": also the key edits are stored under
  issue: number; // the top-level issue (sub-issues are rolled up into it)
  status: EntryStatus;
  title: string; // plain language, at most 8 words
  summary: string; // plain language, one sentence
  deliveredAt: string | null; // instant the closing PR was merged: the delivery date
  subIssues: { total: number; done: number } | null;
  hidden: boolean;
  edited: boolean;
  sources: string[]; // issue and PR links, for the team, never printed in the e-mail body
};

export type ProgressContent = {
  window: ReportWindow;
  headline: string;
  entries: ProgressEntry[];
  internal: { count: number; text: string };
  difficulties: { id?: string; text: string; needs: string }[];
  nextSteps: { id?: string; text: string }[];
  usage: UsageModel;
  shots?: Shot[];
  gaps?: CoverageGap[];
};

/**
 * What the user changed in the screen, kept apart from what the collectors pushed, so pushing again
 * can never overwrite an edit. Keys: headline | internal | entry:<id>:(title|summary|status|hidden) |
 * difficulty:<id>:(text|needs|hidden) | nextStep:<id>:(text|hidden). `base` is the pushed text the
 * edit was made over; when a new push brings different text the screen flags "nova sugestão".
 */
export type Overrides = Record<string, { value: string | boolean; base?: string }>;

export type ProgressReportRow = {
  id: string;
  produto: Produto;
  period_start: string;
  period_end: string;
  status: "draft" | "sent";
  content: ProgressContent;
  overrides: Overrides;
  share_token: string;
  checked_at: string | null;
  sent_at: string | null;
  pushed_at: string;
  rev: number;
};

/* ---------- Seams other tracks code against ---------- */

export type LintIssue = { code: string; message: string };
/** "geral" is the plain-language text for the CEO; "ia" is the usage section, where "token" is allowed. */
export type LintSection = "geral" | "ia";
export type EmailOptions = { visualUrl: string; shotUrls: string[]; roadsUrl: string };
export type EmailBuild = { html: string; text: string };

/* ---------- Public image links (fetched by an e-mail client: no cookies, unguessable token) ---------- */

export const isShareToken = (s: string): boolean => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);

const version = (pushedAt: string): string => Date.parse(pushedAt).toString(36);

export const visualPath = (token: string, pushedAt: string): string =>
  `/api/progress-report/${token}/${version(pushedAt)}/visual.png`;

export const shotPath = (token: string, pushedAt: string, n: number, ext: "jpg" | "png"): string =>
  `/api/progress-report/${token}/${version(pushedAt)}/shot-${n}.${ext}`;
