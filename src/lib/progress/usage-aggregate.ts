// Turns the stream of usage events of Claude Code transcripts into the `UsageModel` of the report: the
// sessions of the product, split by São Paulo day, with messages, tokens, models and the hour-by-hour
// strip. Only numbers and instants come out; the events it reads hold nothing else. Pure on purpose: no
// "server-only", no "@/" imports.
//
// There is deliberately no "active time": adding up short gaps undercounted a 13-hour day by half. A day
// is its sessions, its first and last prompt and its messages per hour.
import type { CountMethod, DayUsage, TokenCount, UsageModel } from "../progress-report.ts";
import { friendlyModel } from "./usage-parse.ts";
import type { UsageEvent } from "./usage-parse.ts";
import { GEOCLOUD_RULE, decideScope, emptyTally, scopeMatcher } from "./usage-scope.ts";
import type { ProductRule, ScopeBasis, ScopeOverrides, ToolTally } from "./usage-scope.ts";

export type UsageOptions = {
  /** First São Paulo day of the window, YYYY-MM-DD. */
  from: string;
  /** Last São Paulo day, inclusive. */
  to: string;
  /** "real" (default) counts every API answer once; "stats" sums every line, as the /stats panel does. */
  method?: CountMethod;
  /** The person's decisions about which sessions are in or out, by id prefix. */
  scope?: Partial<ScopeOverrides>;
  notes?: readonly { date: string; text: string }[];
  /** Title of the usage picture; cleaned by cleanLabel, left out when nothing is left of it. */
  label?: string;
  /** The connected projects whose use is counted, in display order. Default: GeoCloud alone. */
  products?: readonly ProductRule[];
  /** Project whose sessions feed `activity` (the coverage gaps are about the issues' project). Default: "GeoCloud" by name, else the first. */
  activityProduct?: string;
  now?: Date;
};

/** One session seen in the window, in scope or not, with the numbers behind the decision. */
export type SessionSummary = {
  /** First 8 characters of the session id. */
  id: string;
  /** Working-directory root the session mostly used. */
  root: string | null;
  firstAt: string | null;
  lastAt: string | null;
  /** Inside the window, by the chosen method. */
  messages: number;
  humanPrompts: number;
  tokens: number;
  included: boolean;
  /** Name of the project the session counts for (where it was opened, else where most calls pointed); null when out. */
  product: string | null;
  borderline: boolean;
  forced: "include" | "exclude" | null;
  basis: ScopeBasis;
  /** Tool calls of the whole session, by what they pointed at. */
  calls: { total: number; scope: number; other: number; both: number; none: number };
  shares: { explicit: number | null; effective: number | null; cwd: number };
};

/** What one connected project adds to the totals. */
export type ProductUsage = { name: string; sessions: number; messages: number; humanPrompts: number; tokens: number };

export type UsageResult = {
  usage: UsageModel;
  /** Per project, in the order given; they add up to the totals. */
  byProduct: ProductUsage[];
  /** Start of every minute (ISO, UTC) with a message of a session in scope, a day of margin each side. */
  activity: string[];
  /** Every session active in the window, whatever its scope, by first activity. */
  sessions: SessionSummary[];
  /** The sessions the rule was not sure about (in or out): the person confirms them. */
  borderline: SessionSummary[];
};

export const MAX_LABEL = 60;

// Code points are compared as numbers, so this source holds no control character at all.
const isLineBreakLike = (cp: number): boolean => (cp >= 9 && cp <= 13) || cp === 0x85 || cp === 0x2028 || cp === 0x2029;
const isControl = (cp: number): boolean => cp < 32 || (cp >= 0x7f && cp <= 0x9f);

/**
 * The title the collector puts on the usage picture, made safe to print: line breaks and tabs become one
 * space, other control characters are dropped, at most MAX_LABEL characters (an emoji counts as one).
 * undefined when nothing is left.
 */
export function cleanLabel(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  let text = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isLineBreakLike(cp)) text += " ";
    else if (!isControl(cp)) text += ch;
  }
  const capped = [...text.replace(/ {2,}/g, " ").trim()].slice(0, MAX_LABEL).join("").trimEnd();
  return capped === "" ? undefined : capped;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// São Paulo has had no daylight saving since 2019: a fixed -03:00, like the windows of the contract.
