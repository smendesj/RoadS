import { test } from "node:test";
import assert from "node:assert/strict";

import { planComments, signComment, unsignComment, type GitHubComment, type NoteSide } from "./comment-sync.ts";

const at = (h: number) => `2026-10-21T${String(h).padStart(2, "0")}:00:00Z`;

const note = (over: Partial<NoteSide> = {}): NoteSide => ({
  id: "n1",
  body: "Texto",
  base: "Texto",
  githubId: 501,
  deleted: false,
  updatedAt: null,
  authorName: "Pessoa Teste",
  ...over,
});
const comment = (over: Partial<GitHubComment> = {}): GitHubComment => ({
  id: 501,
  body: signComment("Pessoa Teste", "Texto"),
  updatedAt: at(9),
  login: "conta-teste",
  bot: false,
  ...over,
});

test("a comment written in RoadS carries its author's name, and the name is taken off when it comes back", () => {
  const signed = signComment("Pessoa Teste", "Uma linha.\nOutra.");
  assert.match(signed, /Pessoa Teste/);
  assert.equal(unsignComment(signed), "Uma linha.\nOutra.");
  assert.equal(unsignComment("Escrito no GitHub."), "Escrito no GitHub.");
});

test("a new Comment in RoadS is created on the issue, signed", () => {
  assert.deepEqual(planComments([note({ githubId: null, base: null })], []), [
    { kind: "create", noteId: "n1", body: signComment("Pessoa Teste", "Texto"), text: "Texto" },
  ]);
});

test("a Comment edited only in RoadS edits the comment on the issue", () => {
  assert.deepEqual(planComments([note({ body: "Texto novo", updatedAt: at(10) })], [comment()]), [
    { kind: "update", noteId: "n1", commentId: 501, body: signComment("Pessoa Teste", "Texto novo"), text: "Texto novo" },
  ]);
});

test("a comment edited only on GitHub changes the Comment in RoadS", () => {
  assert.deepEqual(planComments([note()], [comment({ body: signComment("Pessoa Teste", "Mudado lá"), updatedAt: at(10) })]), [
    { kind: "pull", noteId: "n1", text: "Mudado lá" },
  ]);
});

test("when both sides edited the same comment, the last one to edit wins", () => {
  const both = (roadsAt: string, githubAt: string) =>
    planComments([note({ body: "Daqui", updatedAt: roadsAt })], [comment({ body: "De lá", updatedAt: githubAt })]);
  assert.equal(both(at(11), at(10))[0].kind, "update");
  assert.equal(both(at(10), at(11))[0].kind, "pull");
});

test("a Comment deleted in RoadS deletes the comment on the issue; one never sent is just forgotten", () => {
  assert.deepEqual(planComments([note({ deleted: true })], [comment()]), [{ kind: "delete", noteId: "n1", commentId: 501 }]);
  assert.deepEqual(planComments([note({ deleted: true, githubId: null, base: null })], []), [{ kind: "forget", noteId: "n1" }]);
});

test("a comment deleted on GitHub takes its Comment out of RoadS", () => {
  assert.deepEqual(planComments([note()], []), [{ kind: "forget", noteId: "n1" }]);
});

test("a comment written on GitHub becomes a Comment in RoadS, with the GitHub login as its author", () => {
  assert.deepEqual(planComments([], [comment({ id: 777, body: "Comentário de lá", login: "alguem-de-fora", updatedAt: at(8) })]), [
    { kind: "import", commentId: 777, text: "Comentário de lá", login: "alguem-de-fora", at: at(8) },
  ]);
});

test("a comment RoadS itself created never comes back as a new Comment, and bots stay out", () => {
  assert.deepEqual(planComments([note()], [comment()]), []);
  assert.deepEqual(planComments([], [comment({ id: 778, bot: true })]), []);
});

test("an unchanged comment needs nothing, and a known text equal on both sides only refreshes the base", () => {
  assert.deepEqual(planComments([note()], [comment()]), []);
  assert.deepEqual(planComments([note({ body: "Igual", base: "Velho" })], [comment({ body: signComment("Pessoa Teste", "Igual") })]), [
    { kind: "seen", noteId: "n1", text: "Igual" },
  ]);
});
