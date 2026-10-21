import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideField,
  deletionComment,
  effortSides,
  extractSolucao,
  labelsAfter,
  mayPush,
  nativeTypeOf,
  replaceSolucao,
  selectorStatus,
  statusOfIssue,
  closedIssueStatus,
  statusWrites,
  storedStatus,
  tipoOfLabels,
  weekOfIssue,
  weekOfLane,
  weekPull,
  sameBase,
} from "./bilateral-sync.ts";

test("a base with the same fields and values is the same, whatever their order, so the item is not written again", () => {
  assert.equal(sameBase({ title: "T", stack: "Backend" }, { stack: "Backend", title: "T" }), true);
  assert.equal(sameBase({ title: "T" }, { title: "T", stack: "Backend" }), false);
  assert.equal(sameBase({ title: "T" }, { title: "U" }), false);
  assert.equal(sameBase({}, {}), true);
});

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

test("a field the issue leaves empty is a gap: RoadS fills it with a value someone edited in RoadS, even on the first sync", () => {
  assert.equal(decideField({ roads: "High", base: null, github: "", roadsAt: "2026-10-21T10:00:00Z", githubAt: null, fillGap: true }), "push");
  assert.equal(decideField({ roads: "High", base: "Low", github: "", roadsAt: "2026-10-21T10:00:00Z", githubAt: null, fillGap: true }), "push");
});

