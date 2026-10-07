import { test } from "node:test";
import assert from "node:assert/strict";
import type { EmailOptions, ProgressContent } from "../progress-report.ts";
import { buildEmail, emailSubject, escapeHtml } from "./email.ts";
import { visualAlt, visualModel, visualSize } from "./visual.ts";
import { entry, sampleContent, usageFor } from "./visual-fixture.ts";

const TOKEN = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const ORIGIN = "https://roads-psi.vercel.app";
const OPTIONS: EmailOptions = {
  visualUrl: `${ORIGIN}/api/progress-report/${TOKEN}/abc/visual.png`,
  shotUrls: [`${ORIGIN}/api/progress-report/${TOKEN}/abc/shot-1.jpg`, `${ORIGIN}/api/progress-report/${TOKEN}/abc/shot-2.png`],
  roadsUrl: `${ORIGIN}/resumo`,
};
const shot = (n: number, caption = `Legenda do print ${n}`) => ({ id: `s${n}`, caption, mime: "image/jpeg" as const, data: "AAAA" });

/** A report with every part filled in. */
function rich(patch: Partial<ProgressContent> = {}): ProgressContent {
  return sampleContent(2, {
    entries: [
      entry(1, "concluido"),
      entry(2, "concluido"),
      entry(3, "em_validacao"),
      entry(4, "em_andamento"),
      entry(5, "proximo"),
      entry(6, "concluido", { hidden: true, title: "Entrega escondida de teste", summary: "Frase escondida de teste." }),
    ],
    difficulties: [{ text: "Um fornecedor ainda não respondeu.", needs: "Uma decisão sobre o prazo." }],
    nextSteps: [{ text: "Primeiro passo de teste." }, { text: "Segundo passo de teste." }],
    shots: [shot(1), shot(2)],
    ...patch,
  });
}

const html = (c: ProgressContent = rich(), o: EmailOptions = OPTIONS) => buildEmail(c, o).html;
const text = (c: ProgressContent = rich(), o: EmailOptions = OPTIONS) => buildEmail(c, o).text;
const at = (haystack: string, needle: string) => {
  const i = haystack.indexOf(needle);
  assert.ok(i >= 0, `expected to find ${JSON.stringify(needle)}`);
  return i;
};

/* ---------- subject ---------- */

test("the subject names the first and the last day of the window, in São Paulo, the end being exclusive", () => {
  assert.equal(emailSubject(sampleContent(2)), "GeoCloud: andamento de 28/09 a 29/09");
  assert.equal(emailSubject(sampleContent(7)), "GeoCloud: andamento de 28/09 a 04/10");
});

test("a one-day window names the day once, and a window that ends during a day includes it", () => {
  assert.equal(emailSubject(sampleContent(1)), "GeoCloud: andamento de 28/09");
  const live = sampleContent(2, { window: { start: "2026-09-30T00:00:00-03:00", end: "2026-10-01T15:00:00.000Z" } });
  assert.equal(emailSubject(live), "GeoCloud: andamento de 30/09 a 01/10");
});

test("a window that is not a date still gets a subject", () => {
  assert.equal(emailSubject(sampleContent(2, { window: { start: "x", end: "y" } })), "GeoCloud: andamento");
});

/* ---------- what is in the e-mail, and in which order ---------- */

