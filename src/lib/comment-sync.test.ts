import { test } from "node:test";
import assert from "node:assert/strict";

import { planComments, signComment, type NoteSide } from "./comment-sync.ts";

const note = (over: Partial<NoteSide> = {}): NoteSide => ({
  id: "n1",
  body: "Texto",
  githubId: 501,
  deleted: false,
  authorName: "Pessoa Teste",
  ...over,
});

test("a comment written in RoadS goes up with its text, then the name of who wrote it", () => {
  assert.equal(signComment("Pessoa Teste", "  Uma linha.\nOutra. "), "Uma linha.\nOutra.\n\n— Pessoa Teste (RoadS)");
});

test("a comment written on GitHub that RoadS does not know produces no action: the rule never even sees GitHub's comments", () => {
  // Comments only go up (issue #34): the rule is given RoadS's Comments alone, so nothing on GitHub can come down.
  assert.equal(planComments.length, 1);
  assert.deepEqual(planComments([]), []);
});

test("a Comment never sent is created on the issue once, signed with its author's name", () => {
  assert.deepEqual(planComments([note({ githubId: null })]), [
    { kind: "create", noteId: "n1", body: signComment("Pessoa Teste", "Texto"), text: "Texto" },
  ]);
  assert.deepEqual(planComments([note({ githubId: null, authorName: null })]), [
    { kind: "create", noteId: "n1", body: signComment("RoadS", "Texto"), text: "Texto" },
  ]);
});

test("a Comment already sent produces nothing, however either side edits it", () => {
  // Edited in RoadS after it went up, or edited on GitHub (which the rule does not read): no update, no pull.
  assert.deepEqual(planComments([note({ body: "Texto novo" })]), []);
  assert.deepEqual(planComments([note()]), []);
});

test("a Comment deleted before it was sent is just forgotten; one deleted after it went up deletes nothing on GitHub", () => {
  assert.deepEqual(planComments([note({ deleted: true, githubId: null })]), [{ kind: "forget", noteId: "n1" }]);
  assert.deepEqual(planComments([note({ deleted: true })]), []);
});
