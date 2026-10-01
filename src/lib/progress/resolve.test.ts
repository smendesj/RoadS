import { test } from "node:test";
import assert from "node:assert/strict";
import type { Overrides, ProgressContent, ProgressEntry, UsageModel } from "../progress-report.ts";
import { locateKey, parseKey, resolveContent, resolveFlags, resolveHidden } from "./resolve.ts";

const usage: UsageModel = {
  scope: "GeoCloud",
  window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-07T00:00:00-03:00" },
  generatedAt: "2026-01-07T09:00:00-03:00",
  totals: { sessions: 0, messages: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  byModel: [],
  favoriteModel: null,
  peakHour: null,
  days: [],
};

const entry = (id: string, over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  id,
  issue: Number(id.slice(3)),
  status: "em_andamento",
  title: `Título ${id}`,
  summary: `Resumo de ${id}.`,
  deliveredAt: null,
  subIssues: null,
  hidden: false,
  edited: false,
  sources: [],
  ...over,
});

const content = (over: Partial<ProgressContent> = {}): ProgressContent => ({
  window: usage.window,
  headline: "Semana de exemplo.",
  entries: [entry("gc-1"), entry("gc-2")],
  internal: { count: 3, text: "Três melhorias internas." },
  difficulties: [
    { id: "d1", text: "Primeira dificuldade.", needs: "Uma decisão." },
    { id: "d2", text: "Segunda dificuldade.", needs: "Mais gente." },
  ],
  nextSteps: [
    { id: "n1", text: "Primeiro passo." },
    { id: "n2", text: "Segundo passo." },
  ],
  usage,
  ...over,
});

const row = (overrides: Overrides = {}, c: ProgressContent = content()) => ({ content: c, overrides });

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/* ---------- applying edits ---------- */

test("without edits the user sees exactly what was pushed", () => {
  assert.deepEqual(resolveContent(row()), content());
});

test("an edited summary replaces the pushed one and marks only that entry as edited", () => {
  const out = resolveContent(row({ "entry:gc-1:summary": { value: "Minha frase.", base: "Resumo de gc-1." } }));
  assert.equal(out.entries[0].summary, "Minha frase.");
  assert.equal(out.entries[0].edited, true);
  assert.equal(out.entries[0].title, "Título gc-1");
  assert.equal(out.entries[1].summary, "Resumo de gc-2.");
  assert.equal(out.entries[1].edited, false);
});

test("an edited title and an edited status count as well", () => {
  const out = resolveContent(
    row({
      "entry:gc-2:title": { value: "Novo título", base: "Título gc-2" },
      "entry:gc-2:status": { value: "concluido", base: "em_andamento" },
    })
  );
  assert.equal(out.entries[1].title, "Novo título");
  assert.equal(out.entries[1].status, "concluido");
  assert.equal(out.entries[1].edited, true);
});

test("a status that is not one of the five is ignored", () => {
  const out = resolveContent(row({ "entry:gc-1:status": { value: "quase_pronto", base: "em_andamento" } }));
  assert.equal(out.entries[0].status, "em_andamento");
  assert.equal(out.entries[0].edited, false);
});

test("the headline, the internal line, difficulties and next steps take their edits", () => {
  const out = resolveContent(
    row({
      headline: { value: "Nova abertura.", base: "Semana de exemplo." },
      internal: { value: "Só organização.", base: "Três melhorias internas." },
      "difficulty:d2:text": { value: "Outro texto.", base: "Segunda dificuldade." },
      "difficulty:d2:needs": { value: "", base: "Mais gente." },
      "nextStep:n1:text": { value: "Passo reescrito.", base: "Primeiro passo." },
    })
  );
  assert.equal(out.headline, "Nova abertura.");
  assert.deepEqual(out.internal, { count: 3, text: "Só organização." });
  assert.deepEqual(out.difficulties[1], { id: "d2", text: "Outro texto.", needs: "" });
  assert.deepEqual(out.difficulties[0], { id: "d1", text: "Primeira dificuldade.", needs: "Uma decisão." });
  assert.equal(out.nextSteps[0].text, "Passo reescrito.");
  assert.equal(out.nextSteps[1].text, "Segundo passo.");
});

test("resolving never changes what it was given", () => {
  const input = deepFreeze(
    row({
      "entry:gc-1:summary": { value: "Minha frase.", base: "Resumo de gc-1." },
      "entry:gc-2:hidden": { value: true },
      "difficulty:d1:hidden": { value: true },
    })
  );
  const before = JSON.stringify(input);
  const out = resolveContent(input);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(out.entries[0], input.content.entries[0]);
});

/* ---------- pushing again ---------- */

