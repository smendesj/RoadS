// The week of the Resumo, for the Monday scrum: the reports SENT in one week (Monday to Sunday, São Paulo
// time, by the day each period ENDS) put together into one, to present. A period starts where the one before
// it stopped, so after a late report it may start on the weekend before the week it reports on; the day it
// ends is the one that says which week it belongs to. Calculated on every read, never stored, so it exists the
// moment a report of the week is marked as sent. Pure on purpose: the screens and the tests use it.
//
// What the week shows: each delivery once, as the latest report of the week that SHOWED it left it
// (the user's edits applied; a delivery hidden in every report stays out); the difficulties and next steps
// of the latest report; the internal work and Claude's usage added up; an opening line made from the
// counts; the prints of every report, each served by the link of its own report. Nothing the e-mails do not
// have, and none of their sign-in details.
import type { DayUsage, EntryStatus, Overrides, ProgressContent, ProgressEntry, Shot, TokenCount, UsageModel } from "../progress-report.ts";
import { resolveContent } from "./resolve.ts";
import { isShown, visibleOf } from "./shot-place.ts";

export type WeekReport = { content: ProgressContent; overrides: Overrides; share_token: string; pushed_at: string; period_start: string };
/** Where a print of the week is served from: its own report's public link, by its position there. */
export type ShotSource = { token: string; pushedAt: string; n: number; ext: "png" | "jpg" };
export type Week = { content: ProgressContent; shotSources: ShotSource[] };

const DAY = 24 * 60 * 60 * 1000;
const SAO_PAULO = -3 * 60 * 60 * 1000; // no daylight saving since 2019

/** The Monday (YYYY-MM-DD, São Paulo) of the week an instant falls in. */
export function weekStartOf(iso: string): string {
  const local = new Date(Date.parse(iso) + SAO_PAULO);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(local.getTime() - sinceMonday * DAY).toISOString().slice(0, 10);
}

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The Monday of the week a report belongs to: the week of the last instant its period holds. The end is
 * exclusive (a period that stops at Monday 00:00 reported on the week that just ended), so it is the instant
 * just before it. The week's reads (loadWeek) ask the database for the very same rule.
 */
export function weekOfPeriod(period: { period_start: string; period_end: string }): string {
  return weekStartOf(new Date(Date.parse(period.period_end) - 1).toISOString());
}

/**
 * The Monday scrum where a report is presented: the Monday after the week it belongs to (weekOfPeriod).
 * It is the day Frontlights names the week's folder after, so the rule lives here, in one place, and
 * the plugin is handed the date instead of working it out again.
 */
export function weekMeetingOf(period: { period_start: string; period_end: string }): string {
  return plusDays(weekOfPeriod(period), 7);
}

