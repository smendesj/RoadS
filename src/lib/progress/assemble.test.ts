import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDraft } from "./assemble.ts";
import type { AssembleInput } from "./assemble.ts";
import { parseDraft } from "./draft.ts";
import { usageFor } from "./visual-fixture.ts";
import type { ProgressContent } from "../progress-report.ts";

// Made-up data only: the repository is public.

const WINDOW = { start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" };

const fact = (n: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `gc-${n}`,
  issue: n,
  title: `Título técnico ${n}`,
  status,
  deliveredAt: status === "concluido" ? "2026-09-28T15:00:00-03:00" : null,
  subIssues: null,
  hidden: false,
  hiddenReason: null,
  evidence: ["prova interna"],
  sources: [`https://github.com/OWNER/REPOSITORY/issues/${n}`],
  ...over,
});

const facts = (over: Record<string, unknown> = {}) => ({
  scope: "GeoCloud",
  window: WINDOW,
  entries: [fact(1, "concluido"), fact(2, "em_validacao"), fact(3, "concluido", { hidden: true, hiddenReason: "entregue antes da janela" })],
  internal: { count: 4, items: [] },
  gaps: [{ at: "2026-09-28T15:00:00-03:00", ref: "PR 9", nearestMessageMinutes: 200 }],
  ...over,
});

const texts = (over: Record<string, unknown> = {}) => ({
  headline: "Duas entregas de exemplo avançaram.",
  entries: [
    { issue: 1, title: "Entrega de exemplo um", summary: "Frase de exemplo sobre a primeira entrega." },
    { issue: 2, title: "Entrega de exemplo dois", summary: "Frase de exemplo sobre a segunda entrega." },
  ],
  difficulties: [{ text: "Uma dependência de exemplo ainda não respondeu.", needs: "Uma resposta de exemplo." }],
  nextSteps: ["Primeiro passo de exemplo.", { text: "Segundo passo de exemplo." }],
  ...over,
});

const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({ texts: texts(), facts: facts(), usage: usageFor(2), ...over });

function assembled(over: Partial<AssembleInput> = {}) {
  const r = assembleDraft(input(over));
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.content as ProgressContent;
}

test("the draft joins the collected facts with the written texts, and passes the very check the server runs", () => {
  const content = assembled();
  assert.deepEqual(content.window, WINDOW);
  assert.equal(content.headline, "Duas entregas de exemplo avançaram.");
  const [one, two] = content.entries;
  assert.deepEqual([one.id, one.issue, one.status, one.title, one.hidden], ["gc-1", 1, "concluido", "Entrega de exemplo um", false]);
  assert.equal(one.deliveredAt, "2026-09-28T15:00:00-03:00");
  assert.equal(two.status, "em_validacao");
  // The prints are attached by the push script, one per delivery on show; with them, the server takes it.
  const shots = [1, 2].map((issue) => ({ id: `shot-${issue}`, caption: "Tela de exemplo", mime: "image/png" as const, issue, path: `${String(issue).repeat(64)}.png` }));
  assert.equal(parseDraft({ produto: "GeoCloud", content: { ...content, shots } }).ok, true);
});

test("a status is whatever the facts say: a text can never change it", () => {
  const content = assembled({ texts: texts({ entries: [{ issue: 1, title: "A", summary: "B.", status: "bloqueado" }, { issue: 2, title: "C", summary: "D." }] }) });
  assert.equal(content.entries[0].status, "concluido");
});

