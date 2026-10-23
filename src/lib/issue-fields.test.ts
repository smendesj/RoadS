import { test } from "node:test";
import assert from "node:assert/strict";
import { isStack, isTipo, issueLabels, PRIORIDADE_OPTION_IDS, PRIORIDADES, prioridadeOfOption, stackOfOption, STACK_OPTION_IDS, STACKS } from "./issue-fields.ts";

test("an issue gets its type, the area its stack implies and priority:high when it is", () => {
  assert.deepEqual(issueLabels("bug", "Frontend/Backend", "High"), ["type:bug", "area:frontend", "area:backend", "priority:high"]);
  assert.deepEqual(issueLabels("feature", "Database", "Medium"), ["type:feature", "area:backend"]);
  assert.deepEqual(issueLabels("spike", "General", "Low"), ["type:spike"]);
  assert.deepEqual(issueLabels("chore", "Backend Tests", "Low"), ["type:chore", "area:backend"]);
  assert.deepEqual(issueLabels("chore", "Frontend Tests", "Low"), ["type:chore", "area:frontend"]);
});

test("only known types and stacks are accepted", () => {
  assert.equal(isTipo("bug"), true);
  assert.equal(isTipo("epic"), false);
  assert.equal(isStack("Backend/IA"), true);
  assert.equal(isStack("toString"), false);
  assert.equal(isStack(undefined), false);
});

test("the Stacks are named in English, each still on the board's option id it always had", () => {
  assert.deepEqual(STACKS, [
    "Modeling",
    "Backend",
    "Database",
    "Frontend",
    "General",
    "General Tests",
    "Frontend Tests",
    "Backend Tests",
    "Documentation",
    "Frontend/Backend",
    "Backend/IA",
    "Tests",
    "Security Tests",
    "Infra",
    "Mobile",
  ]);
  assert.equal(STACK_OPTION_IDS.General, "13d92ab6");
  assert.equal(isStack("Geral"), false);
});

test("a board option reads back as the Stack or Priority it is, and an option RoadS does not offer as nothing", () => {
  assert.equal(stackOfOption("8c95d28a"), "Database");
  assert.equal(stackOfOption("opcao-desconhecida"), null);
  assert.equal(prioridadeOfOption("3b456fae"), "High");
  assert.equal(prioridadeOfOption(undefined), null);
});

// Issue #38: the Priority has only High, Medium and Low. The board may still hold its Critical option for a while (taking
// it off the shared board is a separate question), so a card that still says Critical reads as High, and RoadS never
// writes Critical back: it has no option id for it.
test("the Priority is High, Medium or Low, and a card still on the board's Critical option reads as High", () => {
  assert.deepEqual(PRIORIDADES, ["High", "Medium", "Low"]);
  assert.deepEqual(Object.keys(PRIORIDADE_OPTION_IDS), ["High", "Medium", "Low"]);
  assert.equal(prioridadeOfOption("313dc1cb"), "High");
  assert.equal(prioridadeOfOption("6acd6fa8"), "Medium");
  assert.equal(prioridadeOfOption("77fe47cd"), "Low");
  assert.equal(prioridadeOfOption("opcao-desconhecida"), null);
});