test("the e-mail reads top to bottom: period, opening line, counters, sections, difficulties, next steps, internal line, prints, the Claude picture, footer", () => {
  const out = html();
  const order = [
    "28/09 a 29/09",
    "Duas entregas de teste ficaram prontas",
    "Concluído: 2",
    "Entrega de teste 1",
    "Entrega de teste 3",
    "Entrega de teste 4",
    "Dificuldades e bloqueios",
    "Próximos passos",
    "Também houve 12 ajustes internos",
    OPTIONS.shotUrls[0],
    "AI usage",
    OPTIONS.visualUrl,
    "entregas concluídas",
    `href="${OPTIONS.roadsUrl}"`,
  ].map((needle) => at(out, needle));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("each entry is a bold title and one sentence, and the sections are the three working ones", () => {
  const out = html();
  for (const heading of ["Concluído", "Em validação", "Em andamento"]) assert.ok(out.includes(`>${heading}<`), heading);
  assert.match(out, /<b>Entrega de teste 1<\/b>/);
  assert.ok(out.includes("Frase de exemplo sobre a entrega de teste 1."));
  assert.ok(out.includes("Frase de exemplo sobre a entrega de teste 3."));
});

test("hidden entries never appear, in the e-mail or in the text version", () => {
  for (const out of [html(), text()]) {
    assert.ok(!out.includes("Entrega escondida de teste"));
    assert.ok(!out.includes("Frase escondida de teste."));
  }
});

test("the links to issues and pull requests (sources) are for the team and never printed", () => {
  for (const out of [html(), text()]) assert.ok(!out.includes("example.invalid"));
});

test("a section with nothing in it disappears", () => {
  const out = html(rich({ entries: [entry(1, "concluido")] }));
  assert.ok(out.includes(">Concluído<"));
  assert.ok(!out.includes(">Em validação<") && !out.includes(">Em andamento<"));
  const none = html(rich({ entries: [] }));
  assert.ok(!none.includes(">Concluído<"));
});

test("upcoming entries and next steps share 'Próximos passos', which is left out when there is neither", () => {
  const out = html();
  const from = at(out, "Próximos passos");
  const tail = out.slice(from);
  assert.ok(tail.includes("Entrega de teste 5") && tail.includes("Primeiro passo de teste.") && tail.includes("Segundo passo de teste."));
  assert.ok(!out.slice(0, from).includes("Entrega de teste 5")); // not among the working sections
  const bare = html(rich({ entries: [entry(1, "concluido")], nextSteps: [] }));
  assert.ok(!bare.includes("Próximos passos"));
});

test("an upcoming entry is a bold title and its sentence, listed BEFORE the plain lines of nextSteps, and it is not counted in the chips", () => {
  for (const [out, bold] of [
    [html(), true],
    [text(), false],
  ] as const) {
    const upcoming = at(out, "Entrega de teste 5");
    assert.ok(upcoming < at(out, "Primeiro passo de teste."));
    assert.ok(at(out, "Primeiro passo de teste.") < at(out, "Segundo passo de teste."));
    assert.ok(at(out, "Frase de exemplo sobre a entrega de teste 5.") > upcoming);
    if (bold) assert.match(out, /<b>Entrega de teste 5<\/b>/);
  }
  const chips = html(rich({ entries: [entry(5, "proximo"), entry(6, "proximo")] }));
  assert.ok(chips.includes("Concluído: 0<") && chips.includes("Em validação: 0<") && chips.includes("Em andamento: 0<"));
  assert.ok(!chips.includes("Próximo: "));
});

test("a hidden upcoming entry is not listed either", () => {
  const out = html(rich({ entries: [entry(5, "proximo", { hidden: true, title: "Entrega futura escondida" })], nextSteps: [] }));
  assert.ok(!out.includes("Entrega futura escondida"));
  assert.ok(!out.includes("Próximos passos"));
});

test("difficulties say what is needed, only when something is", () => {
  const out = html();
  assert.ok(out.includes("Um fornecedor ainda não respondeu."));
  assert.match(out, /O que precisamos:<\/b>\s*Uma decisão sobre o prazo\./);
  const noNeed = html(rich({ difficulties: [{ text: "Algo travou.", needs: "" }] }));
  assert.ok(noNeed.includes("Algo travou."));
  assert.ok(!noNeed.includes("O que precisamos:"));
  // Emptying the field is how the person removes the line, so blank means gone, in both versions.
  for (const blank of ["", "   ", "\n"]) {
    const content = rich({ difficulties: [{ text: "Algo travou.", needs: blank }] });
    assert.ok(!html(content).includes("O que precisamos"));
    assert.ok(!text(content).includes("O que precisamos"));
  }
});

test("with no difficulties and no blocked entry the e-mail says 'Nenhum bloqueio.'", () => {
  const calm = rich({ difficulties: [] });
  assert.ok(html(calm).includes("Nenhum bloqueio."));
  assert.ok(text(calm).includes("Nenhum bloqueio."));
  assert.ok(!html().includes("Nenhum bloqueio.")); // there is a difficulty
});

test("a blocked entry is a blocker: it is listed there and the e-mail never claims there are none", () => {
  const blocked = rich({ difficulties: [], entries: [entry(1, "concluido"), entry(7, "bloqueado")] });
  const out = html(blocked);
  assert.ok(!out.includes("Nenhum bloqueio."));
  assert.ok(out.slice(at(out, "Dificuldades e bloqueios")).includes("Entrega de teste 7"));
});

test("the internal line shows only when there were internal changes", () => {
  assert.ok(html().includes("Também houve 12 ajustes internos de organização."));
  assert.ok(!html(rich({ internal: { count: 0, text: "Também houve zero ajustes." } })).includes("zero ajustes"));
  assert.ok(!text(rich({ internal: { count: 0, text: "Também houve zero ajustes." } })).includes("zero ajustes"));
});

test("an internal line the person emptied is gone, whatever the count says", () => {
  for (const blank of ["", "  ", "\n"]) {
    const content = rich({ internal: { count: 12, text: blank } });
    assert.ok(!html(content).includes("ajustes internos"));
    assert.ok(!text(content).includes("ajustes internos"));
  }
});

/* ---------- counters ---------- */

test("the counters are colored chips: green done, amber in validation, blue in progress, red blocked only if any", () => {
  const out = html();
  assert.match(out, /bgcolor="#117a2b"[^>]*>Concluído: 2</);
  assert.match(out, /bgcolor="#fab219"[^>]*>Em validação: 1</);
  assert.match(out, /bgcolor="#256abf"[^>]*>Em andamento: 1</);
  assert.ok(!out.includes("Bloqueado: "));
  const withBlocked = html(rich({ entries: [entry(1, "concluido"), entry(2, "bloqueado"), entry(3, "bloqueado")] }));
  assert.match(withBlocked, /bgcolor="#c42b2b"[^>]*>Bloqueado: 2</);
});

test("the counters follow what is visible: hidden entries are not counted", () => {
  const out = html(rich({ entries: [entry(1, "concluido"), entry(2, "concluido", { hidden: true })] }));
  assert.ok(out.includes("Concluído: 1<"));
});

/* ---------- never trust the text ---------- */

test("every piece of text is escaped: tags, quotes and ampersands cannot become markup", () => {
  const evil = (label: string) => `${label} <script>alert("x")</script> & 'q' "dq" <i>`;
  const content = rich({
    headline: evil("abertura"),
    entries: [
      entry(1, "concluido", { title: evil("titulo1"), summary: evil("frase1") }),
      entry(2, "em_validacao", { title: evil("titulo2"), summary: evil("frase2") }),
      entry(3, "em_andamento", { title: evil("titulo3"), summary: evil("frase3") }),
      entry(4, "bloqueado", { title: evil("titulo4"), summary: evil("frase4") }),
      entry(5, "proximo", { title: evil("titulo5"), summary: evil("frase5") }),
    ],
    internal: { count: 3, text: evil("interno") },
    difficulties: [{ text: evil("dificuldade"), needs: evil("preciso") }],
    nextSteps: [{ text: evil("passo") }],
    shots: [shot(1, evil("legenda1")), shot(2, evil("legenda2"))],
  });
  const out = html(content);
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("<i>"));
  assert.ok(!out.includes('"dq"'));
  for (const label of ["abertura", "titulo1", "frase1", "titulo2", "frase2", "titulo3", "frase3", "titulo4", "frase4", "titulo5", "frase5", "interno", "dificuldade", "preciso", "passo", "legenda1", "legenda2"]) {
    assert.ok(out.includes(escapeHtml(evil(label))), `${label} must be there, escaped`);
  }
});

test("a caption cannot break out of its attribute", () => {
  const out = html(rich({ shots: [shot(1, '" onerror="alert(1)')] }));
  assert.ok(!out.includes('" onerror='));
  assert.ok(out.includes('alt="&quot; onerror=&quot;alert(1)"'));
});

test("the escape function covers the five characters that matter", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeHtml(undefined), "");
});

