// The picture of "Resumo para a diretoria": a dark panel in the look of the Claude Code /stats screen
// ("Resultados" and "Visão Geral" with a strip by hour), drawn by RoadS and fetched by the e-mail
// client through a public link. A pure module on purpose: no "server-only", no "@/" imports, no JSX, so
// `node --experimental-strip-types` runs it for the tests and the CLI, and the route only wires
// `next/og` (Satori + resvg) into `renderVisualPng`.
//
// Two steps keep it testable: `visualModel` turns the resolved report into the exact words and numbers
// of the picture, and `buildVisual` lays them out as a Satori element tree (flexbox only, every height
// known beforehand: Satori has no grid and needs the canvas size as a number).
//
// The numbers are `usage.totals` as the collector computed them, never a recount: the conferência table
// the user ticks, the e-mail and this picture must all say the same thing. Model names stay out on
// purpose (the CEO does not need them); `byModel` and `favoriteModel` remain on the report for others.
import { localDay } from "../progress-report.ts";
import type { EntryStatus, ProgressContent, ReportWindow } from "../progress-report.ts";

export const VISUAL_WIDTH = 1200;
export const VISUAL_FONT_FAMILY = "Inter";
/** Inter (SIL OFL), latin subset in woff, stored next to this file; only these weights are drawn. */
export const VISUAL_FONT_FILES = [
  { weight: 400, file: "inter-latin-400-normal.woff" },
  { weight: 600, file: "inter-latin-600-normal.woff" },
  { weight: 700, file: "inter-latin-700-normal.woff" },
] as const;

/* ---------- numbers and dates (pt-BR; spelled out by hand so ICU data never matters) ---------- */

const finite = (n: number): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
const two = (n: number): string => String(n).padStart(2, "0");
const oneDecimal = (v: number): string => String(Math.round(v * 10) / 10).replace(".", ",");

