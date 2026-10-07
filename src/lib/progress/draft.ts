// Checks the draft the Frontlights CLI pushes for "Resumo para a diretoria" before anything is stored.
// A pure module on purpose (no "server-only", no "@/" imports, relative imports end in ".ts"): the route
// and the push script run these very same checks, so a draft the script accepts is a draft the route accepts.
//
// The result is REBUILT from the fields the contract knows, never copied: anything else a collector or a
// careless script left in the payload (a prompt, a working directory, a transcript) is dropped here and
// can't reach the database, the screen or the e-mail. And an error never contains a value it was sent:
// only the name of the field and what is wrong with it, so a rejected draft can't leak through a log.
import { ENTRY_STATUSES } from "../progress-report.ts";
import type {
  CountMethod,
  CoverageGap,
  DayUsage,
  EntryStatus,
  ProgressContent,
  ProgressEntry,
  ReportWindow,
  Shot,
  SprintBlock,
  SprintCover,
  TokenCount,
  UsageModel,
} from "../progress-report.ts";
import type { Produto } from "../types.ts";

/**
 * The whole serialized body: the content is stored in one row the screen loads each time. Kept under the
 * 4.5 MB request cap of the host. Prints travel apart (each uploaded to the storage bucket on its own, see
 * the shots route), so a draft normally carries only their paths; an inline print still counts here.
 */
export const MAX_PAYLOAD_BYTES = 4096 * 1024;
/** One print, decoded: about 1920 px wide, enough to read code or a table on a projected screen. */
export const MAX_SHOT_BYTES = 1024 * 1024;
/** Every delivery on show needs one print, so a busy week needs room for two or three each. */
export const MAX_SHOTS = 40;
/** A print in the storage bucket: the SHA-256 of its bytes, with the extension of its type. */
export const SHOT_PATH = /^[0-9a-f]{64}\.(png|jpg)$/;
export const shotExtension = (mime: Shot["mime"]): "png" | "jpg" => (mime === "image/png" ? "png" : "jpg");

/**
 * Every field of the contract this parser keeps. The mapped type turns a field added to the contract into
 * a compile error here until the parser (and the sample in draft.test.ts) learn it: a whitelist drops
 * silently what it does not know, and data missing from the e-mail is the worst way to find that out.
 */
const fieldsOf = <T>(all: { [K in keyof T]-?: true }) => Object.keys(all) as (keyof T & string)[];
export const KEPT_FIELDS = {
  content: fieldsOf<ProgressContent>({ window: true, headline: true, entries: true, internal: true, difficulties: true, nextSteps: true, usage: true, shots: true, sprint: true, gaps: true, access: true }),
  entry: fieldsOf<ProgressEntry>({ id: true, issue: true, status: true, title: true, summary: true, deliveredAt: true, subIssues: true, hidden: true, edited: true, sources: true }),
  usage: fieldsOf<UsageModel>({ scope: true, products: true, window: true, generatedAt: true, label: true, method: true, totals: true, byModel: true, favoriteModel: true, peakHour: true, days: true, notes: true }),
  totals: fieldsOf<UsageModel["totals"]>({ sessions: true, messages: true, humanPrompts: true, activeDays: true, tokens: true }),
  byModel: fieldsOf<UsageModel["byModel"][number]>({ input: true, output: true, cacheRead: true, cacheWrite: true, model: true, messages: true }),
  day: fieldsOf<DayUsage>({ date: true, sessions: true, firstPromptAt: true, lastPromptAt: true, messages: true, humanPrompts: true, tokens: true, otherMethodTokens: true, hourly: true }),
  session: fieldsOf<DayUsage["sessions"][number]>({ start: true, end: true, messages: true, tokens: true }),
  shot: fieldsOf<Shot>({ id: true, caption: true, mime: true, issue: true, path: true, data: true }),
  gap: fieldsOf<CoverageGap>({ at: true, ref: true, nearestMessageMinutes: true }),
  sprint: fieldsOf<SprintBlock>({ epics: true, totals: true }),
  cover: fieldsOf<SprintCover>({ issue: true, title: true, summary: true, issues: true, parts: true, open: true }),
};

