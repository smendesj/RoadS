import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_FONT_FILES,
  buildVisual,
  compactCount,
  dayLabel,
  estimateTextWidth,
  fitFontSize,
  heatLevel,
  hoursLabel,
  joinNames,
  renderVisualPng,
  tileValueSize,
  visualAlt,
  visualProducts,
  visualModel,
  visualSize,
  visualTitle,
  wholeNumber,
  windowDays,
  type VisualNode,
} from "./visual.ts";
import { entry, hourly, sampleContent, usageFor } from "./visual-fixture.ts";
import { loadImageResponse, loadVisualFonts } from "./visual-node.ts";

/* ---------- numbers: pt-BR commas, with the k / M / B suffixes of the Claude /stats panel ---------- */

test("big numbers read like the /stats panel but with a decimal comma", () => {
  assert.equal(compactCount(45_600), "45,6k");
  assert.equal(compactCount(7_800_000), "7,8M");
  assert.equal(compactCount(12_300_000_000), "12,3B");
  assert.equal(compactCount(4_000_000), "4M"); // no ",0"
  assert.equal(compactCount(1_000), "1k");
  assert.equal(compactCount(999), "999");
  assert.equal(compactCount(0), "0");
});

test("a rounded value never prints as 1000k: it moves up to the next unit", () => {
  assert.equal(compactCount(999_960), "1M");
  assert.equal(compactCount(999_960_000), "1B");
});

test("counts of messages and sessions use the dot as the thousands separator", () => {
  assert.equal(wholeNumber(1234), "1.234");
  assert.equal(wholeNumber(123_456), "123.456");
  assert.equal(wholeNumber(12), "12");
});

test("garbage numbers draw as zero instead of NaN", () => {
  assert.equal(compactCount(Number.NaN), "0");
  assert.equal(compactCount(-5), "0");
  assert.equal(wholeNumber(Number.POSITIVE_INFINITY), "0");
});

/* ---------- the days of a window ---------- */