const SAO_PAULO_MS = -3 * 3_600_000;

const dayOf = (ms: number): string => new Date(ms + SAO_PAULO_MS).toISOString().slice(0, 10);
const hourOf = (ms: number): number => new Date(ms + SAO_PAULO_MS).getUTCHours();
const startOfDay = (day: string): number => Date.parse(`${day}T00:00:00-03:00`);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;

/* ---------- accumulators ---------- */

type Tok = TokenCount & { n: number };
const newTok = (): Tok => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, n: 0 });
const addTok = (to: Tok, u: TokenCount): void => {
  to.input += u.input;
  to.output += u.output;
  to.cacheRead += u.cacheRead;
  to.cacheWrite += u.cacheWrite;
  to.n++;
};
const sumOf = (t: TokenCount): number => t.input + t.output + t.cacheRead + t.cacheWrite;
const zeros = (): number[] => new Array<number>(24).fill(0);
const bump = (map: Map<string, number>, key: string): void => void map.set(key, (map.get(key) ?? 0) + 1);
const slot = <K, V>(map: Map<K, V>, key: K, make: () => V): V => {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(key, v);
  }
  return v;
};

type DayFacts = {
  /** User and assistant lines of the main transcript: what the /stats panel calls messages. */
  mainLines: number;
  human: number;
  commands: number;
  strip: number[];
  /** Hours of the typed requests and commands (the "real" strip adds the answers to them). */
  requestStrip: number[];
  /** Per raw model, every assistant line of main and subagent files (the /stats way). */
  stats: Map<string, Tok>;
  firstAt: number;
  lastAt: number;
  firstHuman: number | null;
  lastHuman: number | null;
};

const newDay = (at: number): DayFacts => ({
  mainLines: 0,
  human: 0,
  commands: 0,
  strip: zeros(),
  requestStrip: zeros(),
  stats: new Map(),
  firstAt: at,
  lastAt: at,
  firstHuman: null,
  lastHuman: null,
});

/** One answer of the API, seen once: input and cache of its first line, output the largest of its lines. */
type Answer = { day: string; hour: number; model: string; usage: TokenCount };

type SessionState = {
  key: string;
  id: string;
  firstMain: number | null;
  firstCwd: string | null;
  mainLines: number;
  cwd: Map<string, number>;
  cwdAny: Map<string, number>;
  tools: ToolTally;
  /** Tool calls with an explicit target, per project (index of the rule). */
  touches: number[];
  days: Map<string, DayFacts>;
  answers: Map<string, Answer>;
  /** Minutes (epoch / 60000) with a line, within the margin around the window. */
  minutes: Set<number>;
};

/** A session-day as it counts under one method. */
type View = { messages: number; hourly: number[]; models: Map<string, Tok>; tokens: number };

function statsView(day: DayFacts): View {
  let tokens = 0;
  for (const t of day.stats.values()) tokens += sumOf(t);
  return { messages: day.mainLines, hourly: day.strip, models: day.stats, tokens };
}

function realView(day: DayFacts, answers: readonly Answer[]): View {
  const hourly = day.requestStrip.slice();
  const models = new Map<string, Tok>();
  let tokens = 0;
  for (const a of answers) {
    hourly[a.hour]++;
    addTok(slot(models, a.model, newTok), a.usage);
    tokens += sumOf(a.usage);
  }
  return { messages: day.human + day.commands + answers.length, hourly, models, tokens };
}

/**
 * Builds the model from events given in a stable order (the CLI reads files sorted by path): when the
 * same API answer appears in more than one session file (a resumed or forked conversation), the first
 * session seen keeps it.
 */