test("pushing again with new text keeps the edit and points at the new suggestion", () => {
  const overrides: Overrides = { "entry:gc-1:summary": { value: "Minha frase.", base: "Resumo de gc-1." } };

  const sameText = row(overrides);
  assert.equal(resolveContent(sameText).entries[0].summary, "Minha frase.");
  assert.deepEqual(resolveFlags(sameText), []);

  const repushed = row(overrides, content({ entries: [entry("gc-1", { summary: "Texto novo vindo do coletor." }), entry("gc-2")] }));
  assert.equal(resolveContent(repushed).entries[0].summary, "Minha frase.");
  assert.deepEqual(resolveFlags(repushed), ["entry:gc-1:summary"]);
});

test("a new suggestion is flagged for any text field, status included, and only when it differs", () => {
  const overrides: Overrides = {
    headline: { value: "Minha abertura.", base: "Abertura antiga." },
    internal: { value: "Minha linha.", base: "Três melhorias internas." },
    "entry:gc-2:status": { value: "concluido", base: "proximo" },
    "difficulty:d1:needs": { value: "Meu pedido.", base: "Pedido antigo." },
    "nextStep:n2:text": { value: "Meu passo.", base: "Segundo passo." },
  };
  assert.deepEqual(resolveFlags(row(overrides)), ["headline", "entry:gc-2:status", "difficulty:d1:needs"]);
});

test("when the new suggestion is what the user already has, there is nothing to flag", () => {
  const overrides: Overrides = { "entry:gc-1:summary": { value: "Resumo de gc-1.", base: "Texto antigo." } };
  assert.deepEqual(resolveFlags(row(overrides)), []);
});

test("an edit with no base (hiding) is never a suggestion to review", () => {
  assert.deepEqual(resolveFlags(row({ "entry:gc-1:hidden": { value: true } })), []);
});

/* ---------- edits that point at nothing ---------- */

test("an edit whose entry is gone is ignored, and does not count as a new suggestion", () => {
  const out = resolveContent(
    row({
      "entry:gc-9:summary": { value: "Fantasma.", base: "Antigo." },
      "entry:gc-9:hidden": { value: true },
      "difficulty:zz:text": { value: "Fantasma.", base: "Antigo." },
      "nextStep:zz:hidden": { value: true },
      "nextStep:n1:text": { value: "Outra coisa.", base: "Primeiro passo." },
    })
  );
  assert.deepEqual(out.entries, content().entries);
  assert.deepEqual(out.difficulties, content().difficulties);
  assert.equal(out.nextSteps.length, 2);
  assert.deepEqual(
    resolveFlags(row({ "entry:gc-9:summary": { value: "Fantasma.", base: "Antigo." }, "difficulty:zz:text": { value: "x", base: "y" } })),
    []
  );
});

test("an orphaned edit comes back to life if its entry returns in a later push", () => {
  const overrides: Overrides = { "entry:gc-3:title": { value: "Meu título", base: "Título gc-3" } };
  assert.equal(resolveContent(row(overrides)).entries.length, 2);
  const back = resolveContent(row(overrides, content({ entries: [entry("gc-3")] })));
  assert.equal(back.entries[0].title, "Meu título");
});

test("stored edits that make no sense are ignored instead of breaking the report", () => {
  // JSON.parse, like the database column: it makes a real own "__proto__" key, which an object literal would not.
  const broken = JSON.parse(`{
    "entry:gc-1:summary": { "value": 42 },
    "entry:gc-1:title": { "value": "" },
    "entry:gc-2:hidden": { "value": "sim" },
    "headline": null,
    "nonsense:key": { "value": "x" },
    "entry:gc-1:colour": { "value": "red" },
    "__proto__": { "value": "x", "base": "y" }
  }`) as Overrides;
  assert.deepEqual(resolveContent(row(broken)), content());
  assert.deepEqual(resolveFlags(row(broken)), []);
  assert.deepEqual(resolveContent({ content: content(), overrides: null as unknown as Overrides }), content());
});

/* ---------- hiding ---------- */

test("hiding sticks: it holds after the entry is pushed again, whatever the push says", () => {
  const overrides: Overrides = { "entry:gc-1:hidden": { value: true } };
  assert.equal(resolveContent(row(overrides)).entries[0].hidden, true);
  const repushed = row(overrides, content({ entries: [entry("gc-1", { hidden: false, summary: "Outro texto." }), entry("gc-2")] }));
  assert.equal(resolveContent(repushed).entries[0].hidden, true);
  assert.equal(resolveContent(repushed).entries[1].hidden, false);
});