test("a window lists the São Paulo days it includes; its end is exclusive", () => {
  assert.deepEqual(windowDays({ start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" }), ["2026-09-28", "2026-09-29"]);
  assert.deepEqual(windowDays({ start: "2026-09-28T00:00:00-03:00", end: "2026-09-29T00:00:00-03:00" }), ["2026-09-28"]);
  assert.equal(windowDays({ start: "2026-09-28T00:00:00-03:00", end: "2026-10-05T00:00:00-03:00" }).length, 7);
});

test("a window that ends during a day includes that day, and an empty window still names one day", () => {
  assert.deepEqual(windowDays({ start: "2026-09-30T00:00:00-03:00", end: "2026-10-01T15:00:00.000Z" }), ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(windowDays({ start: "2026-10-01T00:00:00-03:00", end: "2026-10-01T00:00:00-03:00" }), ["2026-10-01"]);
});

test("a window that is not a date gives no days", () => {
  assert.deepEqual(windowDays({ start: "x", end: "y" }), []);
});

test("day labels name the weekday and the date without depending on the machine zone", () => {
  assert.equal(dayLabel("2026-10-01"), "qui 01/10");
  assert.equal(dayLabel("2026-09-26"), "sáb 26/09");
});

/* ---------- Resultados ---------- */

test("Resultados counts the visible entries by status of the resolved content", () => {
  const model = visualModel(sampleContent(2));
  const counts = Object.fromEntries(model.results.map((r) => [r.key, r.count]));
  // The fixture has 2 concluded + 1 hidden concluded, 1 in validation, 1 in progress and 1 "próximo".
  assert.deepEqual(counts, { concluido: 2, em_validacao: 1, em_andamento: 1 });
  assert.deepEqual(model.results.map((r) => r.label), ["Concluídas", "Em validação", "Em andamento"]);
});

test("a status the user changed counts where it ended up, and hiding an entry takes it out", () => {
  const model = visualModel(
    sampleContent(2, {
      entries: [entry(1, "em_validacao"), entry(2, "em_validacao"), entry(3, "concluido", { hidden: true })],
    })
  );
  const counts = Object.fromEntries(model.results.map((r) => [r.key, r.count]));
  assert.deepEqual(counts, { concluido: 0, em_validacao: 2, em_andamento: 0 });
});

test("blocked entries get their own result only when there are some", () => {
  const without = visualModel(sampleContent(2));
  assert.ok(!without.results.some((r) => r.key === "bloqueado"));
  const withOne = visualModel(sampleContent(2, { entries: [entry(1, "bloqueado"), entry(2, "concluido")] }));
  const blocked = withOne.results.find((r) => r.key === "bloqueado");
  assert.deepEqual(blocked && [blocked.label, blocked.count], ["Bloqueadas", 1]);
});

/* ---------- Visão Geral: the tiles show usage.totals as given ---------- */

const tile = (model: ReturnType<typeof visualModel>, label: string) => model.tiles.find((t) => t.label === label);

test("the tiles show the totals the collector computed, never a recount of the days", () => {
  const base = usageFor(2);
  const usage = usageFor(2, {
    totals: { ...base.totals, sessions: 12, messages: 1234, activeDays: 2, tokens: { input: 45_600, output: 7_800_000, cacheRead: 12_300_000_000, cacheWrite: 1 } },
    peakHour: 14,
  });
  const model = visualModel(sampleContent(2, { usage }));
  assert.equal(tile(model, "Sessões")?.value, "12");
  assert.equal(tile(model, "Mensagens")?.value, "1.234"); // the days add up to something else
  assert.equal(tile(model, "Tokens de entrada")?.value, "45,6k");
  assert.equal(tile(model, "Tokens de saída")?.value, "7,8M");
  assert.equal(tile(model, "Horário de pico")?.value, "14h");
});

test("the tiles are Sessões and Mensagens, the two token tiles, then two half-width ones", () => {
  assert.deepEqual(visualModel(sampleContent(2)).tiles.map((t) => t.label), [
    "Sessões",
    "Mensagens",
    "Tokens de entrada",
    "Tokens de saída",
    "Dias ativos",
    "Horário de pico",
  ]);
});

test("Dias ativos reads 'X de N' with N the days of the window", () => {
  const model = visualModel(sampleContent(3, { usage: usageFor(3, { totals: { ...usageFor(3).totals, activeDays: 2 } }) }));
  assert.deepEqual([tile(model, "Dias ativos")?.value, tile(model, "Dias ativos")?.extra], ["2", "de 3"]);
  const oneDay = visualModel(sampleContent(1));
  assert.deepEqual([tile(oneDay, "Dias ativos")?.value, tile(oneDay, "Dias ativos")?.extra], ["1", "de 1"]);
});

test("a single digit peak hour keeps two digits, like the hours beside the days", () => {
  assert.equal(tile(visualModel(sampleContent(2, { usage: usageFor(2, { peakHour: 8 }) })), "Horário de pico")?.value, "08h");
});

test("without a peak hour the tile says so with a dash", () => {
  assert.equal(tile(visualModel(sampleContent(2, { usage: usageFor(2, { peakHour: null }) })), "Horário de pico")?.value, "–");
});

test("very long tile values shrink to fit instead of spilling into the next tile", () => {
  const box = 214; // inner width of one of the four tiles of the first row
  for (const value of ["0", "3.564", "12,4k", "45,6k", "999,9M", "12,3B", "12.345.678", "12.345.678.901"]) {
    assert.ok(estimateTextWidth(value, tileValueSize(value, box)) <= box, `"${value}" must fit`);
  }
  assert.equal(tileValueSize("3.564", box), 52); // short values keep the big size
  assert.ok(tileValueSize("12.345.678.901", box) < tileValueSize("3.564", box));
});

/* ---------- the strip by hour ---------- */

test("the strip has one row of 24 cells per day of the window, for 1, 3 and 7 days", () => {
  for (const days of [1, 3, 7]) {
    const { rows } = visualModel(sampleContent(days)).strip;
    assert.equal(rows.length, days);
    for (const row of rows) assert.equal(row.levels.length, 24);
  }
  assert.deepEqual(visualModel(sampleContent(3)).strip.rows.map((r) => r.label), ["seg 28/09", "ter 29/09", "qua 30/09"]);
  assert.deepEqual(visualModel(sampleContent(1)).strip.rows.map((r) => r.label), ["seg 28/09"]);
});

test("each day shows its first and last active hour next to the day", () => {
  const rows = visualModel(sampleContent(2)).strip.rows;
  // The fixture is busy from 06h to 15h on the first day and to 16h on the second.
  assert.deepEqual(rows.map((r) => r.hours), ["06h–15h", "06h–16h"]);
  assert.equal(hoursLabel(hourly({ 5: 3, 21: 1, 12: 8 })), "05h–21h");
});

test("a day with one active hour shows just that hour; a day with none says so", () => {
  assert.equal(hoursLabel(hourly({ 0: 4 })), "00h"); // a session that ran past midnight
  assert.equal(hoursLabel(hourly({ 23: 2 })), "23h");
  assert.equal(hoursLabel(hourly()), "sem atividade");
  assert.equal(hoursLabel([]), "sem atividade");
});

test("a day of the window the collector left out is drawn as a quiet day", () => {
  const usage = usageFor(3);
  usage.days = usage.days.filter((d) => d.date !== "2026-09-29");
  const rows = visualModel(sampleContent(3, { usage })).strip.rows;
  assert.deepEqual([rows[1].label, rows[1].hours], ["ter 29/09", "sem atividade"]);
  assert.ok(rows[1].levels.every((l) => l === 0));
});

test("there is no single work window line: the hours live beside each day, and the intensity legend stays", () => {
  const { tree } = buildVisual(sampleContent(3));
  const all = texts(tree);
  assert.ok(!all.some((t) => /Janela de trabalho/i.test(t)));
  assert.ok(all.includes("menos") && all.includes("mais"));
  assert.ok(all.includes("mensagens por hora"));
  assert.ok(all.some((t) => t.includes("06h–15h"))); // beside its day
});

test("cell intensity follows the messages of the hour: silence is zero, the busiest hour is the top level", () => {
  assert.equal(heatLevel(0, 100), 0);
  assert.equal(heatLevel(100, 100), 4);
  assert.equal(heatLevel(1, 100), 1);
  assert.equal(heatLevel(50, 100), 2);
  assert.equal(heatLevel(5, 0), 0);
  const usage = usageFor(1);
  usage.days[0].hourly = hourly({ 9: 100, 10: 50, 11: 1 });
  const [row] = visualModel(sampleContent(1, { usage })).strip.rows;
  assert.deepEqual([row.levels[8], row.levels[9], row.levels[10], row.levels[11], row.levels[12]], [0, 4, 2, 1, 0]);
});

/* ---------- what the picture must never say ---------- */

test("models are not part of the picture: no card, no favorite tile, not even in the alt text", () => {
  const content = sampleContent(2);
  const all = texts(buildVisual(content).tree).join(" | ");
  assert.doesNotMatch(all, /Modelos|Modelo favorito|Opus|Sonnet|Haiku/i);
  assert.doesNotMatch(visualAlt(content), /modelo|Opus|Sonnet|Haiku/i);
  assert.ok(!visualModel(content).tiles.some((t) => /modelo/i.test(t.label)));
  // The data stays on the report for other screens: only the drawing ignores it.
  assert.equal(content.usage.favoriteModel, "claude-opus-5-5");
  assert.equal(content.usage.byModel.length, 2);
});

test("the picture carries no example mark and no talk about counting methods", () => {
  const all = texts(buildVisual(sampleContent(2)).tree).join(" | ");
  assert.doesNotMatch(all, /EXEMPLO/i);
  assert.doesNotMatch(all, /stats|cache|método/i);
});

test("the footnote is the one plain sentence about tokens and the k / M / B suffixes", () => {
  const sentence = "Tokens são os pedaços de texto que o Claude lê (entrada) e escreve (saída). k = mil · M = milhão · B = bilhão.";
  const all = texts(buildVisual(sampleContent(2)).tree);
  assert.equal(all.filter((t) => t.startsWith("Tokens são")).length, 1);
  assert.ok(all.includes(sentence));
  assert.equal(visualModel(sampleContent(2)).footer, sentence);
});

/* ---------- the drawing ---------- */

function walk(node: VisualNode | string, visit: (n: VisualNode) => void) {
  if (typeof node === "string") return;
  visit(node);
  const children = node.props.children;
  if (Array.isArray(children)) children.forEach((child) => walk(child, visit));
  else if (children !== undefined) walk(children, visit);
}

function texts(tree: VisualNode): string[] {
  const found: string[] = [];
  walk(tree, (n) => {
    if (typeof n.props.children === "string") found.push(n.props.children);
  });
  return found;
}

test("the tree is all flexbox with an explicit display (Satori has no grid)", () => {
  let nodes = 0;
  walk(buildVisual(sampleContent(2)).tree, (n) => {
    nodes += 1;
    assert.equal(n.props.style.display, "flex");
  });
  assert.ok(nodes > 100);
});

test("every character drawn exists in the font, so rendering never goes to the network for a glyph", () => {
  for (const days of [1, 7]) {
    for (const text of texts(buildVisual(sampleContent(days)).tree)) {
      assert.match(text, /^[ -~ -ÿ–]*$/, `unsupported glyph in "${text}"`);
    }
  }
});

test("the sections and the period line are the ones of the /stats look, in Portuguese", () => {
  const all = texts(buildVisual(sampleContent(2)).tree);
  for (const label of ["Resultados", "Visão Geral"]) assert.ok(all.includes(label), label);
  assert.ok(all.includes("28 set – 29 set · 2 dias · horário de São Paulo"));
  assert.ok(texts(buildVisual(sampleContent(1)).tree).includes("28 set · 1 dia · horário de São Paulo"));
});

/* ---------- the title comes from data: no name is ever written in the code ---------- */

const labelled = (label: string | undefined, days = 2) => sampleContent(days, { usage: usageFor(days, { label }) });

test("the title is the label the collector sent", () => {
  const content = labelled("Example - AI usage");
  assert.equal(visualModel(content).title, "Example - AI usage");
  assert.ok(texts(buildVisual(content).tree).includes("Example - AI usage"));
});

test("without a label the title is the neutral 'AI usage'", () => {
  for (const label of [undefined, "", "   "]) {
    assert.equal(visualModel(labelled(label)).title, "AI usage");
    assert.ok(texts(buildVisual(labelled(label)).tree).includes("AI usage"));
  }
  assert.doesNotMatch(texts(buildVisual(sampleContent(2)).tree).join("|"), /Claude por trás das entregas/);
});

test("a label is plain text: trimmed, one space between words, at most 60 characters, only glyphs the font has", () => {
  assert.equal(visualTitle("  Example   -  AI usage \n"), "Example - AI usage");
  assert.equal(visualTitle("x".repeat(80)).length, 60);
  assert.equal(visualTitle(`${"y".repeat(59)} ${"z".repeat(10)}`), "y".repeat(59)); // the cut never leaves a trailing space
  assert.equal(visualTitle("Alfa \u{1F680} → usage"), "Alfa usage");
  assert.equal(visualTitle("\u{1F680}"), "AI usage");
  assert.equal(visualTitle(42), "AI usage");
  assert.equal(visualTitle("Café – ação"), "Café – ação"); // accents and the en dash are in the font
});

test("a long label shrinks to fit the width of the title instead of running off the picture", () => {
  const box = 1140;
  const long = "W".repeat(60);
  assert.ok(estimateTextWidth(long, fitFontSize(long, box, 38, 22)) <= box);
  assert.equal(fitFontSize("AI usage", box, 38, 22), 38); // a short title keeps the full size
  assert.ok(fitFontSize(long, box, 38, 22) < 38);
});

test("the label also opens the alt text of the picture", () => {
  assert.match(visualAlt(labelled("Example - AI usage")), /^Example - AI usage: uso do Claude de 28 set – 29 set\./);
  assert.match(visualAlt(labelled(undefined)), /^AI usage: uso do Claude de /);
});

test("the canvas is 1200 wide and grows with every day of the window", () => {
  const heights = [1, 2, 3, 4, 5, 6, 7].map((days) => visualSize(sampleContent(days)).height);
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] > heights[i - 1], `${i + 1} days must be taller than ${i}`);
  assert.ok(heights.every(Number.isInteger));
  assert.equal(visualSize(sampleContent(3)).width, 1200);
  assert.deepEqual(visualSize(sampleContent(3)), { width: 1200, height: buildVisual(sampleContent(3)).height });
});

test("the height is the title, Resultados, Visão Geral and the footnote: nothing else is stacked below", () => {
  // With the strip rows of a window known, the difference between two windows is exactly their rows.
  const one = visualSize(sampleContent(1)).height;
  const two = visualSize(sampleContent(2)).height;
  const three = visualSize(sampleContent(3)).height;
  assert.equal(two - one, three - two); // every extra day adds the same row, and nothing else changes
  assert.ok(one < 1000, `a one-day picture is compact (got ${one})`);
});

test("a window longer than two weeks shows the latest fourteen days and stays a sane size", () => {
  const rows = visualModel(sampleContent(20)).strip.rows;
  assert.equal(rows.length, 14);
  assert.equal(rows[13].label, "sáb 17/10"); // 28/09 + 19 days
  assert.ok(visualSize(sampleContent(20)).height < 2000);
});

test("project names keep their letters and only odd whitespace is collapsed", () => {
  assert.deepEqual(visualProducts(["Sistemas Alfa", "Beta  Soluções Ltda", "Gamma"]), ["Sistemas Alfa", "Beta Soluções Ltda", "Gamma"]);
  assert.deepEqual(visualProducts(["Frontlights", "Roads"]), ["Frontlights", "Roads"]);
});

test("the picture shows only messages and the two token tiles, in a single row", () => {
  const content = sampleContent(2);
  const shown = texts(buildVisual(content).tree);
  for (const gone of ["Sessões", "Dias ativos", "Horário de pico"]) assert.ok(!shown.includes(gone), `${gone} should not be drawn`);
  for (const kept of ["Mensagens", "Tokens de entrada", "Tokens de saída"]) assert.ok(shown.includes(kept), `${kept} should be drawn`);
  // The e-mail still reads sessions and messages from the model, so the model keeps all of its numbers.
  assert.ok(visualModel(content).tiles.some((t) => t.label === "Sessões"));
  // One tile row less than before: the picture gets shorter.
  const oneRow = buildVisual(content).height;
  assert.ok(oneRow < 1004, `height ${oneRow}`);
});

test("the alt text says the numbers in plain Portuguese", () => {
  const usage = usageFor(2);
  usage.totals = { ...usage.totals, sessions: 12, messages: 1234 };
  const alt = visualAlt(sampleContent(2, { usage }));
  assert.match(alt, /2 concluídas, 1 em validação, 1 em andamento/);
  assert.match(alt, /1.234 mensagens/);
  assert.doesNotMatch(alt, /sessões|dias ativos|horário de pico/i);
  assert.equal(buildVisual(sampleContent(2, { usage })).alt, alt);
});

/* ---------- smoke: a real PNG through next/og (Satori + resvg), no network ---------- */

const ImageResponse = loadImageResponse();
const fonts = await loadVisualFonts();

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const render = (content = sampleContent(2)) => renderVisualPng(content, { ImageResponse, fonts });
const dimensions = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

test("the font files the drawing asks for ship with the code", () => {
  assert.deepEqual(VISUAL_FONT_FILES.map((f) => f.weight), [400, 600, 700]);
  for (const { weight, file } of VISUAL_FONT_FILES) assert.match(file, new RegExp(`^inter-latin-${weight}-normal\\.woff$`));
  assert.ok(fonts.every((f) => f.data.byteLength > 10_000));
});

test("renders a real PNG, 1200 wide and as tall as promised, for windows of 1, 3 and 7 days, without touching the network", async () => {
  const outside: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = String(typeof input === "object" && "url" in input ? input.url : input);
    if (/^https?:/i.test(target)) outside.push(target.slice(0, 80)); // the wasm loads from a data: or file: URL
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    for (const days of [1, 3, 7]) {
      const content = sampleContent(days);
      const png = await render(content);
      assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
      assert.deepEqual(dimensions(png), visualSize(content));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(outside, []);
});

test("the same report always renders the same bytes, which is what makes a sent image safe to cache forever", async () => {
  const [first, second] = [await render(), await render()];
  assert.equal(Buffer.compare(first, second), 0);
});

test("a label as long as allowed renders too, on one line, without changing the size promised", async () => {
  const content = labelled("W".repeat(60));
  const png = await render(content);
  assert.deepEqual(dimensions(png), visualSize(content));
  assert.equal(visualSize(content).height, visualSize(labelled("AI usage")).height); // the title never adds a line
});

test("a report with no usage at all still renders", async () => {
  const quiet = sampleContent(2, {
    usage: usageFor(2, { days: [], byModel: [], favoriteModel: null, peakHour: null, totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }),
  });
  const png = await render(quiet);
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
  assert.equal(dimensions(png).width, 1200);
});

/* ---------- several connected projects: the subtitle and the alt text name them ---------- */

const withProducts = (products: string[] | undefined, days = 2) => sampleContent(days, { usage: usageFor(days, { products }) });

test("names join in natural Portuguese: 'A e B', 'A, B e C'", () => {
  assert.equal(joinNames(["Alpha"]), "Alpha");
  assert.equal(joinNames(["Alpha", "Beta"]), "Alpha e Beta");
  assert.equal(joinNames(["Alpha", "Beta", "Gamma"]), "Alpha, Beta e Gamma");
});

test("the subtitle lists the projects counted, between the days and the time zone", () => {
  const two = visualModel(withProducts(["Alpha", "Beta"])).subtitle;
  assert.match(two, /^28 set – 29 set · 2 dias · Projetos: Alpha e Beta · horário de São Paulo$/);
  assert.match(visualModel(withProducts(["Alpha", "Beta", "Gamma"])).subtitle, /Projetos: Alpha, Beta e Gamma/);
  assert.ok(texts(buildVisual(withProducts(["Alpha", "Beta"])).tree).some((t) => t.includes("Alpha e Beta")));
});

test("with one project or none the subtitle is unchanged", () => {
  const plain = visualModel(withProducts(undefined)).subtitle;
  assert.equal(plain, "28 set – 29 set · 2 dias · horário de São Paulo");
  assert.equal(visualModel(withProducts(["Alpha"])).subtitle, plain);
  assert.equal(visualModel(withProducts([])).subtitle, plain);
});

test("project names are cleaned like the title: plain glyphs, no blanks, no repeats", () => {
  const names = ["  Alpha ", "Beta\n\u{1F680}", "", "Alpha", 42 as unknown as string];
  assert.match(visualModel(withProducts(names)).subtitle, /Projetos: Alpha e Beta · /);
});

test("many names never spill: the list is shortened, then only counted, and the text fits the card", () => {
  const widths = (content: ReturnType<typeof withProducts>) => {
    const tree = buildVisual(content).tree;
    const line = texts(tree).find((t) => t.includes("Projetos:"));
    assert.ok(line);
    let size = 0;
    walk(tree, (n) => {
      if (n.props.children === line) size = Number(n.props.style.fontSize);
    });
    assert.ok(estimateTextWidth(line, size) <= 1140, `${estimateTextWidth(line, size)}px at ${size}`);
  };
  const medium = Array.from({ length: 8 }, (_, i) => `Projeto ${i + 1} comprido`);
  assert.match(visualModel(withProducts(medium)).subtitle, /Projetos: Projeto 1 comprido.* e mais [0-9]+ projetos? · horário/);
  widths(withProducts(medium));
  const long = Array.from({ length: 8 }, (_, i) => `Projeto ${i + 1} de nome bem comprido assim`);
  assert.match(visualModel(withProducts(long)).subtitle, /Projetos: (.* e mais [0-9]+ projetos?|8 projetos) · horário/);
  widths(withProducts(long));
});

test("the alt text names the projects added up, and renders with them", async () => {
  assert.match(visualAlt(withProducts(["Alpha", "Beta", "Gamma"])), /Projetos somados: Alpha, Beta e Gamma\./);
  assert.doesNotMatch(visualAlt(withProducts(undefined)), /Projetos somados/);
  const png = await render(withProducts(["Alpha", "Beta", "Gamma"]));
  assert.equal(dimensions(png).width, 1200);
});

test("with several projects the picture still has no model names, in the text or the alt", () => {
  const content = withProducts(["Alpha", "Beta"]);
  assert.doesNotMatch(texts(buildVisual(content).tree).join(" | "), /Modelos|Modelo favorito|Opus|Sonnet|Haiku/i);
  assert.doesNotMatch(visualAlt(content), /modelo|Opus|Sonnet|Haiku/i);
});