export function buildUsage(events: Iterable<UsageEvent>, options: UsageOptions): UsageResult {
  const { from, to } = options;
  if (!isDay(from)) throw new Error(`--from: data inválida («${String(from)}»); use AAAA-MM-DD`);
  if (!isDay(to)) throw new Error(`--to: data inválida («${String(to)}»); use AAAA-MM-DD`);
  if (to < from) throw new Error("--to: a data final vem antes da inicial");
  const method: CountMethod = options.method ?? "real";
  const rules: readonly ProductRule[] = options.products?.length ? options.products : [GEOCLOUD_RULE];
  const matcher = scopeMatcher(rules);
  const activityIndex = Math.max(0, rules.findIndex((r) => r.name.toLowerCase() === (options.activityProduct ?? "GeoCloud").toLowerCase()));

  const fromMs = startOfDay(from);
  const toMs = startOfDay(addDays(to, 1));
  const dayList: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dayList.push(d);

  const sessions = new Map<string, SessionState>();
  const owners = new Map<string, string>();
  let unnamed = 0;

  for (const ev of events) {
    if (ev.source.kind === "workflow") continue;
    const key = `${ev.source.project}|${ev.source.session}`;
    const s = slot<string, SessionState>(sessions, key, () => ({
      key,
      id: ev.source.session,
      firstMain: null,
      firstCwd: null,
      mainLines: 0,
      cwd: new Map(),
      cwdAny: new Map(),
      tools: emptyTally(),
      touches: rules.map(() => 0),
      days: new Map(),
      answers: new Map(),
      minutes: new Set(),
    }));
    const main = ev.source.kind === "main";
    if (main) {
      s.mainLines++;
      if (s.firstMain === null || ev.at < s.firstMain) {
        s.firstMain = ev.at;
        s.firstCwd = ev.cwd;
      }
      if (ev.cwd) bump(s.cwd, ev.cwd);
    }
    if (ev.cwd) bump(s.cwdAny, ev.cwd);
    if (ev.at >= fromMs - DAY_MS && ev.at < toMs + DAY_MS) s.minutes.add(Math.floor(ev.at / MINUTE_MS));

    // What the session worked on is judged over its whole life, not only the days of the window.
    for (const target of ev.tools) {
      const kind = matcher.classify(target);
      s.tools[kind]++;
      for (const i of matcher.touched(target)) s.touches[i]++;
      s.tools.total++;
      if (kind === "none" && matcher.inCwd(ev.cwd)) s.tools.noneInScopeCwd++;
    }

    if (ev.at < fromMs || ev.at >= toMs) continue;
    const day = dayOf(ev.at);
    const hour = hourOf(ev.at);
    const d = slot(s.days, day, () => newDay(ev.at));
    if (ev.at < d.firstAt) d.firstAt = ev.at;
    if (ev.at > d.lastAt) d.lastAt = ev.at;

    if (main) {
      d.mainLines++;
      d.strip[hour]++;
      if (ev.type === "user" && (ev.request === "human" || ev.request === "command")) {
        d.requestStrip[hour]++;
        if (ev.request === "command") d.commands++;
        else {
          d.human++;
          if (d.firstHuman === null || ev.at < d.firstHuman) d.firstHuman = ev.at;
          if (d.lastHuman === null || ev.at > d.lastHuman) d.lastHuman = ev.at;
        }
      }
    }

    if (ev.type === "assistant" && ev.usage) {
      const model = ev.model ?? "";
      addTok(slot(d.stats, model, newTok), ev.usage);
      // Each answer once: the lines of one answer share the message id and the request id.
      const id = ev.messageId === null ? null : ev.requestId === null ? ev.messageId : `${ev.messageId}|${ev.requestId}`;
      const answerKey = id ?? `#${++unnamed}`;
      const owner = owners.get(answerKey);
      if (owner === undefined) {
        owners.set(answerKey, key);
        s.answers.set(answerKey, { day, hour, model, usage: { ...ev.usage } });
      } else if (owner === key) {
        const answer = s.answers.get(answerKey);
        if (answer && ev.usage.output > answer.usage.output) answer.usage.output = ev.usage.output;
      }
    }
  }

  /* ---------- who is in scope ---------- */

  const summaries: SessionSummary[] = [];
  const modelTotals = new Map<string, Tok>();
  const rows = dayList.map((date) => ({
    date,
    sessions: [] as DayUsage["sessions"],
    messages: 0,
    human: 0,
    tokens: newTok(),
    other: 0,
    hourly: zeros(),
    firstHuman: null as number | null,
    lastHuman: null as number | null,
  }));
  const rowOf = new Map(rows.map((r) => [r.date, r]));
  const activeSessions = new Set<string>();
  const perProduct = rules.map(() => ({ sessions: new Set<string>(), messages: 0, humanPrompts: 0, tokens: 0 }));
  const activityMinutes = new Set<number>();

  for (const s of sessions.values()) {
    if (s.days.size === 0) continue; // never seen inside the window
    let top: [string, number] | null = null;
    for (const entry of (s.cwd.size ? s.cwd : s.cwdAny).entries()) if (top === null || entry[1] > top[1]) top = entry;
    let lines = s.mainLines;
    let scopeLines = 0;
    if (s.cwd.size) {
      for (const [cwd, n] of s.cwd) if (matcher.inCwd(cwd)) scopeLines += n;
    } else {
      // A session known only through its subagents: judge by their working directories.
      lines = 0;
      for (const [cwd, n] of s.cwdAny) {
        lines += n;
        if (matcher.inCwd(cwd)) scopeLines += n;
      }
    }
    const decision = decideScope({ id: s.id, startCwd: s.firstCwd ?? top?.[0] ?? null, lines, scopeLines, tools: s.tools }, matcher, options.scope);

    // A session counts for the project it was opened in; failing that, the one most of its calls pointed
    // at, then the one with most of its lines; a forced include that shows none of them goes to the first.
    const argmax = (counts: readonly number[]): number => {
      let best = -1;
      counts.forEach((n, i) => {
        if (n > 0 && (best < 0 || n > counts[best])) best = i;
      });
      return best;
    };
    const linesPer = rules.map(() => 0);
    for (const [cwd, n] of s.cwd.size ? s.cwd : s.cwdAny) {
      const i = matcher.productOfCwd(cwd);
      if (i >= 0) linesPer[i] += n;
    }
    let productIndex = matcher.productOfCwd(s.firstCwd ?? top?.[0] ?? null);
    if (productIndex < 0) productIndex = argmax(s.touches);
    if (productIndex < 0) productIndex = argmax(linesPer);
    if (productIndex < 0) productIndex = 0;
    const mine = perProduct[productIndex];

    const byDay = new Map<string, Answer[]>();
    for (const a of s.answers.values()) slot(byDay, a.day, () => []).push(a);

    let messages = 0;
    let humanPrompts = 0;
    let tokens = 0;
    let firstAt: number | null = null;
    let lastAt: number | null = null;
    for (const [date, sd] of s.days) {
      const stats = statsView(sd);
      const real = realView(sd, byDay.get(date) ?? []);
      const chosen = method === "real" ? real : stats;
      const other = method === "real" ? stats : real;
      messages += chosen.messages;
      humanPrompts += sd.human;
      tokens += chosen.tokens;
      if (firstAt === null || sd.firstAt < firstAt) firstAt = sd.firstAt;
      if (lastAt === null || sd.lastAt > lastAt) lastAt = sd.lastAt;
      if (!decision.include) continue;

      const row = rowOf.get(date)!;
      row.sessions.push({ start: new Date(sd.firstAt).toISOString(), end: new Date(sd.lastAt).toISOString(), messages: chosen.messages, tokens: chosen.tokens });
      row.messages += chosen.messages;
      row.human += sd.human;
      row.other += other.tokens;
      mine.messages += chosen.messages;
      mine.humanPrompts += sd.human;
      mine.tokens += chosen.tokens;
      chosen.hourly.forEach((n, h) => (row.hourly[h] += n));
      for (const [model, t] of chosen.models) {
        const name = friendlyModel(model);
        const total = slot(modelTotals, name, newTok);
        const perDay = row.tokens;
        for (const target of [total, perDay]) {
          target.input += t.input;
          target.output += t.output;
          target.cacheRead += t.cacheRead;
          target.cacheWrite += t.cacheWrite;
        }
        total.n += t.n;
      }
      if (sd.firstHuman !== null && (row.firstHuman === null || sd.firstHuman < row.firstHuman)) row.firstHuman = sd.firstHuman;
      if (sd.lastHuman !== null && (row.lastHuman === null || sd.lastHuman > row.lastHuman)) row.lastHuman = sd.lastHuman;
      if (sd.mainLines > 0) {
        activeSessions.add(s.key);
        mine.sessions.add(s.key);
      }
    }
    if (decision.include && productIndex === activityIndex) for (const minute of s.minutes) activityMinutes.add(minute);

    summaries.push({
      id: s.id.slice(0, 8),
      root: top?.[0] ?? s.firstCwd,
      firstAt: firstAt === null ? null : new Date(firstAt).toISOString(),
      lastAt: lastAt === null ? null : new Date(lastAt).toISOString(),
      messages,
      humanPrompts,
      tokens,
      included: decision.include,
      product: decision.include ? rules[productIndex].name : null,
      borderline: decision.borderline,
      forced: decision.forced,
      basis: decision.basis,
      calls: { total: s.tools.total, scope: s.tools.scope, other: s.tools.other, both: s.tools.both, none: s.tools.none },
      shares: { explicit: decision.explicitShare, effective: decision.effectiveShare, cwd: decision.cwdShare },
    });
  }
  summaries.sort((a, b) => (a.firstAt ?? "").localeCompare(b.firstAt ?? "") || a.id.localeCompare(b.id));

  /* ---------- the model ---------- */

  const days: DayUsage[] = rows.map((r) => ({
    date: r.date,
    sessions: r.sessions.sort((a, b) => a.start.localeCompare(b.start)),
    firstPromptAt: r.firstHuman === null ? null : new Date(r.firstHuman).toISOString(),
    lastPromptAt: r.lastHuman === null ? null : new Date(r.lastHuman).toISOString(),
    messages: r.messages,
    humanPrompts: r.human,
    tokens: { input: r.tokens.input, output: r.tokens.output, cacheRead: r.tokens.cacheRead, cacheWrite: r.tokens.cacheWrite },
    otherMethodTokens: r.other,
    hourly: r.hourly,
  }));

  const byModel = [...modelTotals.entries()]
    .map(([model, t]) => ({ model, input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, messages: t.n }))
    .sort((a, b) => sumOf(b) - sumOf(a) || a.model.localeCompare(b.model));

  const totalTokens: TokenCount = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const strip = zeros();
  let messages = 0;
  let humanPrompts = 0;
  for (const d of days) {
    messages += d.messages;
    humanPrompts += d.humanPrompts ?? 0;
    totalTokens.input += d.tokens.input;
    totalTokens.output += d.tokens.output;
    totalTokens.cacheRead += d.tokens.cacheRead;
    totalTokens.cacheWrite += d.tokens.cacheWrite;
    d.hourly.forEach((n, h) => (strip[h] += n));
  }
  const busiest = Math.max(...strip);

  const seen = new Set<string>();
  const notes = (options.notes ?? [])
    .filter((n) => {
      const k = `${n.date}\u0000${n.text}`;
      if (!rowOf.has(n.date) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((n) => ({ date: n.date, text: n.text }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const label = cleanLabel(options.label);
  const usage: UsageModel = {
    scope: "GeoCloud",
    ...(rules.length > 1 ? { products: rules.map((r) => r.name) } : {}),
    window: { start: `${from}T00:00:00-03:00`, end: `${addDays(to, 1)}T00:00:00-03:00` },
    generatedAt: (options.now ?? new Date()).toISOString(),
    ...(label === undefined ? {} : { label }),
    method,
    totals: { sessions: activeSessions.size, messages, humanPrompts, activeDays: days.filter((d) => d.messages > 0).length, tokens: totalTokens },
    byModel,
    favoriteModel: byModel.length ? byModel[0].model : null,
    peakHour: busiest > 0 ? strip.indexOf(busiest) : null,
    days,
    ...(notes.length ? { notes } : {}),
  };

  return {
    usage,
    byProduct: rules.map((r, i) => ({ name: r.name, sessions: perProduct[i].sessions.size, messages: perProduct[i].messages, humanPrompts: perProduct[i].humanPrompts, tokens: perProduct[i].tokens })),
    activity: [...activityMinutes].sort((a, b) => a - b).map((m) => new Date(m * MINUTE_MS).toISOString()),
    sessions: summaries,
    borderline: summaries.filter((x) => x.borderline),
  };
}
