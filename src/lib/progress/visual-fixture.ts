// Synthetic report content for the image, handler, e-mail and CLI tests. Everything here is made up on
// purpose (round numbers, generic titles): the repository is public, so a fixture must never carry
// real titles, real usage or any person's name.
import type { DayUsage, EntryStatus, ProgressContent, ProgressEntry, UsageModel } from "../progress-report.ts";

const DAY_MS = 86_400_000;

/** First day of every fixture window; a Monday. */
export const FIRST_DAY = "2026-09-28";

/** "2026-09-28" plus n days, by calendar arithmetic in UTC (no zone or daylight-saving surprises). */
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** 24 buckets of messages per hour, zero except where `busy` says otherwise. */
export const hourly = (busy: Record<number, number> = {}): number[] =>
  Array.from({ length: 24 }, (_, hour) => busy[hour] ?? 0);

export function entry(n: number, status: EntryStatus, patch: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    id: `gc-${n}`,
    issue: n,
    status,
    title: `Entrega de teste ${n}`,
    summary: `Frase de exemplo sobre a entrega de teste ${n}.`,
    deliveredAt: status === "concluido" ? `${FIRST_DAY}T15:00:00-03:00` : null,
    subIssues: null,
    hidden: false,
    edited: false,
    // Links for the team only: the e-mail must never print them.
    sources: [`https://example.invalid/issues/${n}`, `https://example.invalid/pull/${n}`],
    ...patch,
  };
}

/**
 * Usage over `dayCount` days starting on FIRST_DAY. Day i is busy from 06h to 15h+i%4, so the
 * first-to-last active hour differs between days. Totals are round numbers on purpose: they are what
 * the image must show as given, not something to recompute from the days.
 */
export function usageFor(dayCount: number, patch: Partial<UsageModel> = {}): UsageModel {
  const days: DayUsage[] = Array.from({ length: dayCount }, (_, i) => {
    const date = addDays(FIRST_DAY, i);
    const busy: Record<number, number> = {};
    for (let h = 6; h <= 15 + (i % 4); h++) busy[h] = 10 + ((h + i) % 5) * 10;
    const perHour = hourly(busy);
    const messages = perHour.reduce((a, b) => a + b, 0);
    return {
      date,
      sessions: [{ start: `${date}T09:00:00-03:00`, end: `${date}T12:30:00-03:00`, messages: 40, tokens: 1_000_000 }],
      firstPromptAt: `${date}T06:10:00-03:00`,
      lastPromptAt: `${date}T15:50:00-03:00`,
      messages,
      tokens: { input: 10_000, output: 200_000, cacheRead: 3_000_000, cacheWrite: 100_000 },
      hourly: perHour,
    };
  });
  const sum = (pick: (d: DayUsage) => number) => days.reduce((a, d) => a + pick(d), 0);
  const perHourTotals = hourly();
  for (const d of days) d.hourly.forEach((v, h) => (perHourTotals[h] += v));
  const peak = perHourTotals.indexOf(Math.max(...perHourTotals));
  return {
    scope: "GeoCloud",
    window: { start: `${FIRST_DAY}T00:00:00-03:00`, end: `${addDays(FIRST_DAY, dayCount)}T00:00:00-03:00` },
    generatedAt: `${addDays(FIRST_DAY, dayCount)}T12:00:00-03:00`,
    totals: {
      sessions: 6 * dayCount,
      messages: sum((d) => d.messages),
      activeDays: dayCount,
      tokens: { input: 100_000, output: 2_000_000, cacheRead: 30_000_000, cacheWrite: 1_000_000 },
    },
    byModel: [
      { model: "claude-opus-5-5", input: 70_000, output: 1_500_000, cacheRead: 20_000_000, cacheWrite: 800_000, messages: 300 },
      { model: "claude-sonnet-5-5", input: 30_000, output: 500_000, cacheRead: 10_000_000, cacheWrite: 200_000, messages: 180 },
    ],
    favoriteModel: "claude-opus-5-5",
    peakHour: peak,
    days,
    ...patch,
  };
}

/** A complete, resolved report over `dayCount` days with one entry per status plus a hidden one. */
export function sampleContent(dayCount = 2, patch: Partial<ProgressContent> = {}): ProgressContent {
  return {
    window: { start: `${FIRST_DAY}T00:00:00-03:00`, end: `${addDays(FIRST_DAY, dayCount)}T00:00:00-03:00` },
    headline: "Duas entregas de teste ficaram prontas e uma está em validação.",
    entries: [
      entry(1, "concluido"),
      entry(2, "concluido"),
      entry(3, "em_validacao"),
      entry(4, "em_andamento"),
      entry(5, "proximo"),
      entry(6, "concluido", { hidden: true, title: "Entrega escondida de teste" }),
    ],
    internal: { count: 12, text: "Também houve 12 ajustes internos de organização." },
    difficulties: [],
    nextSteps: [{ text: "Primeiro passo de teste." }],
    usage: usageFor(dayCount),
    ...patch,
  };
}