test("hiding is not an edit of the text, and showing again wins over a pushed 'hidden'", () => {
  const hiddenOnly = resolveContent(row({ "entry:gc-1:hidden": { value: true } }));
  assert.equal(hiddenOnly.entries[0].edited, false);
  const pushedHidden = content({ entries: [entry("gc-1", { hidden: true }), entry("gc-2")] });
  assert.equal(resolveContent(row({}, pushedHidden)).entries[0].hidden, true);
  assert.equal(resolveContent(row({ "entry:gc-1:hidden": { value: false } }, pushedHidden)).entries[0].hidden, false);
});

test("a hidden difficulty or next step leaves the lists, and can still be found to bring back", () => {
  const input = row({
    "difficulty:d1:hidden": { value: true },
    "difficulty:d1:text": { value: "Reescrita.", base: "Primeira dificuldade." },
    "nextStep:n2:hidden": { value: true },
  });
  const out = resolveContent(input);
  assert.deepEqual(out.difficulties.map((d) => d.id), ["d2"]);
  assert.deepEqual(out.nextSteps.map((n) => n.id), ["n1"]);
  assert.deepEqual(resolveHidden(input), {
    difficulties: [{ id: "d1", text: "Reescrita.", needs: "Uma decisão." }],
    nextSteps: [{ id: "n2", text: "Segundo passo." }],
  });
  assert.deepEqual(resolveHidden(row()), { difficulties: [], nextSteps: [] });
});

test("difficulties and next steps without an id cannot be addressed, so they stay as pushed", () => {
  const noIds = content({ difficulties: [{ text: "Sem id.", needs: "" }], nextSteps: [{ text: "Também sem id." }] });
  const out = resolveContent(row({ "difficulty:undefined:hidden": { value: true }, "nextStep::hidden": { value: true } }, noIds));
  assert.deepEqual(out.difficulties, noIds.difficulties);
  assert.deepEqual(out.nextSteps, noIds.nextSteps);
});

/* ---------- the key grammar ---------- */

test("keys: the shapes of the contract are understood, with their limits", () => {
  assert.deepEqual(parseKey("headline"), { scope: "headline", id: null, field: "headline", type: "text", max: 320, allowEmpty: false });
  assert.deepEqual(parseKey("internal"), { scope: "internal", id: null, field: "internal", type: "text", max: 280, allowEmpty: true });
  assert.deepEqual(parseKey("entry:gc-12:title"), { scope: "entry", id: "gc-12", field: "title", type: "text", max: 80, allowEmpty: false });
  assert.equal(parseKey("entry:gc-12:summary")?.max, 280);
  assert.equal(parseKey("entry:gc-12:status")?.type, "status");
  assert.equal(parseKey("entry:gc-12:hidden")?.type, "flag");
  assert.equal(parseKey("difficulty:d1:needs")?.allowEmpty, true);
  assert.equal(parseKey("difficulty:d1:text")?.allowEmpty, false);
  assert.equal(parseKey("difficulty:d1:hidden")?.type, "flag");
  assert.equal(parseKey("nextStep:n1:text")?.scope, "nextStep");
  assert.equal(parseKey("nextStep:n1:hidden")?.type, "flag");
});

test("keys: anything else is refused", () => {
  for (const bad of [
    "",
    "Headline",
    "headline:x",
    "entry",
    "entry:gc-1",
    "entry::title",
    "entry:gc-1:colour",
    "entry:gc-1:title:extra",
    "nextStep:n1:needs",
    "difficulty:d1:status",
    "internal:text",
    "__proto__",
    "constructor",
    "entry:a b:title",
    `entry:${"x".repeat(65)}:title`,
  ]) {
    assert.equal(parseKey(bad), null, JSON.stringify(bad));
  }
});

test("keys: locating the pushed text a key edits, or nothing when the target is gone", () => {
  const c = content();
  assert.deepEqual(locateKey(c, "headline"), { pushed: "Semana de exemplo." });
  assert.deepEqual(locateKey(c, "internal"), { pushed: "Três melhorias internas." });
  assert.deepEqual(locateKey(c, "entry:gc-2:summary"), { pushed: "Resumo de gc-2." });
  assert.deepEqual(locateKey(c, "entry:gc-2:status"), { pushed: "em_andamento" });
  assert.deepEqual(locateKey(c, "entry:gc-2:hidden"), { pushed: null });
  assert.deepEqual(locateKey(c, "difficulty:d2:needs"), { pushed: "Mais gente." });
  assert.deepEqual(locateKey(c, "nextStep:n1:hidden"), { pushed: null });
  assert.equal(locateKey(c, "entry:gc-9:title"), null);
  assert.equal(locateKey(c, "difficulty:zz:text"), null);
  assert.equal(locateKey(c, "nextStep:zz:text"), null);
  assert.equal(locateKey(c, "not a key"), null);
});
