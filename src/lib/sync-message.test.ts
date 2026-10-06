import { test } from "node:test";
import assert from "node:assert/strict";
import { roadmapSyncMessage, syncFailureMessage } from "./sync-message.ts";

test("a missing GitHub token says so, wherever the sync was started from", () => {
  assert.match(syncFailureMessage({ reason: "not_configured" }), /ainda não configurada.*GITHUB_TOKEN/);
});

test("other failures keep GitHub's own message when there is one", () => {
  assert.equal(syncFailureMessage({ reason: "error", message: "GitHub respondeu 502" }), "GitHub respondeu 502");
  assert.equal(syncFailureMessage({ reason: "no_access", message: "O token não enxerga o Project #7" }), "O token não enxerga o Project #7");
});

test("and fall back to a generic line when there isn't", () => {
  assert.equal(syncFailureMessage({ reason: "error" }), "Erro ao sincronizar.");
  assert.equal(syncFailureMessage({ reason: "unauthenticated" }), "Entre para sincronizar o board.");
});

test("the Roadmap summary counts what came in and went out, and mentions created issues only when there were some", () => {
  assert.equal(roadmapSyncMessage({ added: 2, removed: 1, issuesCreated: 0 }), "2 issue(s) adicionada(s), 1 encerrada(s) ou fora do Project removida(s).");
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 3 }),
    "0 issue(s) adicionada(s), 0 encerrada(s) ou fora do Project removida(s), 3 issue(s) criada(s) para itens sem issue."
  );
});

test("the Roadmap summary says how many issues stayed out for lack of a type label", () => {
  assert.equal(
    roadmapSyncMessage({ added: 1, removed: 0, issuesCreated: 0, untyped: 2 }),
    "1 issue(s) adicionada(s), 0 encerrada(s) ou fora do Project removida(s). 2 issue(s) aberta(s) sem label type:* ficaram de fora até ganharem tipo."
  );
});

test("a Roadmap that failed reports its own error instead of counts", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, error: "falhou" }), "falhou");
});

const NO_SPRINT = { pulled: 0, released: 0, written: 0, wouldWrite: 0, failed: 0, stuck: 0 };
const BASE = "0 issue(s) adicionada(s), 0 encerrada(s) ou fora do Project removida(s).";

test("a sprint that needed nothing from the Project adds nothing to the Roadmap summary", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: NO_SPRINT }), BASE);
});

test("the summary says how the Roadmap and the Project followed each other", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, pulled: 2, released: 1, written: 3 } }),
    `${BASE} Sprint atual e Project: 2 issue(s) puxada(s) para a sprint atual, 1 devolvida(s) ao Roadmap, 3 status escrito(s) no Project.`
  );
});

test("with the writing off it says what would have been written, not that it was", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, wouldWrite: 2 } }),
    `${BASE} Sprint atual e Project: 2 status seriam escritos no Project, mas a escrita está desligada.`
  );
});

test("a failure of the sprint step is reported next to the counts, never hidden", () => {
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, pulled: 1, failed: 2, stuck: 1 } }),
    `${BASE} Sprint atual e Project: 1 issue(s) puxada(s) para a sprint atual, 2 falharam, 1 sem bloco para voltar ao Roadmap.`
  );
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, sprint: { ...NO_SPRINT, error: "fila ilegível" } }),
    `${BASE} A sprint atual não acompanhou o Project: fila ilegível.`
  );
});
