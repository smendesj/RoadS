import { test } from "node:test";
import assert from "node:assert/strict";
import { importableIssues, isTestData, mayGetIssue } from "./test-data.ts";
import { NEW_ITEM_TITLE } from "./types.ts";

test("a title that starts with [TESTE] is test data, leading spaces tolerated", () => {
  assert.equal(isTestData("[TESTE] e2e card 1"), true);
  assert.equal(isTestData("   [TESTE] e2e card 2"), true);
  assert.equal(isTestData("\t[TESTE]sem espaço"), true);
});

test("a title that only mentions [TESTE] elsewhere, or a lookalike, is not test data", () => {
  assert.equal(isTestData("Exportar relatório"), false);
  assert.equal(isTestData("Corrigir [TESTE] no meio"), false);
  assert.equal(isTestData("[teste] minúsculo"), false);
  assert.equal(isTestData("TESTE sem colchetes"), false);
  assert.equal(isTestData(""), false);
});

test("an item marked [TESTE] without an issue never gets one", () => {
  assert.equal(mayGetIssue({ title: "[TESTE] e2e card 1", github_issue_url: null }), false);
  assert.equal(mayGetIssue({ title: "  [TESTE] e2e card 2", github_issue_url: null }), false);
});

test("a common item without an issue gets one", () => {
  assert.equal(mayGetIssue({ title: "Exportar relatório", github_issue_url: null }), true);
});

test("an item that already has an issue, or still has the new-item title, gets none", () => {
  assert.equal(mayGetIssue({ title: "Exportar relatório", github_issue_url: "https://github.com/example/repo/issues/1" }), false);
  assert.equal(mayGetIssue({ title: NEW_ITEM_TITLE, github_issue_url: null }), false);
});

test("an issue on the Project marked [TESTE] is not imported; the others are, in order", () => {
  const open = [
    { number: 1, title: "Exportar relatório" },
    { number: 2, title: "[TESTE] e2e card 1" },
    { number: 3, title: " [TESTE] e2e card 2" },
    { number: 4, title: "Corrigir [TESTE] no meio" },
  ];
  assert.deepEqual(
    importableIssues(open).map((i) => i.number),
    [1, 4]
  );
});
