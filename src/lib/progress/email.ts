// The e-mail of "Resumo para a diretoria": short, in plain language, built from the report as the user
// left it (edits already applied, hidden entries and `sources` left out). A pure module so the screen's
// preview, its "copy" button and the CLI all print the very same thing.
//
// The HTML must survive Outlook on the desktop (the Word engine) and a paste into a new message:
// tables only, inline styles, `bgcolor`/`width` attributes, 600 px, no classes, no <style>, no flex or
// grid. Rounded corners are a bonus that Outlook ignores. Every piece of text is escaped; the only
// links are https ones.
import { STATUS_LABEL } from "../progress-report.ts";
import type { EmailBuild, EmailOptions, EntryStatus, ProgressContent, ProgressEntry } from "../progress-report.ts";
import { joinNames, visualAlt, visualModel, visualSize, windowDays } from "./visual.ts";

/* ---------- escaping and URLs ---------- */

/** Text for an HTML body or a quoted attribute. Control characters (never valid in HTML) are dropped. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const body = (value: unknown): string => escapeHtml(value).replace(/\r?\n/g, "<br>");
const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A link people can click: https and nothing else (no javascript:, no plain http). */
const safeLink = (url: unknown): string | null => (typeof url === "string" && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null);

/**
 * A picture source: an https link; or a path of this very site, which is what the screen's preview uses
 * (it renders inside the app); or a PNG/JPEG data URI, which the local file written by the CLI uses.
 */
