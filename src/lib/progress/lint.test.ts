import { test } from "node:test";
import assert from "node:assert/strict";
import type { LintSection } from "../progress-report.ts";
import { JARGON_TERMS, MAX_SENTENCE, lintSentence } from "./lint.ts";

const codes = (text: string, section?: LintSection) => lintSentence(text, section).map((i) => i.code);

test("a plain sentence in Portuguese has nothing to report", () => {
  assert.deepEqual(lintSentence("Agora o cliente acompanha o andamento do pedido pela tela inicial."), []);
  assert.deepEqual(lintSentence(""), []);
});

test("a sentence over 280 characters is too long, 280 exactly is fine", () => {
  assert.equal(MAX_SENTENCE, 280);
  assert.deepEqual(codes("a".repeat(281)), ["muito_longo"]);
  assert.deepEqual(codes("a".repeat(280)), []);
  const [issue] = lintSentence("a".repeat(300));
  assert.match(issue.message, /300/);
  assert.match(issue.message, /280/);
});

test("jargon is reported with the term, whatever the case", () => {
  for (const text of ["Criamos um endpoint novo", "Criamos um Endpoint novo", "CRIAMOS UM ENDPOINT NOVO"]) {
    assert.deepEqual(lintSentence(text), [{ code: "jargao", message: "termo técnico: «endpoint»" }], text);
  }
});

test("accents do not matter either", () => {
  assert.deepEqual(codes("Revisamos o repositório inteiro"), ["jargao"]);
  assert.deepEqual(codes("Revisamos o repositorio inteiro"), ["jargao"]);
  assert.deepEqual(codes("Revisamos o REPOSITÓRIO inteiro"), ["jargao"]);
  assert.equal(lintSentence("Escrevemos um teste unitario")[0].message, "termo técnico: «teste unitário»");
});

test("every term of the list is caught, alone in a sentence, plural included", () => {
  assert.ok(JARGON_TERMS.length >= 25);
  for (const term of JARGON_TERMS) {
    assert.deepEqual(lintSentence(`Fizemos ${term} hoje`), [{ code: "jargao", message: `termo técnico: «${term}»` }], term);
  }
  assert.deepEqual(lintSentence("Corrigimos 3 bugs"), [{ code: "jargao", message: "termo técnico: «bug»" }]);
  assert.deepEqual(lintSentence("Abrimos dois PRs"), [{ code: "jargao", message: "termo técnico: «PR»" }]);
});

test("only whole words count: a term inside another word is not jargon", () => {
  assert.deepEqual(lintSentence("O capital e o apito do trem chegaram"), []); // "api" in apito, "pi" in capital
  assert.deepEqual(lintSentence("Priorizamos cinco entregas"), []); // "pr" and "ci" inside words
  assert.deepEqual(lintSentence("Compramos um cachecol"), []); // "cache" inside cachecol
  assert.deepEqual(lintSentence("Estudamos javascript e fizemos o debug"), []); // "script" and "bug" at the end of a longer word
  assert.deepEqual(lintSentence("Faltou um end-point aqui"), []); // spelled apart, not required
});

test("each distinct term is listed once, in the order it appears", () => {
  assert.deepEqual(
    lintSentence("Corrigimos o bug no endpoint, o BUG e outros bugs").map((i) => i.message),
    ["termo técnico: «bug»", "termo técnico: «endpoint»"]
  );
});

test("'token' is jargon for the CEO, but the usage section may say it", () => {
  assert.deepEqual(codes("Gastamos muitos tokens", "geral"), ["jargao"]);
  assert.deepEqual(codes("Gastamos muitos tokens"), ["jargao"], "the section defaults to geral");
  assert.deepEqual(codes("Gastamos muitos tokens", "ia"), []);
  assert.deepEqual(codes("Cada token custa pouco", "ia"), []);
  assert.deepEqual(codes("Gastamos tokens e cache", "ia"), ["jargao"], "everything else stays forbidden there");
});

test("an issue number is reported, a plain number or a code-like '#' is not", () => {
  assert.deepEqual(codes("Resolvemos o item #123"), ["numero_de_issue"]);
  assert.deepEqual(codes("(#12) concluído"), ["numero_de_issue"]);
  assert.deepEqual(codes("Entregamos 120 itens"), []);
  assert.deepEqual(codes("Usamos C# e F# no projeto"), []);
  assert.deepEqual(codes("Ele disse &#39;oi&#39;"), []);
});

test("a file name or path is reported, ordinary slashes are not", () => {
  assert.deepEqual(codes("Ajustamos o arquivo src/x.ts"), ["caminho_de_arquivo"]);
  assert.deepEqual(codes("Trocamos Servico.cs por outro"), ["caminho_de_arquivo"]);
  assert.deepEqual(codes("Tudo dentro de /src/ ficou limpo"), ["caminho_de_arquivo"]);
  assert.deepEqual(codes("Os arquivos .ts foram migrados"), ["caminho_de_arquivo"]);
  assert.deepEqual(codes("Guardado em C:\\Projetos\\Exemplo\\notas"), ["caminho_de_arquivo"]);
  assert.deepEqual(codes("Ajustamos a tela e/ou o menu, 24/7 e 3/4 dos itens"), []);
});

test("code between backticks is reported", () => {
  assert.deepEqual(codes("Mudamos o `valor` da tela"), ["codigo"]);
  assert.deepEqual(codes("Mudamos o valor da tela"), []);
});

test("a link is reported once, and what is inside it is not judged again", () => {
  assert.deepEqual(codes("Veja https://exemplo.com.br/novidades"), ["url"]);
  assert.deepEqual(codes("Veja www.exemplo.com.br"), ["url"]);
  assert.deepEqual(codes("Veja https://github.com/org-exemplo/produto/issues/123/src/x.ts"), ["url"]);
  assert.deepEqual(codes("Veja o site do projeto"), []);
});

test("several problems in one sentence are all listed, long one first", () => {
  const text = `Corrigimos o bug do endpoint (#123) em src/x.ts com \`fix\`, veja https://x.com/a ${"z".repeat(280)}`;
  assert.deepEqual(codes(text), ["muito_longo", "jargao", "jargao", "numero_de_issue", "caminho_de_arquivo", "codigo", "url"]);
});

test("a huge paste does not freeze the editor, which lints on every keystroke", () => {
  for (const paste of ["a.".repeat(30_000), "a/".repeat(30_000), "a\\".repeat(30_000), "palavra ".repeat(30_000), "#".repeat(60_000)]) {
    const started = performance.now();
    lintSentence(paste);
    assert.ok(performance.now() - started < 1_000, `${paste.slice(0, 8)}… took ${Math.round(performance.now() - started)} ms`);
  }
});

test("every issue has a code and a message in Portuguese", () => {
  const issues = lintSentence("Bug em `x`, #1, src/a.ts, https://a.b e " + "y".repeat(300));
  assert.equal(new Set(issues.map((i) => i.code)).size, 6);
  for (const i of issues) {
    assert.match(i.code, /^[a-z_]+$/);
    assert.ok(i.message.length > 5, i.code);
  }
});
