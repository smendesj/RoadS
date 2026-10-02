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
  assert.equal(roadmapSyncMessage({ added: 2, removed: 1, issuesCreated: 0 }), "2 issue(s) adicionada(s), 1 encerrada(s) removida(s).");
  assert.equal(
    roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 3 }),
    "0 issue(s) adicionada(s), 0 encerrada(s) removida(s), 3 issue(s) criada(s) para itens sem issue."
  );
});

test("a Roadmap that failed reports its own error instead of counts", () => {
  assert.equal(roadmapSyncMessage({ added: 0, removed: 0, issuesCreated: 0, error: "falhou" }), "falhou");
});