const safeImage = (url: unknown): string | null => {
  if (typeof url !== "string") return null;
  if (safeLink(url)) return url;
  if (/^\/(?!\/)[^\s"'<>]*$/.test(url)) return url;
  return /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url) ? url : null;
};

/* ---------- the window in words ---------- */

const dayMonth = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** "28/09 a 29/09" (the window's end is exclusive, so this is the first and the last day it includes). */
function windowRange(content: ProgressContent): string | null {
  const days = windowDays(content.window);
  if (days.length === 0) return null;
  const first = dayMonth(days[0]);
  const last = dayMonth(days[days.length - 1]);
  return first === last ? first : `${first} a ${last}`;
}

export function emailSubject(content: ProgressContent): string {
  const range = windowRange(content);
  return range ? `GeoCloud: andamento de ${range}` : "GeoCloud: andamento";
}

/* ---------- what goes where ---------- */

type CounterStatus = Extract<EntryStatus, "concluido" | "em_validacao" | "em_andamento" | "bloqueado">;

const COLOR = {
  page: "#efeeea",
  card: "#ffffff",
  head: "#111110",
  headSub: "#c9c8c0",
  ink: "#1c1c1b",
  muted: "#5f5e59",
  rule: "#e4e3dd",
  link: "#256abf",
  amber: "#fab219",
  neutral: "#8a8984",
};
const CHIP: Record<CounterStatus, { bg: string; fg: string }> = {
  concluido: { bg: "#117a2b", fg: "#ffffff" },
  em_validacao: { bg: "#fab219", fg: "#2b1d00" },
  em_andamento: { bg: "#256abf", fg: "#ffffff" },
  bloqueado: { bg: "#c42b2b", fg: "#ffffff" },
};
const SECTION_COLOR = { ...Object.fromEntries(Object.entries(CHIP).map(([k, v]) => [k, v.bg])) } as Record<CounterStatus, string>;

const FONT = "'Segoe UI',Arial,Helvetica,sans-serif";
const CARD_WIDTH = 600;
const PAD = 28;
const SHOT_WIDTH = CARD_WIDTH - 2 * PAD;
/** The picture has a floor of two shots: the screens only ever hold this many. */
const MAX_SHOTS = 2;

const visibleOf = (content: ProgressContent): ProgressEntry[] =>
  (Array.isArray(content.entries) ? content.entries : []).filter((e) => e && !e.hidden && (clean(e.title) || clean(e.summary)));

/* ---------- HTML pieces (tables, inline styles) ---------- */

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const table = (attrs: string, rows: string): string => `<table ${TABLE}${attrs ? ` ${attrs}` : ""}>${rows}</table>`;
const row = (...cells: string[]): string => `<tr>${cells.join("")}</tr>`;
const cell = (style: string, inner: string, attrs = ""): string => `<td${attrs ? ` ${attrs}` : ""} style="${style}">${inner}</td>`;
// `mso-line-height-rule:exactly` makes Outlook honor the pixel line heights.
const font = (size: number, line: number, color: string, extra = ""): string =>
  `font-family:${FONT};font-size:${size}px;line-height:${line}px;color:${color};mso-line-height-rule:exactly;${extra}`;
const full = (rows: string): string => table('width="100%" style="width:100%;"', rows);
const padded = (top: number, bottom: number, inner: string): string => row(cell(`padding:${top}px ${PAD}px ${bottom}px ${PAD}px;`, inner));

function chip(status: CounterStatus, count: number): string {
  const { bg, fg } = CHIP[status];
  return table(
    'style="border-collapse:separate;"',
    row(cell(`${font(13, 18, fg)}font-weight:bold;padding:5px 12px;border-radius:12px;white-space:nowrap;background-color:${bg};`, `${escapeHtml(STATUS_LABEL[status])}: ${count}`, `bgcolor="${bg}"`))
  );
}

function counters(counts: Record<CounterStatus, number>): string {
  const shown = (["concluido", "em_validacao", "em_andamento"] as const).concat(counts.bloqueado > 0 ? (["bloqueado"] as never[]) : []);
  const cells = shown.map((status) => cell("", chip(status, counts[status]))).join(cell("width:8px;font-size:1px;", "&nbsp;", 'width="8"'));
  return padded(18, 4, table("", row(cells)));
}

function heading(label: string, color: string): string {
  return padded(
    22,
    0,
    full(
      row(
        cell(`width:4px;background-color:${color};font-size:1px;line-height:1px;`, "&nbsp;", `width="4" bgcolor="${color}"`),
        cell(font(17, 24, COLOR.ink, "padding-left:10px;"), `<b>${escapeHtml(label)}</b>`)
      )
    )
  );
}

function entryBlock(entry: ProgressEntry): string {
  const summary = clean(entry.summary);
  return padded(
    10,
    0,
    full(row(cell(font(15, 22, COLOR.ink), `<b>${body(clean(entry.title))}</b>`)) + (summary ? row(cell(font(15, 22, COLOR.ink, "padding-top:2px;"), body(summary))) : ""))
  );
}

function bulletBlock(inner: string): string {
  return padded(10, 0, full(row(cell(font(15, 22, COLOR.ink, "width:14px;"), "&bull;", 'width="14" valign="top"'), cell(font(15, 22, COLOR.ink), inner, 'valign="top"'))));
}

function picture(src: string, width: number, height: number | null, alt: string): string {
  const size = `width="${width}"${height ? ` height="${height}"` : ""}`;
  const style = `display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;`;
  return `<img src="${escapeHtml(src)}" ${size} alt="${escapeHtml(alt)}" border="0" style="${style}">`;
}

/* ---------- the three groups of numbers ---------- */

function claudeNumbers(tiles: { label: string; value: string }[], delivered: number): { value: string; label: string }[] {
  const value = (label: string) => tiles.find((t) => t.label === label)?.value ?? "0";
  return [
    { value: value("Sessões"), label: "sessões" },
    { value: value("Mensagens"), label: "mensagens" },
    { value: String(delivered), label: "entregas concluídas" },
  ];
}

/* ---------- the e-mail ---------- */

export function buildEmail(content: ProgressContent, options: EmailOptions): EmailBuild {
  const subject = emailSubject(content);
  const range = windowRange(content);
  const headline = clean(content.headline);
  const visible = visibleOf(content);
  const by = (status: EntryStatus) => visible.filter((e) => e.status === status);
  const counts: Record<CounterStatus, number> = {
    concluido: by("concluido").length,
    em_validacao: by("em_validacao").length,
    em_andamento: by("em_andamento").length,
    bloqueado: by("bloqueado").length,
  };
  const difficulties = (Array.isArray(content.difficulties) ? content.difficulties : []).filter((d) => clean(d?.text));
  const nextSteps = (Array.isArray(content.nextSteps) ? content.nextSteps : []).filter((s) => clean(s?.text));
  const upcoming = by("proximo");
  const internal = content.internal && content.internal.count > 0 ? clean(content.internal.text) : "";
  const shots = (Array.isArray(content.shots) ? content.shots : []).slice(0, MAX_SHOTS);
  // The picture's own title (the label from the data, or "AI usage") and numbers, so the text under a
  // blocked image says what the image would have said.
  const drawing = visualModel(content);
  const numbers = claudeNumbers(drawing.tiles, counts.concluido);
  const visualSrc = safeImage(options.visualUrl);
  const roadsLink = safeLink(options.roadsUrl);
  const size = visualSize(content);

  const rows: string[] = [];

  // Title and period.
  rows.push(
    row(
      cell(
        `padding:24px ${PAD}px 22px ${PAD}px;background-color:${COLOR.head};`,
        full(
          row(cell(font(26, 32, "#ffffff", "font-weight:bold;"), "<b>GeoCloud: andamento</b>")) +
            (range ? row(cell(font(14, 20, COLOR.headSub, "padding-top:4px;"), `Período: ${escapeHtml(range)}`)) : "")
        ),
        `bgcolor="${COLOR.head}"`
      )
    )
  );

  if (headline) rows.push(padded(22, 0, full(row(cell(font(17, 26, COLOR.ink), body(headline))))));

  rows.push(counters(counts));

  for (const status of ["concluido", "em_validacao", "em_andamento"] as const) {
    if (counts[status] === 0) continue;
    rows.push(heading(STATUS_LABEL[status], SECTION_COLOR[status]), ...by(status).map(entryBlock));
  }

  // Blocked entries are blockers by definition, so they live here, and "Nenhum bloqueio." is only true
  // when there are neither blocked entries nor difficulties.
  rows.push(heading("Dificuldades e bloqueios", SECTION_COLOR.bloqueado));
  if (counts.bloqueado === 0 && difficulties.length === 0) {
    rows.push(padded(10, 0, full(row(cell(font(15, 22, COLOR.ink), "Nenhum bloqueio.")))));
  }
  rows.push(...by("bloqueado").map(entryBlock));
  for (const d of difficulties) {
    const needs = clean(d.needs);
    rows.push(
      bulletBlock(body(clean(d.text)) + (needs ? `<br><b>O que precisamos:</b> ${body(needs)}` : ""))
    );
  }

  if (upcoming.length > 0 || nextSteps.length > 0) {
    rows.push(heading("Próximos passos", COLOR.neutral));
    for (const e of upcoming) {
      const summary = clean(e.summary);
      rows.push(bulletBlock(`<b>${body(clean(e.title))}</b>${summary ? `<br>${body(summary)}` : ""}`));
    }
    for (const s of nextSteps) rows.push(bulletBlock(body(clean(s.text))));
  }

  if (internal) rows.push(padded(20, 0, full(row(cell(font(14, 21, COLOR.muted), body(internal))))));

  shots.forEach((shot, i) => {
    const src = safeImage(options.shotUrls?.[i]);
    if (!src) return;
    const caption = clean(shot.caption);
    rows.push(padded(22, 0, picture(src, SHOT_WIDTH, null, caption || "Tela do GeoCloud")));
    if (caption) rows.push(padded(6, 0, full(row(cell(font(13, 19, COLOR.muted), body(caption))))));
  });

  // The picture of Claude's work, then its three headline numbers as TEXT: mail clients block images by
  // default, and the CEO should still read what Claude did.
  rows.push(padded(28, 8, full(row(cell(font(17, 24, COLOR.ink), `<b>${escapeHtml(drawing.title)}</b>`)))));
  if (visualSrc) {
    rows.push(
      row(
        cell(
          `padding:0;font-size:0;line-height:0;background-color:${COLOR.head};`,
          picture(visualSrc, CARD_WIDTH, Math.round((size.height * CARD_WIDTH) / size.width), visualAlt(content)),
          `bgcolor="${COLOR.head}"`
        )
      )
    );
  }
  rows.push(
    padded(
      14,
      0,
      full(
        row(...numbers.map((n) => cell(font(22, 28, COLOR.ink, "font-weight:bold;"), `<b>${escapeHtml(n.value)}</b>`, 'width="33%" align="left"'))) +
          row(...numbers.map((n) => cell(font(12, 18, COLOR.muted), escapeHtml(n.label), 'align="left"')))
      )
    )
  );

  rows.push(
    row(
      cell(
        `padding:22px ${PAD}px 26px ${PAD}px;border-top:1px solid ${COLOR.rule};${font(13, 19, COLOR.muted)}`,
        `Resumo preparado no RoadS${
          roadsLink ? `: <a href="${escapeHtml(roadsLink)}" style="color:${COLOR.link};text-decoration:underline;">${escapeHtml(roadsLink)}</a>` : "."
        }`
      )
    )
  );

  const html = [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    "</head>",
    `<body style="margin:0;padding:0;background-color:${COLOR.page};">`,
    table(`width="100%" bgcolor="${COLOR.page}" style="width:100%;background-color:${COLOR.page};"`, row(cell("padding:24px 8px;", table(`width="${CARD_WIDTH}" bgcolor="${COLOR.card}" style="width:${CARD_WIDTH}px;max-width:${CARD_WIDTH}px;background-color:${COLOR.card};"`, rows.join("\n")), 'align="center"'))),
    "</body>",
    "</html>",
    "",
  ].join("\n");

  // The same content as plain text: what a client that shows only text, or the clipboard's text flavor, gets.
  const out: string[] = ["GeoCloud: andamento"];
  if (range) out.push(`Período: ${range}`);
  if (headline) out.push("", headline);
  const shownCounters: CounterStatus[] = counts.bloqueado > 0 ? ["concluido", "em_validacao", "em_andamento", "bloqueado"] : ["concluido", "em_validacao", "em_andamento"];
  out.push("", shownCounters.map((s) => `${STATUS_LABEL[s]}: ${counts[s]}`).join(" · "));
  const item = (e: ProgressEntry) => `- ${clean(e.title)}${clean(e.summary) ? `: ${clean(e.summary)}` : ""}`;
  for (const status of ["concluido", "em_validacao", "em_andamento"] as const) {
    if (counts[status] > 0) out.push("", STATUS_LABEL[status], ...by(status).map(item));
  }
  out.push("", "Dificuldades e bloqueios");
  if (counts.bloqueado === 0 && difficulties.length === 0) out.push("Nenhum bloqueio.");
  out.push(...by("bloqueado").map(item));
  for (const d of difficulties) {
    out.push(`- ${clean(d.text)}`);
    if (clean(d.needs)) out.push(`  O que precisamos: ${clean(d.needs)}`);
  }
  if (upcoming.length > 0 || nextSteps.length > 0) out.push("", "Próximos passos", ...upcoming.map(item), ...nextSteps.map((s) => `- ${clean(s.text)}`));
  if (internal) out.push("", internal);
  const captions = shots.map((s, i) => (safeImage(options.shotUrls?.[i]) ? clean(s.caption) : "")).filter(Boolean);
  if (captions.length > 0) out.push("", ...captions.map((c) => `Print: ${c}`));
  out.push("", drawing.title, numbers.map((n) => `${n.value} ${n.label}`).join(" · "));
  const projects = visualModel(content).products;
  if (projects.length > 0) out.push(`Projetos somados: ${joinNames(projects)}.`);
  out.push("", roadsLink ? `Resumo preparado no RoadS: ${roadsLink}` : "Resumo preparado no RoadS.", "");

  return { html, text: out.join("\n") };
}