export type ParsedDraft = { ok: true; produto: Produto; content: ProgressContent } | { ok: false; error: string };

/** Thrown inside the checks, caught by parseDraft: the first problem found is the one reported. */
class Refusal extends Error {}
const refuse = (path: string, why: string): never => {
  throw new Refusal(`${path}: ${why}`);
};

/* ---------- Primitives ---------- */

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse(path, "esperado um objeto");
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) return refuse(path, "esperada uma lista");
  if (value.length > max) return refuse(path, `no máximo ${max} itens`);
  return value;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Plain text, one line. Control characters (the NUL byte would make Postgres refuse the whole row) and line
 * breaks become spaces and a lone surrogate (not valid UTF-8) becomes the replacement character, instead
 * of refusing a draft over something nobody can see.
 */
function text(value: unknown, path: string, max: number, required = false): string {
  if (typeof value !== "string") return refuse(path, "esperado um texto");
  const clean = value.replace(LONE_SURROGATE, "�").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (required && clean === "") return refuse(path, "não pode ficar vazio");
  if (clean.length > max) return refuse(path, `texto acima de ${max} caracteres`);
  return clean;
}

function whole(value: unknown, path: string, max = 1e13): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    return refuse(path, `esperado um número inteiro entre 0 e ${max}`);
  }
  return value;
}

/** `{ [key]: value }` when the optional value is there, nothing otherwise: no key is ever stored with an undefined value. */
const maybe = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });

function flag(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") return refuse(path, "esperado verdadeiro ou falso");
  return value;
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * An ISO instant WITH its UTC offset, on a day that exists. Date.parse alone is not enough: it rolls
 * "02-31" over to March and accepts hour 24, and Postgres would then refuse the row (a 500, not a 400).
 */
function instant(value: unknown, path: string): string {
  const m = typeof value === "string" ? INSTANT.exec(value) : null;
  if (value === null || typeof value !== "string" || !m) return refuse(path, "esperada uma data e hora ISO com deslocamento, como 2026-03-02T09:00:00-03:00");
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const offsetOk = m[7] === undefined || (Number(m[7]) <= 14 && Number(m[8]) <= 59);
  const valid =
    year >= 2000 && year <= 2199 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetOk && !Number.isNaN(Date.parse(value));
  return valid ? value : refuse(path, "data ou hora que não existe");
}

const nullableInstant = (value: unknown, path: string): string | null =>
  value === null || value === undefined ? null : instant(value, path);

/** A calendar day, YYYY-MM-DD. */
function calendarDay(value: unknown, path: string): string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return refuse(path, "esperado um dia no formato AAAA-MM-DD");
  const [year, month, day] = m.slice(1, 4).map(Number);
  const valid = year >= 2000 && year <= 2199 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  return valid ? m[0] : refuse(path, "dia que não existe");
}

/** An id the user's edits are keyed by ("entry:<id>:title"), so no colon or space is allowed in it. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value)) return refuse(path, "esperado um identificador curto (letras, números, - e _)");
  return value;
}

function ids(values: (string | undefined)[], path: string): void {
  const seen = new Set<string>();
  values.forEach((value, i) => {
    if (value === undefined) return;
    if (seen.has(value)) refuse(`${path}[${i}].id`, "identificador repetido");
    seen.add(value);
  });
}

/**
 * Difficulties and next steps may come without an id, but the user's edits (and "hide") are stored under
 * "difficulty:<id>:..." / "nextStep:<id>:...", so an item without one could never be edited. Ids that were
 * given are kept (a repeated one is told apart with -2, -3... on the later items), the others get their
 * position: d1, d2... / n1, n2... The same list pushed again gets the same ids, so an edit keeps pointing
 * at the same item.
 */
