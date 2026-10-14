import { test } from "node:test";
import assert from "node:assert/strict";
import { boxCheckedAt, boxTitle, criteriaBoxes } from "./criteria.ts";

const lines = (...l: string[]) => l.join("\n");
const view = (body: string) => criteriaBoxes(body)?.map((b) => [b.checked ? "x" : " ", b.text]) ?? null;

test("the boxes of the acceptance-criteria section, in order, each with whether it is ticked", () => {
  const body = lines("## Problema", "- [ ] não conta: fora da seção", "", "## Critérios de aceitação", "- [x] S1. Primeira", "- [ ] S2. Segunda", "", "## Riscos", "- [ ] fora de novo");
  assert.deepEqual(view(body), [["x", "S1. Primeira"], [" ", "S2. Segunda"]]);
});

test("the heading is found at any level, without accents or case, in English or Portuguese, with decoration or a closing #", () => {
  for (const h of ["# Acceptance criteria", "### CRITÉRIOS DE ACEITAÇÃO ###", "## criterios de aceite (v2)", "## **Critérios de aceitação**", "#### ✅ Critérios de aceitação"]) {
    assert.equal(criteriaBoxes(lines(h, "- [ ] a"))?.length, 1, h);
  }
  assert.equal(criteriaBoxes(lines("## Critérios", "- [ ] a")), null, "only the three phrases open the section");
  assert.equal(criteriaBoxes("sem seção nenhuma\n- [ ] solta"), null);
});

test("the section runs to the next heading of the same or a higher level; deeper headings belong to it", () => {
  const body = lines("## Critérios de aceitação", "- [ ] a", "### Detalhe", "- [x] b", "## Fora", "- [ ] c", "# Topo", "- [ ] d");
  assert.deepEqual(view(body), [[" ", "a"], ["x", "b"]]);
});

test("items are -, *, + or numbered, any case of x, any indentation; sub-items without a box never count", () => {
  const body = lines(
    "## Critérios de aceitação",
    "- [ ] a",
    "  - Entrega: algo",
    "  - Seams: um",
    "* [X] b",
    "+ [x] c",
    "1. [ ] d",
    "2) [x] e",
    "    - [ ] f recuada",
    "- [] não é caixa",
    "-[ ] também não"
  );
  assert.deepEqual(view(body), [[" ", "a"], ["x", "b"], ["x", "c"], [" ", "d"], ["x", "e"], [" ", "f recuada"]]);
});

test("fenced code and HTML comments are skipped, even when they hold boxes or headings", () => {
  const body = lines(
    "## Critérios de aceitação",
    "- [ ] a",
    "```md",
    "- [ ] dentro do código",
    "## Fora",
    "```",
    "<!-- - [ ] comentário de uma linha -->",
    "<!--",
    "- [x] comentário de várias",
    "-->",
    "~~~",
    "- [ ] til",
    "~~~",
    "- [x] b"
  );
  assert.deepEqual(view(body), [[" ", "a"], ["x", "b"]]);
});

test("several criteria sections add up; a legacy 'pendências conhecidas' section is never counted", () => {
  const body = lines("## Critérios de aceitação", "- [x] a", "## Pendências conhecidas", "- [ ] p", "## Acceptance criteria", "- [ ] b");
  assert.deepEqual(view(body), [["x", "a"], [" ", "b"]]);
  const nested = lines("## Pendências conhecidas", "- [ ] p", "### Critérios de aceitação", "- [ ] c");
  assert.deepEqual(view(nested), [[" ", "c"]], "a criteria heading under a legacy section still opens the criteria");
});

test("CRLF bodies read the same as LF ones", () => {
  assert.deepEqual(view("## Critérios de aceitação\r\n- [x] a\r\n- [ ] b\r\n"), [["x", "a"], [" ", "b"]]);
});

test("a 'Bloqueada:' sub-item right under an open box says the slice is parked, and why", () => {
  const body = lines(
    "## Critérios de aceitação",
    "- [ ] S1. Primeira",
    "  - Entrega: algo",
    "  - Bloqueada: falta a chave do ambiente, com o time de infra",
    "- [ ] S2. Segunda",
    "  - **bloqueada:** esperando revisão",
    "- [ ] S3. Terceira",
    "- Bloqueada: no mesmo nível da caixa não é sub-item dela"
  );
  assert.deepEqual(
    criteriaBoxes(body)?.map((b) => b.blocked),
    ["falta a chave do ambiente, com o time de infra", "esperando revisão", null]
  );
});

test("a box's title is its text up to the end of its first sentence, or 120 characters", () => {
  assert.equal(boxTitle("S1. Etapa 4 \"Issue\": a sessão escreve o corpo. Depois o resto da linha."), "S1. Etapa 4 \"Issue\": a sessão escreve o corpo.");
  assert.equal(boxTitle("Pendência (achado da revisão): v2.1 não quebra o parser. E mais."), "Pendência (achado da revisão): v2.1 não quebra o parser.");
  const long = "palavra ".repeat(30).trim();
  const cut = boxTitle(long);
  assert.ok(cut.length <= 121 && cut.endsWith("…") && !cut.includes("palavra …"), cut);
  assert.equal(boxTitle("  curta  "), "curta");
});

const v = (at: string, ...l: string[]) => ({ at, body: lines("## Critérios de aceitação", ...l) });

test("a ticked box is dated by the body edit that ticked it, read from the body's history", () => {
  const versions = [
    v("2026-10-13T10:00:00Z", "- [ ] S1. Primeira", "- [ ] S2. Segunda"),
    v("2026-10-13T12:00:00Z", "- [x] S1. Primeira", "- [ ] S2. Segunda"),
    v("2026-10-14T09:00:00Z", "- [x] S1. Primeira", "- [x] S2. Segunda (evidência: commit abc)"),
  ];
  assert.deepEqual(boxCheckedAt(versions, "2026-10-13T09:00:00Z"), ["2026-10-13T12:00:00Z", "2026-10-14T09:00:00Z"]);
});

test("an open box has no date; one unticked and ticked again is dated by the last tick", () => {
  const versions = [
    v("2026-10-13T10:00:00Z", "- [x] S1. Primeira", "- [ ] S2. Segunda"),
    v("2026-10-13T11:00:00Z", "- [ ] S1. Primeira", "- [ ] S2. Segunda"),
    v("2026-10-13T15:00:00Z", "- [x] S1. Primeira", "- [ ] S2. Segunda"),
  ];
  assert.deepEqual(boxCheckedAt(versions, "2026-10-13T09:00:00Z"), ["2026-10-13T15:00:00Z", null]);
});

test("a box ticked since the issue was written, with no edit history, is dated by the issue's creation", () => {
  assert.deepEqual(boxCheckedAt([v("2026-10-13T10:00:00Z", "- [x] S1. Primeira", "- [ ] S2")], "2026-10-12T08:00:00Z"), ["2026-10-12T08:00:00Z", null]);
  assert.deepEqual(boxCheckedAt([], "2026-10-12T08:00:00Z"), []);
});

test("a box added later, already ticked, is dated by the edit that added it", () => {
  const versions = [
    v("2026-10-13T10:00:00Z", "- [x] S1. Primeira"),
    v("2026-10-13T18:00:00Z", "- [x] S1. Primeira", "- [x] Pendência (achado da revisão): corrigida no mesmo PR"),
  ];
  assert.deepEqual(boxCheckedAt(versions, "2026-10-13T09:00:00Z"), ["2026-10-13T09:00:00Z", "2026-10-13T18:00:00Z"]);
});