test("a gap is never filled with a value nobody chose in RoadS (a default): it waits for someone to edit the field", () => {
  assert.equal(decideField({ roads: "Medium", base: null, github: "", roadsAt: null, githubAt: null, fillGap: true }), "none");
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

// ---- Status (S4): Open, Blocker, Done; Development is being in the current sprint (the sprint sync's rule of 06/10)

test("the issue's Status is Done when it is closed or its card says Done, Blocker when the card says so, else Open", () => {
  assert.equal(statusOfIssue({ closed: true, card: "Development" }), "Done");
  assert.equal(statusOfIssue({ closed: false, card: "Done" }), "Done");
  assert.equal(statusOfIssue({ closed: false, card: "Blocker" }), "Blocker");
  assert.equal(statusOfIssue({ closed: false, card: "Development" }), "Open");
  assert.equal(statusOfIssue({ closed: false, card: null }), "Open");
});

test("Done pushed closes the issue as completed and puts its card in Done", () => {
  assert.deepEqual(statusWrites("Done", "Open", false), { issue: { state: "closed", state_reason: "completed" }, card: "Done" });
  assert.deepEqual(statusWrites("Done", "Blocker", true), { issue: { state: "closed", state_reason: "completed" }, card: "Done" });
});

test("leaving Done reopens the issue, and the card goes to Development in the current sprint, Open outside it", () => {
  assert.deepEqual(statusWrites("Open", "Done", false), { issue: { state: "open", state_reason: "reopened" }, card: "Open" });
  assert.deepEqual(statusWrites("Open", "Done", true), { issue: { state: "open", state_reason: "reopened" }, card: "Development" });
  assert.deepEqual(statusWrites("Blocker", "Done", false), { issue: { state: "open", state_reason: "reopened" }, card: "Blocker" });
});

test("Blocker and back only move the card; the issue stays open", () => {
  assert.deepEqual(statusWrites("Blocker", "Open", true), { issue: null, card: "Blocker" });
  assert.deepEqual(statusWrites("Open", "Blocker", true), { issue: null, card: "Development" });
  assert.deepEqual(statusWrites("Open", "Blocker", false), { issue: null, card: "Open" });
});

test("the selector shows Done and Blocker as stored, and an open item as Development in the current sprint, else Open", () => {
  assert.equal(selectorStatus("Done", true), "Done");
  assert.equal(selectorStatus("Blocker", false), "Blocker");
  assert.equal(selectorStatus("Open", true), "Development");
  assert.equal(selectorStatus("Open", false), "Open");
});

test("choosing Development or Open stores Open and moves the item into or out of the current sprint; Blocker and Done stay put", () => {
  assert.deepEqual(storedStatus("Development", false), { status: "Open", move: "into_sprint" });
  assert.deepEqual(storedStatus("Development", true), { status: "Open", move: null });
  assert.deepEqual(storedStatus("Open", true), { status: "Open", move: "out_of_sprint" });
  assert.deepEqual(storedStatus("Open", false), { status: "Open", move: null });
  assert.deepEqual(storedStatus("Blocker", true), { status: "Blocker", move: null });
  assert.deepEqual(storedStatus("Done", false), { status: "Done", move: null });
});

test("the Comment of a Delete names who deleted the item by the profile's GitHub login", () => {
  assert.equal(deletionComment("admin", "ana-y"), "Deleted in RoadS by @ana-y: this issue was closed as not planned.");
  assert.equal(deletionComment("scrum_master", "bia-z"), "Deleted in RoadS by @bia-z: this issue was closed as not planned.");
});

test("a profile with no GitHub login is named by its role in the Comment of a Delete", () => {
  assert.equal(deletionComment("admin", null), "Deleted in RoadS by an admin: this issue was closed as not planned.");
  assert.equal(deletionComment("scrum_master", null), "Deleted in RoadS by a scrum master: this issue was closed as not planned.");
});

// ---- Week (S5): the Monday of the item's week, the board's date field Week

test("an item's Week is the Monday of its week lane, and nothing when it sits in a block", () => {
  assert.equal(weekOfLane({ kind: "sprint", start_date: "2026-10-19" }), "2026-10-19");
  assert.equal(weekOfLane({ kind: "group", start_date: null }), "");
  assert.equal(weekOfLane(undefined), "");
});

test("the issue's Week reads as the Monday of the date on the card, a weekend as the next Monday, an empty one as nothing", () => {
  assert.equal(weekOfIssue("2026-10-22"), "2026-10-19");
  assert.equal(weekOfIssue("2026-10-19"), "2026-10-19");
  assert.equal(weekOfIssue("2026-10-25"), "2026-10-26");
  assert.equal(weekOfIssue(null), "");
});

test("a Week brought from GitHub moves the item into that week, an empty one back to its block, and a week gone by nowhere", () => {
  assert.deepEqual(weekPull("2026-10-26", "2026-10-21"), { to: "week", monday: "2026-10-26" });
  assert.deepEqual(weekPull("2026-10-19", "2026-10-21"), { to: "week", monday: "2026-10-19" });
  assert.deepEqual(weekPull("", "2026-10-21"), { to: "block" });
  assert.equal(weekPull("2026-10-12", "2026-10-21"), null);
});

// ---- P2: an issue closed outside RoadS, which the open issues read by the sync don't carry

test("an issue closed on GitHub makes its item Done, whether the base was Open or never read", () => {
  assert.equal(closedIssueStatus({ roads: "Open", base: "Open", roadsAt: null }), "pull");
  assert.equal(closedIssueStatus({ roads: "Blocker", base: "Blocker", roadsAt: null }), "pull");
  assert.equal(closedIssueStatus({ roads: "Open", base: null, roadsAt: null }), "pull");
});

test("an item taken out of Done in RoadS reopens its closed issue, and a Done item has nothing to do", () => {
  assert.equal(closedIssueStatus({ roads: "Open", base: "Done", roadsAt: "2026-10-21T10:00:00Z" }), "push");
  assert.equal(closedIssueStatus({ roads: "Done", base: "Open", roadsAt: null }), "none");
});

// ---- Effort (P1): the organization's issue field, whose change time GitHub doesn't tell

test("Effort's GitHub side is the issue's field: an empty one is a gap, and its time of change is unknown", () => {
  assert.deepEqual(effortSides("High", { effort: "Low" }), { roads: "High", github: "Low", githubAt: null });
  assert.deepEqual(effortSides("High", { effort: null }), { roads: "High", github: "", githubAt: null });
});

test("an Effort the sync couldn't read is no side at all: it waits for the next sync instead of reading as a difference", () => {
  assert.equal(effortSides("High", undefined), null);
});

test("an empty Effort on the issue is filled only with an Effort edited in RoadS, and with both moved the issue wins", () => {
  const gap = effortSides("Medium", { effort: null })!;
  assert.equal(decideField({ ...gap, base: null, roadsAt: "2026-10-21T10:00:00Z", fillGap: true }), "push");
  assert.equal(decideField({ ...gap, base: null, roadsAt: null, fillGap: true }), "none");
  const both = effortSides("High", { effort: "Low" })!;
  assert.equal(decideField({ ...both, base: "Medium", roadsAt: "2026-10-21T10:00:00Z", fillGap: true }), "pull");
  assert.equal(decideField({ ...effortSides("High", { effort: "Medium" })!, base: "Medium", roadsAt: "2026-10-21T10:00:00Z", fillGap: true }), "push");
});
