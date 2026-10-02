import { test } from "node:test";
import assert from "node:assert/strict";
import { isStack, isTipo, issueLabels } from "./issue-fields.ts";

test("an issue gets its type, the area its stack implies and priority:high when it is", () => {
  assert.deepEqual(issueLabels("bug", "Frontend/Backend", "High"), ["type:bug", "area:frontend", "area:backend", "priority:high"]);
  assert.deepEqual(issueLabels("feature", "Banco de dados", "Medium"), ["type:feature", "area:backend"]);
  assert.deepEqual(issueLabels("spike", "Geral", "Low"), ["type:spike"]);
  assert.deepEqual(issueLabels("chore", "Infra", "Critical"), ["type:chore", "priority:high"]);
});

test("only known types and stacks are accepted", () => {
  assert.equal(isTipo("bug"), true);
  assert.equal(isTipo("epic"), false);
  assert.equal(isStack("Backend/IA"), true);
  assert.equal(isStack("toString"), false);
  assert.equal(isStack(undefined), false);
});
