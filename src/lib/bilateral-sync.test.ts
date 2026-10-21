import { test } from "node:test";
import assert from "node:assert/strict";

import { decideField, extractSolucao, labelsAfter, mayPush, nativeTypeOf, replaceSolucao, tipoOfLabels } from "./bilateral-sync.ts";

const at = (h: number) => `2026-10-21T${String(h).padStart(2, "0")}:00:00Z`;

test("a field only RoadS changed goes to GitHub", () => {
  assert.equal(decideField({ roads: "Novo", base: "Antigo", github: "Antigo", roadsAt: at(10), githubAt: null }), "push");
});

test("a field only GitHub changed comes to RoadS", () => {
  assert.equal(decideField({ roads: "Antigo", base: "Antigo", github: "Novo", roadsAt: null, githubAt: at(10) }), "pull");
});

test("a field already equal on both sides needs nothing, whatever the base says", () => {
  assert.equal(decideField({ roads: "Igual", base: "Outro", github: "Igual", roadsAt: at(9), githubAt: at(10) }), "none");
});

test("with no base yet (the first sync of the field), RoadS copies GitHub and writes nothing there", () => {
  assert.equal(decideField({ roads: "Do RoadS", base: null, github: "Do GitHub", roadsAt: at(12), githubAt: at(1) }), "pull");
});

test("when both sides changed, the last one to move wins", () => {
  assert.equal(decideField({ roads: "R", base: "B", github: "G", roadsAt: at(11), githubAt: at(10) }), "push");
  assert.equal(decideField({ roads: "R", base: "B", github: "G", roadsAt: at(10), githubAt: at(11) }), "pull");
});

test("when both changed and a side's time is unknown, GitHub wins", () => {
  assert.equal(decideField({ roads: "R", base: "B", github: "G", roadsAt: null, githubAt: null }), "pull");
  assert.equal(decideField({ roads: "R", base: "B", github: "G", roadsAt: at(11), githubAt: null }), "pull");
});

test("only scrum masters, admins and the cron push to GitHub; a dev's sync only pulls", () => {
  assert.equal(mayPush("admin"), true);
  assert.equal(mayPush("scrum_master"), true);
  assert.equal(mayPush("cron"), true);
  assert.equal(mayPush("dev"), false);
  assert.equal(mayPush(null), false);
});

const BODY = ["## Problema", "", "Dor.", "", "## Solução", "", "Primeira linha.", "Segunda linha.", "", "## Critérios de aceitação", "", "- [ ] S1. Algo"].join("\n");

test("the Description is the Solução section of the body, and nothing else", () => {
  assert.equal(extractSolucao(BODY), "Primeira linha.\nSegunda linha.");
  assert.equal(extractSolucao("## Problema\n\nSó isso."), null);
  assert.equal(extractSolucao("## Solução\n\nNo fim."), "No fim.");
});

test("writing the Description replaces only the Solução section and keeps the rest of the body byte for byte", () => {
  const next = replaceSolucao(BODY, "Texto novo.");
  assert.equal(
    next,
    ["## Problema", "", "Dor.", "", "## Solução", "", "Texto novo.", "", "## Critérios de aceitação", "", "- [ ] S1. Algo"].join("\n")
  );
});

test("a body without a Solução section gets one at the end, and the rest stays as it was", () => {
  assert.equal(replaceSolucao("## Problema\n\nDor.", "Texto novo."), "## Problema\n\nDor.\n\n## Solução\n\nTexto novo.\n");
});

// ---- Type, Stack, Priority and Effort (S3), with the labels they imply and the native type

test("a field the issue leaves empty is a gap: RoadS fills it with its own value, even on the first sync", () => {
  assert.equal(decideField({ roads: "High", base: null, github: "", roadsAt: null, githubAt: null, fillGap: true }), "push");
  assert.equal(decideField({ roads: "High", base: "Low", github: "", roadsAt: null, githubAt: null, fillGap: true }), "push");
  // Without the gap rule (Title, Description), an empty GitHub value is a value like any other.
  assert.equal(decideField({ roads: "Texto", base: null, github: "", roadsAt: null, githubAt: null }), "pull");
  // A RoadS without a value takes the issue's, as on any first sync.
  assert.equal(decideField({ roads: "", base: null, github: "Backend", roadsAt: null, githubAt: null, fillGap: true }), "pull");
});

test("the Type is the issue's type: label; type:epic and unknown types are not one", () => {
  assert.equal(tipoOfLabels(["area:backend", "type:bug"]), "bug");
  assert.equal(tipoOfLabels(["type:epic", "type:spike"]), "spike");
  assert.equal(tipoOfLabels(["type:epic", "priority:high"]), null);
});

test("the native type follows the Type: a bug is a Bug, a feature a Feature, the rest a Task", () => {
  assert.equal(nativeTypeOf("bug"), "Bug");
  assert.equal(nativeTypeOf("feature"), "Feature");
  assert.equal(nativeTypeOf("chore"), "Task");
  assert.equal(nativeTypeOf("spike"), "Task");
});

test("a Type, Stack or Priority that changed swaps the labels of its family, and leaves every other label alone", () => {
  const labels = ["type:feature", "area:frontend", "priority:high", "type:epic", "needs-decision"];
  assert.deepEqual(labelsAfter(labels, { tipo: "bug", stack: "Backend", prioridade: "Low" }, new Set(["tipo", "stack", "prioridade"])), [
    "type:epic",
    "needs-decision",
    "type:bug",
    "area:backend",
  ]);
  assert.deepEqual(labelsAfter(["area:backend"], { tipo: "feature", stack: "Frontend/Backend", prioridade: "Medium" }, new Set(["stack"])), [
    "type:feature",
    "area:frontend",
    "area:backend",
  ]);
});

test("a field that did not change only fills the labels it implies and never removes one someone put there", () => {
  assert.deepEqual(labelsAfter(["area:frontend"], { tipo: "chore", stack: "Backend", prioridade: "Critical" }, new Set()), [
    "area:frontend",
    "type:chore",
    "area:backend",
    "priority:high",
  ]);
  // A type label already there is the issue's type: no second one is added.
  assert.deepEqual(labelsAfter(["type:bug"], { tipo: "feature", stack: null, prioridade: null }, new Set()), ["type:bug"]);
});