/** 1234 -> "1.234": in Portuguese the dot groups thousands. */
export function wholeNumber(n: number): string {
  return String(Math.round(finite(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * 45600 -> "45,6k", 7800000 -> "7,8M", 12300000000 -> "12,3B", 4000000 -> "4M". The suffixes are
 * the ones of the /stats panel; the decimal is a comma because a dot would read as thousands here.
 */
export function compactCount(n: number): string {
  let v = finite(n);
  if (v >= 999.5 && v < 1e3) v = 1e3;
  if (v >= 1e9) return `${oneDecimal(v / 1e9)}B`;
  // A value that rounds up to 1000 of the smaller unit is written in the next one ("1M", not "1000k").
  if (v >= 1e6) return Math.round(v / 1e5) / 10 >= 1000 ? `${oneDecimal(v / 1e9)}B` : `${oneDecimal(v / 1e6)}M`;
  if (v >= 1e3) return Math.round(v / 1e2) / 10 >= 1000 ? `${oneDecimal(v / 1e6)}M` : `${oneDecimal(v / 1e3)}k`;
  return String(Math.round(v));
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dateParts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "2026-10-01" -> "qui 01/10": the weekday comes from calendar arithmetic, not from the machine's zone. */
export function dayLabel(iso: string): string {
  const p = dateParts(iso);
  return `${WEEKDAYS[p.weekday]} ${two(p.day)}/${two(p.month)}`;
}

function periodLabel(first: string, last: string): string {
  const a = dateParts(first);
  const b = dateParts(last);
  const left = `${a.day} ${MONTHS[a.month - 1]}`;
  return first === last ? left : `${left} – ${b.day} ${MONTHS[b.month - 1]}`;
}

/**
 * The São Paulo days a window includes. Its end is exclusive (midnight of the day after the last one),
 * so the last day is the day of the instant just before it; an empty window still names its one day.
 * Not parseable dates give no days at all.
 */
export function windowDays(window: ReportWindow): string[] {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const first = localDay(new Date(start));
  const last = localDay(new Date(Math.max(start, end - 1)));
  const [year, month, day] = first.split("-").map(Number);
  const days: string[] = [];
  for (let i = 0; i < 400; i++) {
    const iso = new Date(Date.UTC(year, month - 1, day + i)).toISOString().slice(0, 10);
    days.push(iso);
    if (iso >= last) break;
  }
  return days;
}

/* ---------- what the picture says ---------- */

type ResultKey = Extract<EntryStatus, "concluido" | "em_validacao" | "em_andamento" | "bloqueado">;
export type VisualResult = { key: ResultKey; label: string; count: number };
export type VisualTile = { label: string; value: string; extra?: string };
export type VisualRow = { date: string; label: string; hours: string; levels: number[] };
export type VisualModel = {
  title: string;
  period: string;
  subtitle: string;
  /** Cleaned names of the projects added up; empty unless two or more. */
  products: string[];
  results: VisualResult[];
  tiles: VisualTile[];
  strip: { rows: VisualRow[] };
  footer: string;
};

const TITLE_DEFAULT = "AI usage";
const TITLE_MAX = 60;
const FOOTER = "Tokens são os pedaços de texto que o Claude lê (entrada) e escreve (saída). k = mil · M = milhão · B = bilhão.";
/** More than this many rows would make a picture nobody reads; the latest days are the ones that matter. */
const MAX_STRIP_ROWS = 14;
const QUIET = "sem atividade";

/**
 * The title of the picture is data (`usage.label`, set by whoever runs the collector), never a name in
 * the code. It is plain text: one line, glyphs the font has (anything else could send the renderer to
 * the network for a fallback font), at most 60 characters; with nothing usable it is "AI usage".
 */
export function visualTitle(label: unknown): string {
  if (typeof label !== "string") return TITLE_DEFAULT;
  const text = label
    .replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();
  return text || TITLE_DEFAULT;
}

/** "A", "A e B", "A, B e C": the way a Portuguese sentence lists names. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

const PRODUCT_MAX = 30;

/**
 * Names of the projects whose usage is counted (`usage.products`, user data): cleaned like the title,
 * each capped at 30 characters, blanks and repeats dropped. Fewer than two means the picture is about
 * one project and says nothing extra.
 */
export function visualProducts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const name = raw
      .replace(/[^ -~ -ÿ–]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PRODUCT_MAX)
      .trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen.length >= 2 ? seen : [];
}

/** Room for the subtitle line inside the 1200 px picture (same box as the title). */
const SUBTITLE_BOX = VISUAL_WIDTH - 2 * 24 - 2 * 6;
const SUBTITLE_MIN_SIZE = 20;

/**
 * "Projetos: A, B e C" shortened until the whole subtitle fits at the smallest size: names are dropped
 * from the end and counted ("A, B e mais 6 projetos"), so eight long names can never spill.
 */
function subtitleWith(before: string, names: string[], after: string): string {
  const build = (shown: number) => {
    const rest = names.length - shown;
    const list = rest === 0 ? joinNames(names) : `${names.slice(0, shown).join(", ")} e mais ${rest} ${rest === 1 ? "projeto" : "projetos"}`;
    return `${before} · Projetos: ${list} · ${after}`;
  };
  for (let shown = names.length; shown >= 1; shown--) {
    const line = build(shown);
    if (estimateTextWidth(line, SUBTITLE_MIN_SIZE) <= SUBTITLE_BOX) return line;
  }
  return `${before} · Projetos: ${names.length} projetos · ${after}`;
}

/** 24 non-negative numbers whatever came in (the report is JSON from a database). */
function cleanHourly(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 24 }, (_, hour) => finite(source[hour]));
}

/** First to last hour with messages: "05h–21h", just "05h" for a single hour, "sem atividade" for none. */
export function hoursLabel(hourly: readonly number[]): string {
  let first = -1;
  let last = -1;
  hourly.forEach((messages, hour) => {
    if (messages > 0) {
      if (first < 0) first = hour;
      last = hour;
    }
  });
  if (first < 0) return QUIET;
  return first === last ? `${two(first)}h` : `${two(first)}h–${two(last)}h`;
}

/** Cell intensity 0..4: 0 is silence, 4 the busiest hour of the whole strip. */
export function heatLevel(messages: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
  if (messages <= 0 || busiest <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * messages) / busiest))) as 1 | 2 | 3 | 4;
}

const RESULT_LABEL: Record<ResultKey, string> = {
  concluido: "Concluídas",
  em_validacao: "Em validação",
  em_andamento: "Em andamento",
  bloqueado: "Bloqueadas",
};

/** The numbers the picture draws. The model keeps the others (sessions, active days, peak) for the e-mail text. */
const PICTURE_TILES = ["Mensagens", "Tokens de entrada", "Tokens de saída"];

