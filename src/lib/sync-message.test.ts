import { test } from "node:test";
import assert from "node:assert/strict";
import { syncFailureMessage } from "./sync-message.ts";

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
