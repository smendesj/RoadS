import { test } from "node:test";
import assert from "node:assert/strict";

import { assigneeKey, assigneeNames, decideAssignees, parseLogin } from "./assignee-sync.ts";

const at = (h: number) => `2026-10-21T${String(h).padStart(2, "0")}:00:00Z`;

test("the assignees are compared as one value, whatever their order or case", () => {
  assert.equal(assigneeKey(["Bruna-X", "ana-y"]), "ana-y,bruna-x");
  assert.equal(assigneeKey([]), "");
});

test("assignees changed only in RoadS go to the issue; changed only on GitHub, they come to RoadS", () => {
  assert.equal(decideAssignees({ roads: ["ana"], base: "", github: [], roadsAt: at(10), githubAt: null }), "push");
  assert.equal(decideAssignees({ roads: [], base: "", github: ["ana"], roadsAt: null, githubAt: at(10) }), "pull");
  assert.equal(decideAssignees({ roads: ["ana"], base: "ana", github: ["ana"], roadsAt: null, githubAt: null }), "none");
});

test("on the first sync, what someone set in RoadS goes to an issue with nobody assigned; otherwise RoadS copies GitHub", () => {
  assert.equal(decideAssignees({ roads: ["ana"], base: null, github: [], roadsAt: at(10), githubAt: null }), "push");
  assert.equal(decideAssignees({ roads: [], base: null, github: ["ana"], roadsAt: null, githubAt: null }), "pull");
  assert.equal(decideAssignees({ roads: ["ana"], base: null, github: ["bia"], roadsAt: at(10), githubAt: null }), "pull");
});

test("when both sides changed the assignees, the last one to change wins", () => {
  const both = (roadsAt: string, githubAt: string) => decideAssignees({ roads: ["ana"], base: "caio", github: ["bia"], roadsAt, githubAt });
  assert.equal(both(at(11), at(10)), "push");
  assert.equal(both(at(10), at(11)), "pull");
});

test("each assignee shows as its profile's name, and a login with no profile as the login", () => {
  assert.deepEqual(assigneeNames(["ana-y", "fora"], new Map([["ana-y", "Ana Teste"]])), ["Ana Teste", "fora"]);
});

test("a GitHub login is kept as GitHub writes it: letters, digits and single hyphens, up to 39 characters", () => {
  assert.equal(parseLogin(" @Ana-Teste "), "ana-teste");
  assert.equal(parseLogin(""), null);
  for (const bad of ["-ana", "ana-", "an--a", "ana teste", "a".repeat(40), "ana/x"]) assert.equal(parseLogin(bad), undefined, bad);
});