/* ---------- safe for Outlook on the desktop ---------- */

test("the layout is tables with inline styles only: no classes, style blocks, flex, grid or scripts", () => {
  const out = html();
  assert.doesNotMatch(out, /\sclass\s*=/i);
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /flex|grid/i);
  assert.doesNotMatch(out, /javascript:/i);
  const tags = new Set([...out.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase()));
  const allowed = new Set(["html", "head", "meta", "title", "body", "table", "tr", "td", "a", "img", "b", "br"]);
  assert.deepEqual([...tags].filter((t) => !allowed.has(t)), []);
});

test("every table is a plain layout table, and the card is 600 wide on a white background", () => {
  const out = html();
  const tables = [...out.matchAll(/<table\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(tables.length > 5);
  for (const t of tables) {
    assert.match(t, /role="presentation"/);
    assert.match(t, /cellpadding="0"/);
    assert.match(t, /cellspacing="0"/);
    assert.match(t, /border="0"/);
  }
  assert.ok(tables.some((t) => /width="600"/.test(t) && /bgcolor="#ffffff"/.test(t)));
  assert.match(out, /font-family:'Segoe UI',Arial/);
  assert.match(out, /<html lang="pt-BR"/);
});

test("only https links are ever printed as links", () => {
  const out = html(rich(), { ...OPTIONS, roadsUrl: "javascript:alert(1)" });
  assert.doesNotMatch(out, /href="(?!https:\/\/)/);
  assert.ok(!out.includes("javascript:"));
  assert.doesNotMatch(html(rich(), { ...OPTIONS, roadsUrl: "http://roads.example/resumo" }), /href=/);
  assert.match(html(), /href="https:\/\/roads-psi\.vercel\.app\/resumo"/);
});

test("pictures come from https, from this site's own path (the preview) or from a PNG/JPEG data URI (the local file)", () => {
  const ok = [
    `${ORIGIN}/a.png`,
    "/api/progress-report/x/y/visual.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
  ];
  for (const src of ok) assert.ok(html(rich(), { ...OPTIONS, visualUrl: src }).includes(`src="${src}"`), src);
  const bad = ["http://insecure.example/a.png", "javascript:alert(1)", "//evil.example/a.png", "data:text/html;base64,PHNjcmlwdD4=", "ftp://x/y.png", "data:image/svg+xml;base64,AAAA"];
  for (const src of bad) assert.ok(!html(rich(), { ...OPTIONS, visualUrl: src, shotUrls: [src, src] }).includes(src), src);
});

/* ---------- the prints and the Claude picture ---------- */

test("each print is an image with its caption and a filled alt, forty at most", () => {
  const urls = Array.from({ length: 41 }, (_, i) => `${ORIGIN}/api/progress-report/${TOKEN}/abc/shot-${i + 1}.jpg`);
  const out = html(rich({ shots: Array.from({ length: 41 }, (_, i) => shot(i + 1)) }), { ...OPTIONS, shotUrls: urls });
  assert.match(out, new RegExp(`<img src="${OPTIONS.shotUrls[0].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*alt="Legenda do print 1"`));
  assert.ok(out.includes('alt="Legenda do print 2"'));
  assert.ok(out.includes(">Legenda do print 1<") && out.includes(">Legenda do print 2<"));
  assert.ok(out.includes('alt="Legenda do print 40"'));
  assert.ok(!out.includes("shot-41.jpg") && !out.includes("Legenda do print 41"));
  for (const tag of out.match(/<img\b[^>]*>/g) ?? []) assert.match(tag, /\salt="[^"]+"/);
});

test("a print of a delivery sits right under that delivery; a print of no delivery stays at the end", () => {
  const urls = [1, 2, 3].map((n) => `${ORIGIN}/api/progress-report/${TOKEN}/abc/shot-${n}.jpg`);
  const c = rich({ shots: [{ ...shot(1), issue: 3 }, shot(2), { ...shot(3), issue: 1 }] });
  const out = html(c, { ...OPTIONS, shotUrls: urls });
  // Delivery 1, then its print, then delivery 2.
  assert.ok(at(out, "Entrega de teste 1") < at(out, "shot-3.jpg") && at(out, "shot-3.jpg") < at(out, "Entrega de teste 2"));
  // Delivery 3 (em validação), then its print, then the next section.
  assert.ok(at(out, "Entrega de teste 3") < at(out, "shot-1.jpg") && at(out, "shot-1.jpg") < at(out, "Entrega de teste 4"));
  // The loose print after the internal line, before the Claude picture.
  assert.ok(at(out, "shot-2.jpg") > at(out, "Dificuldades e bloqueios") && at(out, "shot-2.jpg") < at(out, OPTIONS.visualUrl));
  // A print of a delivery that is only "próximo" (listed under next steps, no block of its own) is a general one.
  const upcoming = html(rich({ shots: [{ ...shot(1), issue: 5 }] }), { ...OPTIONS, shotUrls: [urls[0]] });
  assert.ok(at(upcoming, "Próximos passos") < at(upcoming, "shot-1.jpg") && at(upcoming, "shot-1.jpg") < at(upcoming, OPTIONS.visualUrl));
  // A print of a hidden delivery is left out with it.
  const hiddenOut = html(rich({ shots: [{ ...shot(1), issue: 6 }] }), { ...OPTIONS, shotUrls: [urls[0]] });
  assert.ok(!hiddenOut.includes("shot-1.jpg") && !hiddenOut.includes("Legenda do print 1"));
  const t = text(c, { ...OPTIONS, shotUrls: urls });
  assert.ok(at(t, "Entrega de teste 1") < at(t, "Print: Legenda do print 3") && at(t, "Print: Legenda do print 3") < at(t, "Entrega de teste 2"));
});

test("the placement rule is shared, and the week can lift the cap of forty", async () => {
  const { placeShots } = await import("./shot-place.ts");
  const many = Array.from({ length: 45 }, (_, i) => ({ ...shot(i + 1), issue: 1 }));
  const urls = many.map((_, i) => `u${i}`);
  assert.equal(placeShots(rich({ shots: many }), urls, (u) => u ?? null).shotsOf(1).length, 40);
  assert.equal(placeShots(rich({ shots: many }), urls, (u) => u ?? null, Infinity).shotsOf(1).length, 45);
});

test("a print without a link, or a report without prints, leaves no hole", () => {
  assert.ok(!html(rich(), { ...OPTIONS, shotUrls: [] }).includes("Legenda do print"));
  assert.ok(!html(rich({ shots: [] })).includes("shot-1.jpg"));
  assert.ok(!html(rich({ shots: undefined })).includes("shot-1.jpg"));
  const unnamed = html(rich({ shots: [shot(1, "")] }));
  assert.match(unnamed, /alt="[^"]+"/);
});

test("the Claude picture is 600 wide with a descriptive alt, then three numbers in plain text for when images are blocked", () => {
  const usage = usageFor(2);
  usage.totals = { ...usage.totals, sessions: 12, messages: 1234 };
  const content = rich({ usage });
  const out = html(content);
  const size = visualSize(content);
  const tag = (out.match(/<img\b[^>]*visual\.png"[^>]*>/) ?? [""])[0];
  assert.match(tag, /\swidth="600"/);
  assert.match(tag, new RegExp(`\\sheight="${Math.round((size.height * 600) / size.width)}"`));
  assert.ok(tag.includes(`alt="${escapeHtml(visualAlt(content))}"`));
  const after = out.slice(out.indexOf(tag) + tag.length);
  assert.match(after, />12<[\s\S]*?>sessões</);
  assert.match(after, />1.234<[\s\S]*?>mensagens</);
  assert.match(after, />2<[\s\S]*?>entregas concluídas</);
});

test("the heading above the picture is the picture's own title: the label from the data, or 'AI usage'", () => {
  const labelled = html(rich({ usage: usageFor(2, { label: "Example - AI usage" }) }));
  assert.match(labelled, /<b>Example - AI usage<\/b>/);
  assert.match(html(), /<b>AI usage<\/b>/);
  assert.match(text(rich({ usage: usageFor(2, { label: "Example - AI usage" }) })), /^Example - AI usage$/m);
  assert.doesNotMatch(html(), /Claude por trás das entregas|Uso do Claude no período/);
});

test("the closing line carries the account and the temporary password when the report has them", () => {
  const withAccess = rich({ access: { account: "reader@example.test", password: "Tmp-pass-1234" } });
  const out = html(withAccess);
  assert.ok(out.includes(OPTIONS.roadsUrl));
  assert.ok(out.includes("Conta: <b>reader@example.test</b>"));
  assert.ok(out.includes("Senha temporária do primeiro acesso: <b>Tmp-pass-1234</b>"));
  assert.match(out, /pede para criar uma nova senha/);
  const plain = text(withAccess);
  assert.ok(plain.includes("Conta: reader@example.test"));
  assert.ok(plain.includes("Senha temporária do primeiro acesso: Tmp-pass-1234"));
  // Without the details the line is what it always was.
  assert.doesNotMatch(html(), /Conta:|Senha temporária/);
  assert.doesNotMatch(text(), /Conta:|Senha temporária/);
});

test("the sign-in details are escaped like any other text", () => {
  const out = html(rich({ access: { account: "a<b>@example.test", password: "p&q\"r" } }));
  assert.ok(!out.includes("<b>a<b>@"));
  assert.ok(out.includes("a&lt;b&gt;@example.test"));
  assert.ok(out.includes("p&amp;q&quot;r"));
});

test("the label is escaped like any other text", () => {
  const out = html(rich({ usage: usageFor(2, { label: '<b>x</b> & "q"' }) }));
  assert.ok(!out.includes("<b>x</b>"));
  assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;"));
});

test("the three numbers are the ones of the picture: usage.totals, and the visible concluded entries", () => {
  const content = rich();
  const tiles = visualModel(content).tiles;
  const out = html(content);
  for (const label of ["Sessões", "Mensagens"]) assert.ok(out.includes(`>${tiles.find((t) => t.label === label)?.value}<`), label);
});

test("model names are not in the e-mail", () => {
  for (const out of [html(), text()]) assert.doesNotMatch(out, /opus|sonnet|haiku|modelo/i);
});

/* ---------- the plain text version ---------- */

test("the text version says the same thing without markup or escaping", () => {
  const content = rich({
    headline: "Alfa & Beta entregaram <tudo> hoje.",
    entries: [entry(1, "concluido", { title: "Tela de Alfa & Beta", summary: 'Agora "funciona".' }), entry(3, "em_validacao"), entry(4, "em_andamento"), entry(5, "proximo")],
  });
  const out = text(content);
  assert.doesNotMatch(out, /<(?!tudo>)[^>]+>/); // no tags (the user's own "<tudo>" is just text)
  assert.doesNotMatch(out, /&amp;|&lt;|&quot;|&#39;/);
  assert.ok(out.includes("Alfa & Beta entregaram <tudo> hoje."));
  assert.ok(out.includes("- Tela de Alfa & Beta: Agora \"funciona\"."));
  for (const piece of [
    "GeoCloud: andamento",
    "28/09 a 29/09",
    "Concluído: 1 · Em validação: 1 · Em andamento: 1",
    "Em validação",
    "Em andamento",
    "Dificuldades e bloqueios",
    "O que precisamos: Uma decisão sobre o prazo.",
    "Próximos passos",
    "- Primeiro passo de teste.",
    "Também houve 12 ajustes internos de organização.",
    "Legenda do print 1",
    "AI usage",
    "sessões",
    "entregas concluídas",
    OPTIONS.roadsUrl,
  ]) {
    assert.ok(out.includes(piece), piece);
  }
});

/* ---------- odd reports ---------- */

test("an empty report still makes a complete e-mail, with no 'undefined' or 'NaN' in it", () => {
  const empty = sampleContent(1, {
    headline: "",
    entries: [],
    internal: { count: 0, text: "" },
    difficulties: [],
    nextSteps: [],
    shots: undefined,
    usage: usageFor(1, { days: [], byModel: [], favoriteModel: null, peakHour: null, totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }),
  });
  for (const out of [html(empty), text(empty)]) {
    assert.doesNotMatch(out, /undefined|NaN|null/);
    assert.ok(out.includes("Nenhum bloqueio."));
  }
});

test("the e-mail is stable: the same report gives the same bytes", () => {
  assert.equal(html(), html());
  assert.equal(text(), text());
});

test("with several projects the e-mail names them (escaped) in the picture's alt and in the text version", () => {
  const content = rich({ usage: usageFor(2, { products: ["Alpha", "Beta", 'G<b>"&'] }) });
  const out = html(content);
  assert.ok(out.includes("Projetos somados: Alpha, Beta e G&lt;b&gt;&quot;&amp;"));
  assert.ok(!out.includes("G<b>"));
  const plain = text(content);
  assert.ok(plain.includes('Projetos somados: Alpha, Beta e G<b>"&'));
  assert.doesNotMatch(out + plain, /Modelo favorito|Opus|Sonnet|Haiku/i);
});

test("with one project or none the e-mail does not mention projects", () => {
  assert.doesNotMatch(html(rich({ usage: usageFor(2, { products: ["Alpha"] }) })), /Projetos somados/);
  assert.doesNotMatch(text(), /Projetos somados/);
});

/* ---------- the parts of a delivery ---------- */

test("a delivery with parts says how many are ready, in plain words under its sentence, in the HTML and in the text", () => {
  const content = rich({
    entries: [
      entry(1, "concluido", { subIssues: { total: 8, done: 8 } }),
      entry(3, "em_validacao", { subIssues: { total: 4, done: 4 } }),
      entry(4, "em_andamento", { subIssues: { total: 8, done: 3 } }),
      entry(5, "proximo", { subIssues: { total: 6, done: 0 } }),
      entry(7, "concluido", { subIssues: { total: 1, done: 1 } }),
      entry(2, "concluido"),
    ],
  });
  const out = html(content);
  for (const line of ["8 de 8 partes prontas", "4 de 4 partes prontas", "3 de 8 partes prontas", "1 de 1 parte pronta"]) assert.ok(out.includes(line), line);
  // Right under the sentence of its own delivery, before the next one starts.
  assert.ok(at(out, "Frase de exemplo sobre a entrega de teste 4.") < at(out, "3 de 8 partes prontas"));
  assert.ok(at(out, "3 de 8 partes prontas") < at(out, ">Dificuldades e bloqueios<"));
  // A delivery with no parts, and an upcoming one, say nothing about parts; the count is no issue number either.
  assert.equal(out.match(/partes? prontas?/g)?.length, 4);
  const plain = text(content);
  assert.match(plain, /- Entrega de teste 4: Frase de exemplo sobre a entrega de teste 4\.\n {2}3 de 8 partes prontas\n/);
  assert.equal(plain.match(/partes? prontas?/g)?.length, 4);
  assert.ok(!plain.includes("6 de 6") && !plain.includes("0 de 6"));
});

test("the parts line of a blocked delivery sits in the blockers, and a hidden delivery never shows one", () => {
  const content = rich({
    entries: [entry(4, "bloqueado", { subIssues: { total: 5, done: 1 } }), entry(6, "concluido", { hidden: true, subIssues: { total: 9, done: 9 } })],
  });
  for (const out of [html(content), text(content)]) {
    assert.ok(out.includes("1 de 5 partes prontas"));
    assert.ok(!out.includes("9 de 9"));
  }
  assert.ok(at(html(content), ">Dificuldades e bloqueios<") < at(html(content), "1 de 5 partes prontas"));
});
