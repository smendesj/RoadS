import { test } from "node:test";
import assert from "node:assert/strict";
import { planTitleFollow, type TitleCandidate } from "./title-follow.ts";

const item = (over: Partial<TitleCandidate> = {}): TitleCandidate => ({ id: "a", title: "Título do Roadmap", githubTitle: "Título da issue", issueTitle: "Título da issue", ...over });

test("an item RoadS has never compared with its issue only learns the issue's title: nothing is renamed", () => {
  const plan = planTitleFollow([item({ githubTitle: null, title: "Redação própria", issueTitle: "Título da issue" })]);
  assert.deepEqual(plan.rename, []);
  assert.deepEqual(plan.seen, [{ id: "a", githubTitle: "Título da issue" }]);
});

test("an issue that is called what it was called last time leaves the item alone, whatever the item says", () => {
  const plan = planTitleFollow([item({ title: "Redação do Roadmap, mais curta" })]);
  assert.deepEqual(plan, { rename: [], seen: [] });
});

test("an issue renamed on GitHub since the last sync renames the item, and the new name is remembered", () => {
  const plan = planTitleFollow([item({ title: "MVP · N2 · Convites", githubTitle: "MVP · N2 · Convites", issueTitle: "MVP · 1C · Convites" })]);
  assert.deepEqual(plan.rename, [{ id: "a", from: "MVP · N2 · Convites", to: "MVP · 1C · Convites" }]);
  assert.deepEqual(plan.seen, [{ id: "a", githubTitle: "MVP · 1C · Convites" }]);
});

test("a renamed issue whose item already says the new name is only remembered", () => {
  const plan = planTitleFollow([item({ title: "Novo nome", githubTitle: "Nome antigo", issueTitle: "Novo nome" })]);
  assert.deepEqual(plan.rename, []);
  assert.deepEqual(plan.seen, [{ id: "a", githubTitle: "Novo nome" }]);
});

test("a title a person reworded in the Roadmap stays while the issue's title stays: only a rename on GitHub takes it back", () => {
  const reworded = item({ title: "Minha redação", githubTitle: "Título da issue", issueTitle: "Título da issue" });
  assert.deepEqual(planTitleFollow([reworded]).rename, []);
  const renamedLater = item({ title: "Minha redação", githubTitle: "Título da issue", issueTitle: "Título renomeado" });
  assert.deepEqual(planTitleFollow([renamedLater]).rename, [{ id: "a", from: "Minha redação", to: "Título renomeado" }]);
});

test("spaces around the issue's title don't count as a rename, and an empty title is never taken", () => {
  assert.deepEqual(planTitleFollow([item({ issueTitle: "  Título da issue \n" })]), { rename: [], seen: [] });
  assert.deepEqual(planTitleFollow([item({ githubTitle: null, issueTitle: "   " })]), { rename: [], seen: [] });
  assert.deepEqual(planTitleFollow([item({ issueTitle: "" })]), { rename: [], seen: [] });
});

test("each item is planned on its own", () => {
  const plan = planTitleFollow([
    item({ id: "x", title: "Velho", githubTitle: "Velho", issueTitle: "Novo" }),
    item({ id: "y" }),
    item({ id: "z", githubTitle: null, issueTitle: "Primeira vez" }),
  ]);
  assert.deepEqual(plan.rename.map((r) => r.id), ["x"]);
  assert.deepEqual(plan.seen.map((s) => s.id), ["x", "z"]);
});