export function visualModel(content: ProgressContent): VisualModel {
  const usage = content.usage;
  const totals = usage?.totals;

  const days = windowDays(content.window);
  const dates = (days.length > 0 ? days : (usage?.days ?? []).map((d) => d.date)).slice(-MAX_STRIP_ROWS);
  const byDate = new Map((usage?.days ?? []).map((d) => [d.date, cleanHourly(d.hourly)]));
  const hourlyOf = (date: string) => byDate.get(date) ?? cleanHourly(null);
  const busiest = Math.max(0, ...dates.flatMap(hourlyOf));
  const rows: VisualRow[] = dates.map((date) => {
    const hourly = hourlyOf(date);
    return { date, label: dayLabel(date), hours: hoursLabel(hourly), levels: hourly.map((v) => heatLevel(v, busiest)) };
  });

  // Visible entries by status of the content as the user left it; "próximo" is not a result yet.
  const counts: Record<ResultKey, number> = { concluido: 0, em_validacao: 0, em_andamento: 0, bloqueado: 0 };
  for (const e of content.entries) if (!e.hidden && e.status in counts) counts[e.status as ResultKey] += 1;
  const results = (["concluido", "em_validacao", "em_andamento", "bloqueado"] as const)
    .filter((key) => key !== "bloqueado" || counts[key] > 0)
    .map((key) => ({ key, label: RESULT_LABEL[key], count: counts[key] }));

  const messages = finite(totals?.messages ?? 0);
  const peak = usage?.peakHour;
  const tiles: VisualTile[] = [
    { label: "Sessões", value: wholeNumber(totals?.sessions ?? 0) },
    { label: "Mensagens", value: messages >= 1e6 ? compactCount(messages) : wholeNumber(messages) },
    { label: "Tokens de entrada", value: compactCount(totals?.tokens?.input ?? 0) },
    { label: "Tokens de saída", value: compactCount(totals?.tokens?.output ?? 0) },
    { label: "Dias ativos", value: String(Math.round(finite(totals?.activeDays ?? 0))), extra: `de ${dates.length}` },
    { label: "Horário de pico", value: typeof peak === "number" && Number.isInteger(peak) && peak >= 0 && peak <= 23 ? `${two(peak)}h` : "–" },
  ];

  const period = dates.length > 0 ? periodLabel(dates[0], dates[dates.length - 1]) : "–";
  const products = visualProducts(usage?.products);
  const daysText = `${period} · ${dates.length} ${dates.length === 1 ? "dia" : "dias"}`;
  return {
    title: visualTitle(usage?.label),
    period,
    subtitle: products.length > 0 ? subtitleWith(daysText, products, "horário de São Paulo") : `${daysText} · horário de São Paulo`,
    products,
    results,
    tiles,
    strip: { rows },
    footer: FOOTER,
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** For the alt attribute of the image: what a person who cannot see it (or has it blocked) needs to know. */
export function visualAlt(content: ProgressContent): string {
  const m = visualModel(content);
  const count = (key: ResultKey) => m.results.find((r) => r.key === key)?.count ?? 0;
  const blocked = count("bloqueado");
  const tile = (label: string) => m.tiles.find((t) => t.label === label);
  return [
    `${m.title}: uso do Claude de ${m.period}.`,
    ...(m.products.length > 0 ? [`Projetos somados: ${joinNames(m.products)}.`] : []),
    `Resultados: ${count("concluido")} ${plural(count("concluido"), "concluída", "concluídas")}, ${count("em_validacao")} em validação, ${count("em_andamento")} em andamento${
      blocked > 0 ? `, ${blocked} ${plural(blocked, "bloqueada", "bloqueadas")}` : ""
    }.`,
    `${tile("Mensagens")?.value} mensagens, ${tile("Tokens de entrada")?.value} tokens de entrada e ${tile("Tokens de saída")?.value} de saída.`,
  ].join(" ");
}

/* ---------- sizing text that must not spill ---------- */

/**
 * Advance widths of bold Inter in em, rounded UP on purpose: this decides when a number must shrink, and
 * guessing too wide only costs a point of font size, while guessing too narrow breaks the layout.
 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) em += 0.64;
    else if (/[A-Z]/.test(ch)) em += 0.8;
    else if (/[a-zà-ÿ]/.test(ch)) em += 0.62;
    else if (ch === " ") em += 0.3;
    else if (/[.,:;'|!]/.test(ch)) em += 0.32;
    else em += 0.65;
  }
  return Math.ceil(em * size);
}

/** The biggest font size, from `max` down to `min`, at which `text` still fits in `box` pixels. */
export function fitFontSize(text: string, box: number, max: number, min: number): number {
  for (let size = max; size > min; size--) if (estimateTextWidth(text, size) <= box) return size;
  return min;
}

/** Tile values are big (52 px) and shrink only as far as needed. */
export const tileValueSize = (value: string, box: number): number => fitFontSize(value, box, 52, 20);

/* ---------- the drawing: a Satori element tree ---------- */

type Style = Record<string, string | number>;
export type VisualChild = VisualNode | string;
export interface VisualNode {
  type: "div";
  props: { style: Style; children?: VisualChild | VisualChild[] };
}

/** Every node is flex: Satori wants an explicit display on anything with more than one child. */
function h(style: Style, children?: VisualChild | VisualChild[]): VisualNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

const COLOR = {
  page: "#111110",
  card: "#1c1c1b",
  border: "rgba(255,255,255,0.07)",
  tile: "#292928",
  empty: "#2e2e2d",
  ink: "#f3f3f1",
  ink2: "#aeada6",
  muted: "#86857f",
  tab: "#3a3a39",
  // Blue ramp for the hour strip, brighter = more messages (on a dark card the ramp runs light-ward);
  // checked against the card color: the faintest step keeps 3.16:1.
  heat: ["#256abf", "#3987e5", "#86b6ef", "#cde2fb"],
  done: "#0ca30c",
  validation: "#fab219",
  progress: "#3987e5",
  blocked: "#e0504f",
  onIcon: "#0b0b0b",
};

const L = {
  page: 24, // margin around the cards
  cardPad: 30,
  cardGap: 20,
  cardRadius: 28,
  tabH: 44,
  tileH: 112,
  tileGap: 14,
  tilePadX: 24,
  cellGap: 6,
  dayLabelW: 268, // "qua 30/09 · 06h–16h" and the longest, "ter 29/09 · sem atividade", both fit
  dayLabelGap: 14,
  hoursH: 26,
  resultsH: 88,
  titleH: 72,
  footerH: 52,
};

const innerW = VISUAL_WIDTH - 2 * L.page - 2 * L.cardPad; // 1092
const titleBox = VISUAL_WIDTH - 2 * L.page - 2 * 6; // the title sits 6 px inside the page margin
const BORDER = 2; // 1 px of border above and below every card (border-box)

function tab(label: string, right: string): VisualNode {
  return h({ width: "100%", height: L.tabH, justifyContent: "space-between", alignItems: "center" }, [
    h(
      { backgroundColor: COLOR.tab, color: COLOR.ink, fontSize: 25, fontWeight: 600, padding: "0 20px", height: 40, alignItems: "center", borderRadius: 12 },
      label
    ),
    h({ fontSize: 23, color: COLOR.ink2, fontWeight: 400 }, right),
  ]);
}

function card(height: number, children: VisualChild[]): VisualNode {
  return h(
    {
      width: "100%",
      height,
      flexDirection: "column",
      backgroundColor: COLOR.card,
      border: `1px solid ${COLOR.border}`,
      borderRadius: L.cardRadius,
      padding: L.cardPad,
    },
    children
  );
}

function tileNode(tile: VisualTile, box: number): VisualNode {
  const extraW = tile.extra ? 26 * 4 + 10 : 0; // room for "de 7" and its margin; a generous constant
  const size = tileValueSize(tile.value, box - extraW);
  return h(
    {
      flex: 1,
      height: L.tileH,
      flexDirection: "column",
      justifyContent: "center",
      backgroundColor: COLOR.tile,
      border: `1px solid ${COLOR.border}`,
      borderRadius: 18,
      padding: `0 ${L.tilePadX}px`,
    },
    [
      h({ height: 30, alignItems: "center", fontSize: 24, color: COLOR.ink2, whiteSpace: "nowrap" }, tile.label),
      // A fixed-height box with the text stuck to the bottom keeps every baseline equal, even when a value
      // shrinks or carries a suffix ("de 7"); Satori does not honor align-items: baseline.
      h({ height: 64, alignItems: "flex-end", whiteSpace: "nowrap" }, [
        h({ fontSize: size, fontWeight: 700, color: COLOR.ink, lineHeight: 1.2, letterSpacing: -0.5 }, tile.value),
        ...(tile.extra ? [h({ fontSize: 26, fontWeight: 400, color: COLOR.muted, lineHeight: 1.2, marginLeft: 10, marginBottom: 6 }, tile.extra)] : []),
      ]),
    ]
  );
}

/** A 32 px icon whose SHAPE changes with the state, so it never relies on color alone. */
function statusIcon(key: ResultKey): VisualNode {
  const D = 32;
  const base: Style = { width: D, height: D, borderRadius: D / 2, position: "relative", flexShrink: 0 };
  if (key === "concluido") {
    return h({ ...base, backgroundColor: COLOR.done, alignItems: "center", justifyContent: "center" }, [
      h({
        position: "absolute",
        left: 11,
        top: 5,
        width: 9,
        height: 17,
        borderRight: `4px solid ${COLOR.onIcon}`,
        borderBottom: `4px solid ${COLOR.onIcon}`,
        transform: "rotate(45deg)",
      }),
    ]);
  }
  if (key === "em_validacao") {
    return h({ ...base, border: `4px solid ${COLOR.validation}`, alignItems: "center", justifyContent: "center" }, [
      h({ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR.validation }),
    ]);
  }
  if (key === "em_andamento") {
    return h({
      ...base,
      border: `4px solid ${COLOR.progress}`,
      backgroundImage: `linear-gradient(90deg, ${COLOR.progress} 50%, rgba(0,0,0,0) 50%)`,
    });
  }
  return h({ ...base, backgroundColor: COLOR.blocked, alignItems: "center", justifyContent: "center" }, [
    h({ width: 16, height: 4, backgroundColor: COLOR.onIcon, borderRadius: 2 }),
  ]);
}

function resultNode(result: VisualResult, first: boolean, compact: boolean): VisualNode {
  return h(
    {
      flex: 1,
      height: 76,
      alignItems: "center",
      ...(first ? {} : { borderLeft: `1px solid ${COLOR.border}`, paddingLeft: compact ? 22 : 30 }),
    },
    [
      // No fixed width: two digits must push the label aside instead of running into it.
      h({ fontSize: compact ? 56 : 68, fontWeight: 700, color: COLOR.ink, lineHeight: 1, letterSpacing: -1, flexShrink: 0 }, String(result.count)),
      h({ flexDirection: "column", marginLeft: 14 }, [
        statusIcon(result.key),
        h({ fontSize: compact ? 22 : 26, fontWeight: 600, color: COLOR.ink, marginTop: 8, whiteSpace: "nowrap" }, result.label),
      ]),
    ]
  );
}

function cell(size: number, color: string): VisualNode {
  return h({ width: size, height: size, borderRadius: Math.round(size * 0.26), backgroundColor: color, flexShrink: 0 });
}

function stripNode(rows: VisualRow[]): { node: VisualNode; height: number } {
  const gap = L.cellGap;
  const gridW = innerW - L.dayLabelW - L.dayLabelGap;
  const size = Math.floor((gridW - 23 * gap) / 24);
  const step = size + gap;

  const marks: VisualNode[] = [];
  for (let hour = 0; hour < 24; hour += 3) {
    marks.push(h({ position: "absolute", left: hour * step, top: 0, fontSize: 21, color: COLOR.muted, whiteSpace: "nowrap" }, `${two(hour)}h`));
  }
  const header = h({ height: L.hoursH, width: "100%", position: "relative" }, [
    h({ width: L.dayLabelW + L.dayLabelGap, flexShrink: 0 }),
    h({ position: "relative", width: gridW, height: L.hoursH }, marks),
  ]);

  const body = rows.map((row, i) =>
    h({ alignItems: "center", marginTop: i === 0 ? 0 : gap }, [
      // The label box is exactly one cell tall, so the height of the strip is plain arithmetic.
      h({ width: L.dayLabelW, height: size, marginRight: L.dayLabelGap, alignItems: "center", whiteSpace: "nowrap", flexShrink: 0 }, [
        h({ fontSize: 22, lineHeight: 1, color: COLOR.ink }, row.label),
        h({ fontSize: 20, lineHeight: 1, color: COLOR.ink2, marginLeft: 10 }, `· ${row.hours}`),
      ]),
      h(
        { gap },
        row.levels.map((level) => cell(size, level === 0 ? COLOR.empty : COLOR.heat[level - 1]))
      ),
    ])
  );

  const legend = h({ width: "100%", marginTop: 18, justifyContent: "space-between", alignItems: "center", height: 30 }, [
    h({ fontSize: 23, color: COLOR.ink2, fontWeight: 400 }, "mensagens por hora"),
    h({ alignItems: "center", gap: 6 }, [
      h({ fontSize: 21, color: COLOR.muted, marginRight: 6 }, "menos"),
      ...[COLOR.empty, ...COLOR.heat].map((color) => cell(22, color)),
      h({ fontSize: 21, color: COLOR.muted, marginLeft: 6 }, "mais"),
    ]),
  ]);

  const height = L.hoursH + 6 + rows.length * size + (rows.length - 1) * gap + 18 + 30;
  return { node: h({ flexDirection: "column", width: "100%" }, [header, h({ height: 6 }), h({ flexDirection: "column" }, body), legend]), height };
}

export function buildVisual(content: ProgressContent): { tree: VisualNode; width: number; height: number; alt: string } {
  const m = visualModel(content);

  // --- Resultados
  const compact = m.results.length > 3;
  const resultsCardH = 2 * L.cardPad + BORDER + L.tabH + 18 + L.resultsH;
  const resultsCard = card(resultsCardH, [
    tab("Resultados", "entregas do período"),
    h({ height: 18 }),
    h(
      { width: "100%", height: L.resultsH, alignItems: "center" },
      m.results.map((r, i) => resultNode(r, i === 0, compact))
    ),
  ]);

  // --- Visão Geral: one row of tiles, then the strip by hour
  const strip = stripNode(m.strip.rows);
  const overviewH = 2 * L.cardPad + BORDER + L.tabH + 18 + L.tileH + 26 + strip.height;
  const boxFor = (perRow: number) => Math.floor((innerW - (perRow - 1) * L.tileGap) / perRow) - 2 * L.tilePadX;
  const shown = m.tiles.filter((t) => PICTURE_TILES.includes(t.label));
  const overviewCard = card(overviewH, [
    tab("Visão Geral", m.period),
    h({ height: 18 }),
    h({ width: "100%", gap: L.tileGap }, shown.map((t) => tileNode(t, boxFor(shown.length)))),
    h({ height: 26 }),
    strip.node,
  ]);

  // --- Title and footnote
  const title = h({ width: "100%", height: L.titleH, alignItems: "center", paddingLeft: 6, paddingRight: 6 }, [
    h({ flexDirection: "column" }, [
      h({ fontSize: fitFontSize(m.title, titleBox, 38, 22), fontWeight: 700, color: COLOR.ink, lineHeight: 1.15, letterSpacing: -0.5, whiteSpace: "nowrap" }, m.title),
      h({ fontSize: fitFontSize(m.subtitle, titleBox, 24, SUBTITLE_MIN_SIZE), color: COLOR.ink2, marginTop: 4, whiteSpace: "nowrap" }, m.subtitle),
    ]),
  ]);
  const footer = h({ width: "100%", height: L.footerH, flexDirection: "column", paddingLeft: 6, paddingRight: 6, paddingTop: 4 }, [
    h({ fontSize: 21, color: COLOR.muted, lineHeight: 1.4 }, m.footer),
  ]);

  const height = L.page + L.titleH + 16 + resultsCardH + L.cardGap + overviewH + L.cardGap + L.footerH + L.page;
  const tree = h(
    {
      position: "relative",
      width: VISUAL_WIDTH,
      height,
      flexDirection: "column",
      backgroundColor: COLOR.page,
      padding: L.page,
      fontFamily: VISUAL_FONT_FAMILY,
      color: COLOR.ink,
    },
    [title, h({ height: 16 }), resultsCard, h({ height: L.cardGap }), overviewCard, h({ height: L.cardGap }), footer]
  );
  return { tree, width: VISUAL_WIDTH, height, alt: visualAlt(content) };
}

export function visualSize(content: ProgressContent): { width: number; height: number } {
  const { width, height } = buildVisual(content);
  return { width, height };
}

/* ---------- rendering (the framework is injected: this module never imports next/og) ---------- */

export type VisualFont = { name: string; weight: 400 | 600 | 700; style: "normal"; data: ArrayBuffer };

/**
 * The shape of `ImageResponse` from `next/og` that matters here. The parameters are typed `never` so the
 * real class (which wants a React element) fits without a cast: the tree is plain objects with `type`
 * and `props`, which is all Satori reads.
 */
export type ImageResponseConstructor = new (element: never, options: never) => { arrayBuffer(): Promise<ArrayBuffer> };

/**
 * Draws the PNG. Rendering runs to the end before anything is answered, so a failure is an error the
 * caller can turn into a clean 500 instead of a truncated 200.
 */
export async function renderVisualPng(
  content: ProgressContent,
  deps: { ImageResponse: ImageResponseConstructor; fonts: VisualFont[] }
): Promise<Uint8Array<ArrayBuffer>> {
  const { tree, width, height } = buildVisual(content);
  const response = new deps.ImageResponse(tree as never, { width, height, fonts: deps.fonts } as never);
  return new Uint8Array(await response.arrayBuffer());
}