function stableIds(given: (string | undefined)[], prefix: string): string[] {
  const used = new Set<string>();
  const claim = (wanted: string) => {
    let candidate = wanted;
    for (let n = 2; used.has(candidate); n++) {
      const suffix = `-${n}`;
      candidate = wanted.slice(0, 40 - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  };
  const result: string[] = [];
  // The given ids claim their names first, so a positional id never takes the name of one that was given.
  given.forEach((wanted, i) => {
    if (wanted !== undefined) result[i] = claim(wanted);
  });
  given.forEach((wanted, i) => {
    if (wanted === undefined) result[i] = claim(`${prefix}${i + 1}`);
  });
  return result;
}

function status(value: unknown, path: string): EntryStatus {
  if (typeof value === "string") {
    // "Concluído", "em validação", "BLOQUEADO"... the label a person (or the model) writes, as the code.
    const code = value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, "_");
    if ((ENTRY_STATUSES as readonly string[]).includes(code)) return code as EntryStatus;
  }
  return refuse(path, `status desconhecido (use ${ENTRY_STATUSES.join(", ")} ou o rótulo em português)`);
}

/** Links kept for the team to open the issue or PR: https, GitHub, no space or quote that could break out of an attribute. */
const SOURCE_LINK = /^https:\/\/github\.com\/[^\s"'<>\\]{1,280}$/;

/* ---------- Report parts ---------- */

function reportWindow(value: unknown, path: string): ReportWindow {
  const w = record(value, path);
  const start = instant(w.start, `${path}.start`);
  const end = instant(w.end, `${path}.end`);
  if (Date.parse(end) < Date.parse(start)) return refuse(path, "o fim vem antes do início");
  return { start, end };
}

function entry(value: unknown, path: string): ProgressEntry {
  const e = record(value, path);
  const subIssues = e.subIssues === null || e.subIssues === undefined ? null : record(e.subIssues, `${path}.subIssues`);
  const total = subIssues ? whole(subIssues.total, `${path}.subIssues.total`, 1000) : 0;
  const done = subIssues ? whole(subIssues.done, `${path}.subIssues.done`, 1000) : 0;
  if (done > total) refuse(`${path}.subIssues`, "mais concluídas do que o total");
  return {
    id: id(e.id, `${path}.id`),
    issue: whole(e.issue, `${path}.issue`, 1e7),
    status: status(e.status, `${path}.status`),
    title: text(e.title, `${path}.title`, 120, true),
    summary: text(e.summary, `${path}.summary`, 600),
    deliveredAt: nullableInstant(e.deliveredAt, `${path}.deliveredAt`),
    subIssues: subIssues ? { total, done } : null,
    hidden: flag(e.hidden, `${path}.hidden`, false),
    edited: flag(e.edited, `${path}.edited`, false),
    sources: (e.sources === undefined ? [] : list(e.sources, `${path}.sources`, 20)).map((s, i) => {
      if (typeof s !== "string" || !SOURCE_LINK.test(s)) return refuse(`${path}.sources[${i}]`, "esperado um link https do GitHub");
      return s;
    }),
  };
}

function tokenCount(value: unknown, path: string): TokenCount {
  const t = record(value, path);
  return {
    input: whole(t.input, `${path}.input`),
    output: whole(t.output, `${path}.output`),
    cacheRead: whole(t.cacheRead, `${path}.cacheRead`),
    cacheWrite: whole(t.cacheWrite, `${path}.cacheWrite`),
  };
}

function dayUsage(value: unknown, path: string): DayUsage {
  const d = record(value, path);
  const hourly = list(d.hourly, `${path}.hourly`, 24);
  if (hourly.length !== 24) refuse(`${path}.hourly`, "esperadas exatamente 24 horas");
  return {
    date: calendarDay(d.date, `${path}.date`),
    sessions: list(d.sessions, `${path}.sessions`, 200).map((s, i) => {
      const session = record(s, `${path}.sessions[${i}]`);
      return {
        start: instant(session.start, `${path}.sessions[${i}].start`),
        end: instant(session.end, `${path}.sessions[${i}].end`),
        messages: whole(session.messages, `${path}.sessions[${i}].messages`),
        tokens: whole(session.tokens, `${path}.sessions[${i}].tokens`),
      };
    }),
    firstPromptAt: nullableInstant(d.firstPromptAt, `${path}.firstPromptAt`),
    lastPromptAt: nullableInstant(d.lastPromptAt, `${path}.lastPromptAt`),
    messages: whole(d.messages, `${path}.messages`),
    ...maybe("humanPrompts", d.humanPrompts === undefined ? undefined : whole(d.humanPrompts, `${path}.humanPrompts`)),
    tokens: tokenCount(d.tokens, `${path}.tokens`),
    ...maybe("otherMethodTokens", d.otherMethodTokens === undefined ? undefined : whole(d.otherMethodTokens, `${path}.otherMethodTokens`)),
    hourly: hourly.map((n, h) => whole(n, `${path}.hourly[${h}]`, 1e7)),
  };
}

function usage(value: unknown, path: string): UsageModel {
  const u = record(value, path);
  if (u.scope !== "GeoCloud") refuse(`${path}.scope`, 'por enquanto só "GeoCloud"');
  if (u.method !== undefined && u.method !== "real" && u.method !== "stats") refuse(`${path}.method`, 'esperado "real" ou "stats"');
  const totals = record(u.totals, `${path}.totals`);
  const peakHour = u.peakHour === null || u.peakHour === undefined ? null : whole(u.peakHour, `${path}.peakHour`, 23);
  const favoriteModel = u.favoriteModel === null || u.favoriteModel === undefined ? null : text(u.favoriteModel, `${path}.favoriteModel`, 80, true);
  const model: UsageModel = {
    scope: "GeoCloud",
    window: reportWindow(u.window, `${path}.window`),
    generatedAt: instant(u.generatedAt, `${path}.generatedAt`),
    ...maybe("label", u.label === undefined ? undefined : text(u.label, `${path}.label`, 80, true)),
    ...maybe("method", u.method as CountMethod | undefined),
    totals: {
      sessions: whole(totals.sessions, `${path}.totals.sessions`),
      messages: whole(totals.messages, `${path}.totals.messages`),
      ...maybe("humanPrompts", totals.humanPrompts === undefined ? undefined : whole(totals.humanPrompts, `${path}.totals.humanPrompts`)),
      activeDays: whole(totals.activeDays, `${path}.totals.activeDays`, 366),
      tokens: tokenCount(totals.tokens, `${path}.totals.tokens`),
    },
    byModel: list(u.byModel, `${path}.byModel`, 20).map((m, i) => {
      const row = record(m, `${path}.byModel[${i}]`);
      return { model: text(row.model, `${path}.byModel[${i}].model`, 80, true), messages: whole(row.messages, `${path}.byModel[${i}].messages`), ...tokenCount(row, `${path}.byModel[${i}]`) };
    }),
    favoriteModel,
    peakHour,
    days: list(u.days, `${path}.days`, 62).map((d, i) => dayUsage(d, `${path}.days[${i}]`)),
  };
  if (u.products !== undefined) {
    model.products = list(u.products, `${path}.products`, 8).map((n, i) => text(n, `${path}.products[${i}]`, 60, true));
  }
  if (u.notes !== undefined) {
    model.notes = list(u.notes, `${path}.notes`, 62).map((n, i) => {
      const note = record(n, `${path}.notes[${i}]`);
      return { date: calendarDay(note.date, `${path}.notes[${i}].date`), text: text(note.text, `${path}.notes[${i}].text`, 400, true) };
    });
  }
  return model;
}

const ACCOUNT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The reader's first sign-in: an e-mail account and a password with no whitespace (it is typed from the e-mail). */
function access(value: unknown, path: string): { account: string; password: string } {
  const a = record(value, path);
  const account = text(a.account, `${path}.account`, 120, true);
  if (!ACCOUNT.test(account)) refuse(`${path}.account`, "esperado um e-mail");
  const password = typeof a.password === "string" ? a.password : refuse(`${path}.password`, "esperado um texto");
  if (password.length === 0 || password.length > 64 || /\s/.test(password)) refuse(`${path}.password`, "de 1 a 64 caracteres, sem espaços");
  return { account, password };
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_SIGNATURE: Record<Shot["mime"], number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function shot(value: unknown, path: string, issues: Set<number>): Shot {
  const s = record(value, path);
  const mime = s.mime;
  if (mime !== "image/jpeg" && mime !== "image/png") return refuse(`${path}.mime`, "esperado image/jpeg ou image/png");
  const issue = s.issue === undefined ? undefined : whole(s.issue, `${path}.issue`, 1e9);
  if (issue !== undefined && !issues.has(issue)) refuse(`${path}.issue`, `a entrega #${issue} não está neste resumo`);
  const base = { id: id(s.id, `${path}.id`), caption: text(s.caption, `${path}.caption`, 200), mime: mime as Shot["mime"], ...maybe("issue", issue) };
  if ((s.path === undefined) === (s.data === undefined)) return refuse(path, "esperado o caminho do print no armazenamento (path) ou a imagem (data), um dos dois");
  if (s.path !== undefined) {
    const stored = s.path;
    if (typeof stored !== "string" || !SHOT_PATH.test(stored) || !stored.endsWith(`.${shotExtension(mime)}`)) {
      return refuse(`${path}.path`, "esperado o nome do print no armazenamento (hash e extensão do tipo)");
    }
    return { ...base, path: stored };
  }
  const data = s.data;
  if (typeof data !== "string" || data.length % 4 !== 0 || !BASE64.test(data)) {
    return refuse(`${path}.data`, "esperada a imagem em base64 puro, sem prefixo data:");
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  if ((data.length / 4) * 3 - padding > MAX_SHOT_BYTES) return refuse(`${path}.data`, `print acima de ${MAX_SHOT_BYTES / 1024} KB depois de decodificado`);
  // The first bytes must be the ones of the declared type: a mislabelled file is served to a mail client as an image.
  const head = atob(data.slice(0, 12));
  if (!IMAGE_SIGNATURE[mime].every((byte, i) => head.charCodeAt(i) === byte)) return refuse(`${path}.data`, "o arquivo não é uma imagem do tipo informado");
  return { ...base, data };
}

function gap(value: unknown, path: string): CoverageGap {
  const g = record(value, path);
  const minutes = g.nearestMessageMinutes;
  return {
    at: instant(g.at, `${path}.at`),
    ref: text(g.ref, `${path}.ref`, 200, true),
    nearestMessageMinutes: minutes === null || minutes === undefined ? null : whole(minutes, `${path}.nearestMessageMinutes`, 1e6),
  };
}

/** The block "Em andamento na sprint". The sums are made again from the covers, so they can never disagree with them. */
function sprintBlock(value: unknown, path: string): SprintBlock {
  const b = record(value, path);
  const seen = new Set<number>();
  const epics = list(b.epics, `${path}.epics`, 30).map((v, i) => {
    const at = `${path}.epics[${i}]`;
    const c = record(v, at);
    const issue = whole(c.issue, `${at}.issue`, 1e7);
    if (seen.has(issue)) refuse(`${at}.issue`, "capa repetida");
    seen.add(issue);
    const counted = (field: "issues" | "parts") => {
      const n = record(c[field], `${at}.${field}`);
      const total = whole(n.total, `${at}.${field}.total`, 1e5);
      const done = whole(n.done, `${at}.${field}.done`, 1e5);
      if (done > total) refuse(`${at}.${field}`, "mais prontas do que o total");
      return { total, done };
    };
    const parts = counted("parts");
    return {
      issue,
      title: text(c.title, `${at}.title`, 200, true),
      summary: c.summary === undefined ? "" : text(c.summary, `${at}.summary`, 400),
      issues: counted("issues"),
      parts: { ...parts, remaining: parts.total - parts.done },
      open: (c.open === undefined ? [] : list(c.open, `${at}.open`, 30)).map((o, k) => {
        const row = record(o, `${at}.open[${k}]`);
        return { issue: whole(row.issue, `${at}.open[${k}].issue`, 1e7), title: text(row.title, `${at}.open[${k}].title`, 200, true) };
      }),
    };
  });
  const left = epics.filter((c) => c.parts.remaining > 0);
  return { epics, totals: { covers: left.length, remainingParts: left.reduce((sum, c) => sum + c.parts.remaining, 0) } };
}

function content(value: unknown, path: string): ProgressContent {
  const c = record(value, path);
  const entries = list(c.entries, `${path}.entries`, 100).map((e, i) => entry(e, `${path}.entries[${i}]`));
  ids(entries.map((e) => e.id), `${path}.entries`);
  const internal = record(c.internal, `${path}.internal`);
  const difficultyRows = list(c.difficulties, `${path}.difficulties`, 20).map((d, i) => {
    const row = record(d, `${path}.difficulties[${i}]`);
    return {
      given: row.id === undefined ? undefined : id(row.id, `${path}.difficulties[${i}].id`),
      text: text(row.text, `${path}.difficulties[${i}].text`, 600, true),
      needs: text(row.needs, `${path}.difficulties[${i}].needs`, 600),
    };
  });
  const difficultyIds = stableIds(difficultyRows.map((d) => d.given), "d");
  const difficulties = difficultyRows.map((d, i) => ({ id: difficultyIds[i], text: d.text, needs: d.needs }));
  const stepRows = list(c.nextSteps, `${path}.nextSteps`, 20).map((n, i) => {
    const row = record(n, `${path}.nextSteps[${i}]`);
    return {
      given: row.id === undefined ? undefined : id(row.id, `${path}.nextSteps[${i}].id`),
      text: text(row.text, `${path}.nextSteps[${i}].text`, 600, true),
    };
  });
  const stepIds = stableIds(stepRows.map((n) => n.given), "n");
  const nextSteps = stepRows.map((n, i) => ({ id: stepIds[i], text: n.text }));

  const result: ProgressContent = {
    window: reportWindow(c.window, `${path}.window`),
    headline: text(c.headline, `${path}.headline`, 400),
    entries,
    internal: { count: whole(internal.count, `${path}.internal.count`, 1e5), text: text(internal.text, `${path}.internal.text`, 600) },
    difficulties,
    nextSteps,
    usage: usage(c.usage, `${path}.usage`),
  };
  const issues = new Set(entries.map((e) => e.issue));
  const shots = c.shots === undefined ? [] : list(c.shots, `${path}.shots`, MAX_SHOTS).map((s, i) => shot(s, `${path}.shots[${i}]`, issues));
  ids(shots.map((s) => s.id), `${path}.shots`);
  // Every delivery on show that has something to show (anything but "próximo") comes with its own print.
  const shown = new Set(shots.map((s) => s.issue));
  const missing = entries.filter((e) => !e.hidden && e.status !== "proximo" && !shown.has(e.issue)).map((e) => `#${e.issue}`);
  if (missing.length > 0) refuse(`${path}.shots`, `falta print destas entregas: ${missing.join(", ")}`);
  if (c.shots !== undefined) result.shots = shots;
  if (c.sprint !== undefined) result.sprint = sprintBlock(c.sprint, `${path}.sprint`);
  if (c.gaps !== undefined) result.gaps = list(c.gaps, `${path}.gaps`, 200).map((g, i) => gap(g, `${path}.gaps[${i}]`));
  if (c.access !== undefined) result.access = access(c.access, `${path}.access`);
  return result;
}

/* ---------- Entry point ---------- */

export function parseDraft(body: unknown): ParsedDraft {
  try {
    // First, and before reading any field: whatever else is wrong, a body this big is not read any further.
    const json = JSON.stringify(body);
    if (json === undefined) return { ok: false, error: "corpo: esperado um objeto JSON" };
    if (new TextEncoder().encode(json).length > MAX_PAYLOAD_BYTES) {
      return { ok: false, error: `corpo: o rascunho passa de ${MAX_PAYLOAD_BYTES / 1024} KB (prints incluídos)` };
    }
    const root = record(body, "corpo");
    if (root.produto !== undefined && root.produto !== "GeoCloud") return refuse("produto", 'por enquanto só "GeoCloud"');
    return { ok: true, produto: "GeoCloud", content: content(root.content, "content") };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    return { ok: false, error: "corpo: rascunho ilegível" };
  }
}