test("a visible delivery without a written text is refused, naming it", () => {
  const r = assembleDraft(input({ texts: texts({ entries: [{ issue: 1, title: "Só a um", summary: "Frase." }] }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /#2\b/);
});

test("a text for an issue the facts do not have is refused, naming it", () => {
  const r = assembleDraft(input({ texts: texts({ entries: [...(texts().entries as unknown[]), { issue: 99, title: "X", summary: "Y." }] }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /#99\b/);
});

test("an entry the collector hides stays hidden, with a neutral line instead of its technical title", () => {
  const content = assembled();
  const hidden = content.entries.find((e) => e.issue === 3);
  assert.ok(hidden);
  assert.equal(hidden.hidden, true);
  assert.doesNotMatch(`${hidden.title} ${hidden.summary}`, /técnico/);
  assert.ok(hidden.title.length > 0 && hidden.summary.length > 0);
});

test("a text may hide an entry, and may show one the collector hid", () => {
  const entries = [
    { issue: 1, title: "A", summary: "B.", hidden: true },
    { issue: 2, title: "C", summary: "D." },
    { issue: 3, title: "E", summary: "F.", hidden: false },
  ];
  const content = assembled({ texts: texts({ entries }) });
  assert.deepEqual(content.entries.map((e) => e.hidden), [true, false, false]);
});

test("next steps may be plain strings or objects; difficulties get an empty 'needs' when none is given", () => {
  const content = assembled({ texts: texts({ difficulties: [{ text: "Sem necessidade informada." }] }) });
  assert.deepEqual(content.nextSteps.map((n) => n.text), ["Primeiro passo de exemplo.", "Segundo passo de exemplo."]);
  assert.equal(content.difficulties[0].needs, "");
});

test("the internal line uses the collected count, with a default sentence unless the texts bring one", () => {
  assert.deepEqual(assembled().internal, { count: 4, text: "Também houve 4 ajustes internos de organização." });
  assert.equal(assembled({ texts: texts({ internal: "Linha própria." }) }).internal.text, "Linha própria.");
  assert.deepEqual(assembled({ facts: facts({ internal: { count: 0, items: [] } }) }).internal, { count: 0, text: "" });
});

test("at most 20 sources per entry, and the usage and the sign-in details travel as they came", () => {
  const many = Array.from({ length: 30 }, (_, i) => `https://github.com/OWNER/REPOSITORY/pull/${i + 1}`);
  const access = { account: "reader@example.test", password: "Tmp-pass-1234" };
  const content = assembled({ facts: facts({ entries: [fact(1, "concluido", { sources: many }), fact(2, "em_validacao")] }), access });
  assert.equal(content.entries[0].sources.length, 20);
  assert.deepEqual(content.access, access);
  assert.equal(content.usage.scope, "GeoCloud");
  assert.equal(assembled().access, undefined);
});

test("the gaps of the facts are not carried: the coverage warning is gone", () => {
  assert.equal(assembled().gaps, undefined);
});

test("what is missing is said plainly: the opening line, the facts, the usage", () => {
  const noHeadline = assembleDraft(input({ texts: texts({ headline: undefined }) }));
  assert.equal(noHeadline.ok, false);
  if (!noHeadline.ok) assert.match(noHeadline.error, /abertura|headline/i);
  for (const [field, pattern] of [["facts", /fatos/i], ["usage", /uso/i], ["texts", /texto/i]] as const) {
    const r = assembleDraft(input({ [field]: null } as Partial<AssembleInput>));
    assert.equal(r.ok, false, field);
    if (!r.ok) assert.match(r.error, pattern, field);
  }
});

test("an error never repeats the text it was sent", () => {
  const SENTINEL = "SENTINELA-DE-TESTE-77";
  const r = assembleDraft(input({ texts: texts({ entries: [{ issue: 1, title: SENTINEL, summary: SENTINEL }, { issue: 99, title: SENTINEL, summary: SENTINEL }] }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(!r.error.includes(SENTINEL));
});

test("the parts of a delivery travel to the draft, and the slices stay in the facts: they never reach the content", () => {
  const SLICE_TITLE = "Parte fechada de exemplo";
  const slices = { closed: [{ title: SLICE_TITLE, closedAt: "2026-09-28T16:00:00-03:00" }], blocked: [{ title: "Parte bloqueada de exemplo" }] };
  const content = assembled({
    facts: facts({ entries: [fact(1, "concluido", { subIssues: { total: 8, done: 5 }, slices }), fact(2, "em_validacao", { slices: { closed: [], blocked: [] } }), fact(3, "concluido", { hidden: true })] }),
  });
  assert.deepEqual(content.entries[0].subIssues, { total: 8, done: 5 });
  for (const e of content.entries) {
    assert.equal("slices" in e, false);
    assert.deepEqual(Object.keys(e).sort(), ["deliveredAt", "edited", "hidden", "id", "issue", "sources", "status", "subIssues", "summary", "title"]);
  }
  assert.ok(!JSON.stringify(content).includes(SLICE_TITLE) && !JSON.stringify(content).includes("bloqueada de exemplo"));
  // What the server runs on the push takes it as it is.
  const shots = [1, 2].map((issue) => ({ id: `shot-${issue}`, caption: "Tela de exemplo", mime: "image/png" as const, issue, path: `${String(issue).repeat(64)}.png` }));
  const parsed = parseDraft({ produto: "GeoCloud", content: { ...content, shots } });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.content.entries[0].subIssues, { total: 8, done: 5 });
});

const cover = (n: number, over: Record<string, unknown> = {}) => ({
  issue: n,
  title: `Capa técnica ${n}`,
  issues: { total: 9, done: 4 },
  parts: { total: 17, done: 12, remaining: 5 },
  open: [{ issue: n + 1, title: `Entrega aberta ${n + 1}` }],
  ...over,
});
const withSprint = (epics: unknown[]) => facts({ sprint: { epics, totals: { covers: epics.length, remainingParts: epics.length * 5 } }, delivered: { issues: 2, parts: 9 } });

test("the sprint block comes from the facts, with the writer's sentence per cover or an empty one, and nothing else of the facts", () => {
  const content = assembled({ facts: withSprint([cover(900), cover(950)]), texts: texts({ sprint: [{ issue: 900, summary: "Uma frase simples sobre a capa." }] }) });
  assert.deepEqual(content.sprint?.epics.map((c) => [c.issue, c.title, c.summary]), [[900, "Capa técnica 900", "Uma frase simples sobre a capa."], [950, "Capa técnica 950", ""]]);
  assert.deepEqual(content.sprint?.epics[0].parts, { total: 17, done: 12, remaining: 5 });
  assert.deepEqual(content.sprint?.epics[0].open, [{ issue: 901, title: "Entrega aberta 901" }]);
  assert.deepEqual(content.sprint?.totals, { covers: 2, remainingParts: 10 });
  // The chip of what was delivered is made from the deliveries on show, so what the user edits is followed: it is not stored.
  assert.equal("delivered" in content, false);
  const shots = [1, 2].map((issue) => ({ id: `shot-${issue}`, caption: "Tela de exemplo", mime: "image/png" as const, issue, path: `${String(issue).repeat(64)}.png` }));
  assert.equal(parseDraft({ produto: "GeoCloud", content: { ...content, shots } }).ok, true);
});

test("facts without a sprint block (older ones) give a draft without one, and a sentence for a cover the facts do not have is refused", () => {
  assert.equal("sprint" in assembled(), false);
  assert.equal(assembled({ facts: withSprint([]) }).sprint?.epics.length, 0);
  const r = assembleDraft(input({ facts: withSprint([cover(900)]), texts: texts({ sprint: [{ issue: 900, summary: "Certa." }, { issue: 777, summary: "Errada." }] }) }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /#777 /);
});