/** The sent list in weeks, in the order it came (newest first), each labelled Monday to Friday. */
export function groupByWeek<T extends { period_start: string; period_end: string }>(list: T[]): { start: string; label: string; items: T[] }[] {
  const groups: { start: string; label: string; items: T[] }[] = [];
  for (const item of list) {
    const start = weekOfPeriod(item);
    let group = groups.find((g) => g.start === start);
    if (!group) {
      group = { start, label: `Semana de ${ddmm(start)} a ${ddmm(plusDays(start, 4))}`, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

type Counts = Record<Exclude<EntryStatus, "proximo">, number>;

/** The opening line of the week, made only from the counts of the deliveries on show. */
export function weekHeadline(c: Counts): string {
  const parts: string[] = [];
  if (c.concluido) parts.push(c.concluido === 1 ? "1 entrega concluída" : `${c.concluido} entregas concluídas`);
  const noun = parts.length === 0;
  const counted = (n: number, singular: string, plural: string) => (noun ? `${n} ${n === 1 ? "entrega" : "entregas"} ${n === 1 ? singular : plural}` : `${n} ${n === 1 ? singular : plural}`);
  if (c.em_validacao) parts.push(counted(c.em_validacao, "em validação", "em validação"));
  if (c.em_andamento) parts.push(parts.length === 0 ? counted(c.em_andamento, "em andamento", "em andamento") : `${c.em_andamento} em andamento`);
  if (c.bloqueado) parts.push(parts.length === 0 ? counted(c.bloqueado, "bloqueada", "bloqueadas") : `${c.bloqueado} ${c.bloqueado === 1 ? "bloqueada" : "bloqueadas"}`);
  if (parts.length === 0) return "Na semana, nenhuma entrega mudou de situação.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
  return `Na semana, ${list}.`;
}

const ZERO: TokenCount = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const addTokens = (a: TokenCount, b: TokenCount): TokenCount => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

/** Claude's usage of the whole week: the days of every report (one each), and the totals added up from them. */
function weekUsage(reports: ProgressContent[], window: ProgressContent["window"]): UsageModel {
  const latest = reports[reports.length - 1].usage;
  const byDate = new Map<string, DayUsage>();
  for (const r of reports) for (const d of r.usage.days ?? []) byDate.set(d.date, d); // a later report wins on the same day
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const models = new Map<string, UsageModel["byModel"][number]>();
  for (const r of reports) {
    for (const m of r.usage.byModel ?? []) {
      const had = models.get(m.model);
      models.set(m.model, had ? { ...addTokens(had, m), model: m.model, messages: had.messages + m.messages } : { ...m });
    }
  }
  // Most tokens first, like the collector: its first one is the favourite.
  const tokensOf = (m: TokenCount) => m.input + m.output + m.cacheRead + m.cacheWrite;
  const byModel = [...models.values()].sort((a, b) => tokensOf(b) - tokensOf(a));
  const hourly = Array.from({ length: 24 }, (_, h) => days.reduce((t, d) => t + (d.hourly?.[h] ?? 0), 0));
  const busiest = Math.max(...hourly);
  const humanPrompts = days.reduce((t, d) => t + (d.humanPrompts ?? 0), 0);

  return {
    scope: latest.scope,
    ...(latest.products ? { products: [...new Set(reports.flatMap((r) => r.usage.products ?? []))] } : {}),
    window,
    generatedAt: latest.generatedAt,
    ...(latest.label ? { label: latest.label } : {}),
    ...(latest.method ? { method: latest.method } : {}),
    totals: {
      // As each e-mail counted them: a session that ran past midnight leaves a piece on each day, but is one.
      sessions: reports.reduce((t, r) => t + (r.usage.totals?.sessions ?? 0), 0),
      messages: days.reduce((t, d) => t + d.messages, 0),
      ...(humanPrompts ? { humanPrompts } : {}),
      activeDays: days.filter((d) => d.messages > 0).length,
      tokens: days.reduce((t, d) => addTokens(t, d.tokens), ZERO),
    },
    byModel,
    favoriteModel: byModel[0]?.model ?? null,
    peakHour: busiest > 0 ? hourly.indexOf(busiest) : null,
    days,
    ...(reports.some((r) => r.usage.notes?.length) ? { notes: reports.flatMap((r) => r.usage.notes ?? []) } : {}),
  };
}

/** Puts the reports of one week together. Any order in: the periods decide which one is the latest. */
export function combineWeek(rows: WeekReport[]): Week {
  const ordered = [...rows].sort((a, b) => Date.parse(a.period_start) - Date.parse(b.period_start));
  const shown = ordered.map((r) => resolveContent({ content: r.content, overrides: r.overrides ?? {} }));
  const latest = shown[shown.length - 1];

  // Each delivery once, as the latest report that showed it left it; the latest report's deliveries lead. A
  // later report may carry it hidden (the collector hides what was delivered before that report's period), and
  // that does not take out of the week what an earlier e-mail showed. Hidden in every report: it stays hidden.
  const entries: ProgressEntry[] = [];
  const at = new Map<number, number>();
  for (const report of [...shown].reverse()) {
    for (const e of report.entries) {
      const i = at.get(e.issue);
      if (i === undefined) {
        at.set(e.issue, entries.length);
        entries.push(e);
      } else if (!isShown(entries[i]) && isShown(e)) {
        entries[i] = e;
      }
    }
  }

  const visible = visibleOf({ ...latest, entries });
  const count = (s: EntryStatus) => visible.filter((e) => e.status === s).length;
  // Only what the e-mails told: a report whose internal line the user removed adds nothing.
  const internalCount = shown.reduce((t, r) => t + (r.internal?.count > 0 && r.internal.text.trim() ? r.internal.count : 0), 0);
  const window = { start: shown[0].window.start, end: latest.window.end };

  const shots: Shot[] = [];
  const shotSources: ShotSource[] = [];
  ordered.forEach((row, i) => {
    (shown[i].shots ?? []).forEach((shot, at) => {
      shots.push({ ...shot, id: `shot-${shots.length + 1}` });
      shotSources.push({ token: row.share_token, pushedAt: row.pushed_at, n: at + 1, ext: shot.mime === "image/png" ? "png" : "jpg" });
    });
  });

  const content: ProgressContent = {
    window,
    headline: weekHeadline({ concluido: count("concluido"), em_validacao: count("em_validacao"), em_andamento: count("em_andamento"), bloqueado: count("bloqueado") }),
    entries,
    internal: {
      count: internalCount,
      text: internalCount === 0 ? "" : internalCount === 1 ? "Também houve 1 ajuste interno de organização." : `Também houve ${internalCount} ajustes internos de organização.`,
    },
    difficulties: latest.difficulties,
    nextSteps: latest.nextSteps,
    // What is left of the sprint is the picture at the end of the week: the latest report's, never a sum.
    ...(latest.sprint ? { sprint: latest.sprint } : {}),
    usage: weekUsage(shown, window),
    ...(shots.length ? { shots } : {}),
  };
  return { content, shotSources };
}
