import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFacts, parseHideList, windowFromDates } from "./gh-facts.ts";
import type { FactsInput, GhIssue, GhPr, GhProjectItem, GhTimeline } from "./gh-facts.ts";

// Synthetic data only (made-up issues, titles and instants). The window is 09/03 and 10/03 in São Paulo.
const REPO = "acme/app";
const WINDOW = { start: "2026-03-09T00:00:00-03:00", end: "2026-03-11T00:00:00-03:00" };

const issue = (number: number, over: Partial<GhIssue> = {}): GhIssue => ({
  number,
  title: `Funcionalidade ${number}`,
  url: `https://github.com/${REPO}/issues/${number}`,
  state: "open",
  stateReason: null,
  createdAt: "2026-03-09T09:00:00-03:00",
  closedAt: null,
  labels: [],
  author: "dev-a",
  assignees: ["dev-a"],
  body: "",
  parent: null,
  subIssues: null,
  ...over,
});

const pr = (number: number, over: Partial<GhPr> = {}): GhPr => ({
  number,
  title: `Entrega (#${number - 1000})`,
  url: `https://github.com/${REPO}/pull/${number}`,
  state: "merged",
  draft: false,
  base: "main",
  createdAt: "2026-03-09T10:00:00-03:00",
  closedAt: "2026-03-09T11:00:00-03:00",
  mergedAt: "2026-03-09T11:00:00-03:00",
  firstCommitAt: "2026-03-09T09:30:00-03:00",
  author: "dev-a",
  closing: [],
  commits: [],
  mergeCommit: null,
  ...over,
});

const board = (number: number, status: string | null, over: Partial<GhProjectItem> = {}): GhProjectItem => ({
  repository: REPO,
  number,
  kind: "Issue",
  status,
  statusUpdatedAt: "2026-03-08T10:00:00-03:00",
  ...over,
});

const facts = (over: Partial<FactsInput> = {}) =>
  buildFacts({
    repository: REPO,
    window: WINDOW,
    generatedAt: "2026-03-11T12:00:00-03:00",
    issues: [],
    prs: [],
    timelines: [],
    projectItems: [],
    ...over,
  });

const timeline = (n: number, over: Partial<GhTimeline> = {}): GhTimeline => ({ issue: n, commits: [], closers: [], statusHistory: [], ...over });

test("the window is built from São Paulo dates, with the last day included", () => {
  assert.deepEqual(windowFromDates("2026-03-09", "2026-03-10"), {
    ok: true,
    window: { start: "2026-03-09T00:00:00-03:00", end: "2026-03-11T00:00:00-03:00" },
  });
  assert.deepEqual(windowFromDates("2026-03-31", "2026-03-31"), {
    ok: true,
    window: { start: "2026-03-31T00:00:00-03:00", end: "2026-04-01T00:00:00-03:00" },
  });
  for (const [from, to] of [["09/03/2026", "2026-03-10"], ["2026-02-30", "2026-03-10"], ["2026-03-10", "2026-03-09"], ["", ""]]) {
    const r = windowFromDates(from, to);
    assert.equal(r.ok, false);
  }
});

test("a sub-issue is rolled up into its parent and never becomes an entry of its own", () => {
  const out = facts({
    issues: [
      issue(100, { subIssues: { total: 3, completed: 1 } }),
      issue(101, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-09T12:00:00-03:00" }),
      issue(102, { parent: 100 }),
      issue(103, { parent: 100 }),
    ],
    prs: [pr(1101, { title: "Passo concluído (#101)" })],
    projectItems: [board(100, "Open"), board(101, "Done")],
  });
  assert.deepEqual(out.entries.map((e) => e.id), ["gc-100"]);
  assert.deepEqual(out.entries[0].subIssues, { total: 3, done: 1 });
  assert.equal(out.entries[0].status, "em_andamento"); // 1 of 3 steps: the parent is not under validation
  assert.equal(out.ignored.children, 3);
  assert.equal(out.ignored.cut, 0);
});

/* ---------- The whole tree of sub-issues ---------- */

const closedIn = (at: string): Partial<GhIssue> => ({ state: "closed", stateReason: "completed", closedAt: at });
const OLD = "2026-02-20T09:00:00-03:00"; // before the window opened
const c = (oid: string, at: string, author = "dev-a") => ({ oid, at, author });

test("the parts of an umbrella are the leaves of its whole tree, at any depth", () => {
  // 100 has a step with two parts (103 done, 104 open), a part of its own (102, open), and a cancelled one.
  const out = facts({
    issues: [
      issue(100),
      issue(101, { parent: 100 }),
      issue(102, { parent: 100 }),
      issue(103, { parent: 101, ...closedIn("2026-03-09T12:00:00-03:00") }),
      issue(104, { parent: 101 }),
      issue(105, { parent: 101, state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T12:00:00-03:00" }),
    ],
    projectItems: [board(100, "Open")],
  });
  assert.deepEqual(out.entries.map((e) => e.issue), [100]);
  assert.deepEqual(out.entries[0].subIssues, { total: 3, done: 1 }); // 101 counts through 103 and 104, not as a part itself
  assert.equal(out.ignored.children, 5);
});

test("an umbrella with no sub-issues at all has no parts, and no slices either", () => {
  const out = facts({ issues: [issue(110)], timelines: [timeline(110, { commits: [c("aaaa111", "2026-03-09T10:00:00-03:00")] })], projectItems: [board(110, "Open")] });
  assert.equal(out.entries[0].subIssues, null);
  assert.equal("slices" in out.entries[0], false);
});

test("a pull request that cites only a grandchild is the umbrella's work and its delivery", () => {
  const out = facts({
    issues: [issue(120), issue(121, { parent: 120 }), issue(122, { parent: 121, ...closedIn("2026-03-09T12:00:00-03:00") })],
    prs: [pr(1122, { title: "Parte (#122)" })],
    projectItems: [board(120, "Open")],
  });
  const [entry] = out.entries;
  assert.equal(entry.status, "em_validacao"); // its only part is done and merged, the umbrella awaits confirmation
  assert.equal(entry.deliveredAt, "2026-03-09T11:00:00-03:00");
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/pull/1122`));
  assert.ok(entry.evidence.some((l) => l.includes("#1122")));
});

test("a PR that only polishes a part already delivered does not move the umbrella's delivery, at any depth", () => {
  const out = facts({
    issues: [issue(130, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T18:00:00-03:00" }), issue(131, { parent: 130 }), issue(132, { parent: 131, ...closedIn("2026-03-09T12:00:00-03:00") }), issue(133, { parent: 131, ...closedIn("2026-03-10T12:00:00-03:00") })],
    prs: [
      pr(1132, { title: "Parte 1 (#132)", mergedAt: "2026-03-09T11:00:00-03:00" }),
      pr(1134, { title: "Teste da parte 1 (#132)", createdAt: "2026-03-09T12:10:00-03:00", mergedAt: "2026-03-09T12:30:00-03:00" }),
      pr(1133, { title: "Parte 2 (#133)", mergedAt: "2026-03-10T11:30:00-03:00" }),
    ],
    timelines: [timeline(132, { closers: [1132] })],
    projectItems: [board(130, "Done")],
  });
  assert.equal(out.entries[0].status, "concluido");
  assert.equal(out.entries[0].deliveredAt, "2026-03-10T11:30:00-03:00");
});

test("a commit that cites a grandchild makes a quiet umbrella part of the window, under way", () => {
  const family = [issue(140, { createdAt: OLD }), issue(141, { parent: 140, createdAt: OLD }), issue(142, { parent: 141, createdAt: OLD })];
  const quiet = facts({ issues: family, projectItems: [board(140, "Open")] });
  assert.deepEqual(quiet.entries, []);
  assert.equal(quiet.ignored.quiet, 1);

  const worked = facts({ issues: family, timelines: [timeline(142, { commits: [c("aaaa111", "2026-03-09T10:00:00-03:00")] })], projectItems: [board(140, "Open")] });
  assert.deepEqual(worked.entries.map((e) => [e.issue, e.status]), [[140, "em_andamento"]]);
  assert.equal(worked.ignored.quiet, 0);
});

test("one commit that cites the umbrella and its part is counted once", () => {
  const out = facts({
    issues: [issue(145), issue(146, { parent: 145 })],
    timelines: [timeline(145, { commits: [c("aaaa111", "2026-03-09T10:00:00-03:00")] }), timeline(146, { commits: [c("aaaa111", "2026-03-09T10:00:00-03:00")] })],
    projectItems: [board(145, "Open")],
  });
  assert.ok(out.entries[0].evidence.some((l) => /^1 commit citando/.test(l)), out.entries[0].evidence.join("|"));
});

test("a part closed in the window makes a quiet umbrella part of it, with no PR and never as proximo; creating parts does not", () => {
  const closed = facts({
    issues: [issue(150, { createdAt: OLD }), issue(151, { parent: 150, createdAt: OLD, ...closedIn("2026-03-09T15:00:00-03:00") }), issue(152, { parent: 150, createdAt: OLD })],
    projectItems: [board(150, "Open")],
  });
  assert.deepEqual(closed.entries.map((e) => [e.issue, e.status, e.subIssues]), [[150, "em_andamento", { total: 2, done: 1 }]]);

  const planned = facts({
    issues: [issue(155, { createdAt: OLD }), issue(156, { parent: 155, createdAt: "2026-03-09T10:00:00-03:00" })],
    projectItems: [board(155, "Open")],
  });
  assert.deepEqual(planned.entries, []);
  assert.equal(planned.ignored.quiet, 1);
});

test("a part cancelled in the window is housekeeping, not activity of the umbrella", () => {
  const out = facts({
    issues: [issue(158, { createdAt: OLD }), issue(159, { parent: 158, createdAt: OLD, state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T15:00:00-03:00" })],
    projectItems: [board(158, "Open")],
  });
  assert.deepEqual(out.entries, []);
});

test("an umbrella with parts closed before the window and nothing since is under way, not proximo", () => {
  const out = facts({
    issues: [
      issue(160, { createdAt: OLD }),
      ...[161, 162, 163].map((n) => issue(n, { parent: 160, createdAt: OLD, ...closedIn("2026-03-02T15:00:00-03:00") })),
      ...[164, 165].map((n) => issue(n, { parent: 160, createdAt: OLD })),
    ],
    timelines: [timeline(165, { commits: [c("bbbb222", "2026-03-09T10:00:00-03:00")] })],
    projectItems: [board(160, "Open")],
  });
  const [entry] = out.entries;
  assert.equal(entry.status, "em_andamento");
  assert.deepEqual(entry.subIssues, { total: 5, done: 3 });
  assert.deepEqual(entry.slices, { closed: [], blocked: [] }); // none was closed inside the window
});

test("slices list the parts closed inside the window, at any depth and in closing order, and the parts that are blocked", () => {
  const out = facts({
    issues: [
      issue(300),
      issue(301, { parent: 300, ...closedIn("2026-03-09T15:00:00-03:00") }),
      issue(302, { parent: 301, ...closedIn("2026-03-09T12:00:00-03:00") }),
      issue(303, { parent: 300, state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T13:00:00-03:00" }),
      issue(304, { parent: 300, ...closedIn("2026-03-05T12:00:00-03:00") }), // before the window
      issue(305, { parent: 300, labels: ["Status:Blocker"] }),
      issue(306, { parent: 300 }), // blocked on the board
      issue(307, { parent: 300, ...closedIn("2026-03-12T12:00:00-03:00") }), // after the window
      issue(308, { parent: 300, labels: ["status:blocker"], ...closedIn("2026-03-10T12:00:00-03:00") }), // blocked once, closed now
      issue(309, { parent: 300, labels: ["type:feature"] }),
      issue(399, { parent: 300, labels: ["blocker", "needs-decision"] }), // a bare "blocker" can mean a release blocker: not the same thing
    ],
    projectItems: [board(300, "Open"), board(306, "Blocker")],
  });
  assert.deepEqual(out.entries[0].slices, {
    closed: [
      { title: "Funcionalidade 302", closedAt: "2026-03-09T12:00:00-03:00" },
      { title: "Funcionalidade 301", closedAt: "2026-03-09T15:00:00-03:00" },
      { title: "Funcionalidade 308", closedAt: "2026-03-10T12:00:00-03:00" },
    ],
    blocked: [{ title: "Funcionalidade 305" }, { title: "Funcionalidade 306" }],
  });
  // The parts tell the progress; the status is still the collector's, from the umbrella's own card.
  assert.equal(out.entries[0].status, "em_andamento");
});

test("a part's Blocker card counts as blocked as of the end of the window", () => {
  const out = facts({
    issues: [issue(310), issue(311, { parent: 310 })],
    timelines: [timeline(311, { commits: [c("cccc333", "2026-03-09T10:00:00-03:00")], statusHistory: [{ at: "2026-03-12T10:00:00-03:00", to: "Done" }, { at: "2026-03-08T10:00:00-03:00", to: "Blocker" }] })],
    projectItems: [board(310, "Open"), board(311, "Done", { statusUpdatedAt: "2026-03-12T10:00:00-03:00" })],
  });
  assert.deepEqual(out.entries[0].slices?.blocked, [{ title: "Funcionalidade 311" }]);
});

test("slices are evidence for whoever writes: the facts carry them, and the entry stays one JSON object of plain values", () => {
  const out = facts({ issues: [issue(320), issue(321, { parent: 320, ...closedIn("2026-03-09T12:00:00-03:00") })], projectItems: [board(320, "Open")] });
  assert.deepEqual(JSON.parse(JSON.stringify(out.entries[0].slices)), { closed: [{ title: "Funcionalidade 321", closedAt: "2026-03-09T12:00:00-03:00" }], blocked: [] });
});

test("an umbrella planned in one go is not internal once its parts have a PR", () => {
  const planning = Array.from({ length: 4 }, (_, k) => issue(520 + k, { assignees: [], createdAt: `2026-03-09T09:0${k}:00-03:00` }));
  const out = facts({
    issues: [issue(500, { assignees: [], createdAt: "2026-03-09T09:00:00-03:00" }), issue(501, { parent: 500, assignees: [], createdAt: "2026-03-09T09:01:00-03:00" }), ...planning],
    prs: [pr(1501, { title: "Parte (#501)" })],
    projectItems: [],
  });
  assert.deepEqual(out.entries.map((e) => e.issue), [500]);
  assert.deepEqual(out.internal.items.map((i) => i.ref), ["#520", "#521", "#522", "#523"]);
});

test("a tree read only in part is said so: the entry carries a line, `ignored` counts it, and the parts GitHub counts stand in", () => {
  // 400 says it has 3 sub-issues but only 401 was read; 410 says it has 4 and none was read.
  const out = facts({
    issues: [
      issue(400, { subIssues: { total: 3, completed: 1 } }),
      issue(401, { parent: 400, ...closedIn("2026-03-09T12:00:00-03:00") }),
      issue(410, { subIssues: { total: 4, completed: 1 } }),
    ],
    timelines: [timeline(410, { commits: [c("dddd444", "2026-03-09T10:00:00-03:00")] })],
    projectItems: [board(400, "Open"), board(410, "Open")],
  });
  assert.equal(out.ignored.cut, 2);
  const [partial, none] = out.entries;
  assert.deepEqual(partial.subIssues, { total: 1, done: 1 });
  assert.deepEqual(none.subIssues, { total: 4, done: 1 });
  for (const e of [partial, none]) assert.ok(e.evidence.some((l) => /cortad/i.test(l)), e.evidence.join("|"));
  const whole = facts({ issues: [issue(420, { subIssues: { total: 1, completed: 0 } }), issue(421, { parent: 420 })], timelines: [timeline(421, { commits: [c("eeee555", "2026-03-09T10:00:00-03:00")] })], projectItems: [board(420, "Open")] });
  assert.equal(whole.ignored.cut, 0);
  assert.ok(!whole.entries[0].evidence.some((l) => /cortad/i.test(l)));
});

test("an umbrella issue with every step merged takes the last merge as its delivery", () => {
  const out = facts({
    issues: [
      issue(100, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T18:00:00-03:00", subIssues: { total: 2, completed: 2 } }),
      issue(101, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-09T12:00:00-03:00" }),
      issue(102, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-10T12:00:00-03:00" }),
    ],
    prs: [
      pr(1101, { title: "Passo 1 (#101)", mergedAt: "2026-03-09T11:00:00-03:00" }),
      pr(1102, { title: "Passo 2 (#102)", mergedAt: "2026-03-10T11:30:00-03:00" }),
    ],
    projectItems: [board(100, "Done")],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].status, "concluido");
  assert.equal(out.entries[0].deliveredAt, "2026-03-10T11:30:00-03:00");
});

test("an umbrella is delivered when its last step is, not when a PR polishing an earlier step or its own first PR merged", () => {
  const out = facts({
    issues: [
      issue(100, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T18:00:00-03:00", subIssues: { total: 2, completed: 2 } }),
      issue(101, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-09T12:00:00-03:00" }),
      issue(102, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-10T12:00:00-03:00" }),
    ],
    prs: [
      pr(1100, { title: "Primeira parte", closing: [100], createdAt: "2026-03-08T09:00:00-03:00", mergedAt: "2026-03-08T10:00:00-03:00" }),
      pr(1101, { title: "Passo 1 (#101)", mergedAt: "2026-03-09T11:00:00-03:00" }),
      pr(1103, { title: "Teste do passo 1 (#101)", createdAt: "2026-03-09T12:10:00-03:00", mergedAt: "2026-03-09T12:30:00-03:00" }),
      pr(1102, { title: "Passo 2 (#102)", mergedAt: "2026-03-10T11:30:00-03:00" }),
    ],
    timelines: [timeline(100, { closers: [1100] })],
    projectItems: [board(100, "Done")],
  });
  assert.equal(out.entries[0].status, "concluido");
  assert.equal(out.entries[0].deliveredAt, "2026-03-10T11:30:00-03:00");
});

test("an umbrella with many merged PRs gets one summary line instead of one line each", () => {
  const steps = [101, 102, 103, 104, 105];
  const out = facts({
    issues: [
      issue(100, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T18:00:00-03:00", subIssues: { total: 5, completed: 5 } }),
      ...steps.map((n) => issue(n, { parent: 100, state: "closed", stateReason: "completed", closedAt: "2026-03-10T12:00:00-03:00" })),
    ],
    prs: steps.map((n, k) => pr(1000 + n, { title: `Passo (#${n})`, mergedAt: `2026-03-09T1${k}:00:00-03:00` })),
    projectItems: [board(100, "Done")],
  });
  const lines = out.entries[0].evidence.filter((l) => l.includes("PR"));
  assert.equal(lines.length, 2); // the delivery itself, and "4 PRs mesclados na main, de ... a ..."
  assert.ok(lines.some((l) => /4 PRs mesclados na main, de 09\/03 10:00 a 09\/03 13:00/.test(l)));
});

test("issues of another repository on the same Project never matter, whatever their status or number", () => {
  const out = facts({
    issues: [issue(300), issue(301)],
    projectItems: [
      board(300, "Development"),
      board(301, "Done"),
      // Same numbers, other repository: a Blocker for 300 and an item that has no counterpart here at all.
      board(300, "Blocker", { repository: "acme/other-product" }),
      board(555, "Development", { repository: "acme/other-product" }),
    ],
  });
  // 300 is on Development here: a cover of the sprint (no entry), and the other product's Blocker for it does not count.
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.sprint.epics.map((c) => c.issue), [300]);
  assert.equal(out.internal.count, 0);
});

test("a synchronization test issue is suggested as internal, with the reason", () => {
  const out = facts({
    issues: [issue(400, { title: "TESTE DE SINCRONIZAÇÃO do quadro", labels: ["type:feature"] })],
    projectItems: [board(400, "Development")],
  });
  assert.deepEqual(out.entries, []);
  assert.equal(out.internal.count, 1);
  assert.equal(out.internal.items[0].ref, "#400");
  assert.match(out.internal.items[0].reason, /teste/i);
});

test("the delivery date is the merge of the PR, not the day the issue was closed", () => {
  const out = facts({
    issues: [issue(500, { state: "closed", stateReason: "completed", closedAt: "2026-03-12T10:00:00-03:00" })],
    prs: [pr(1500, { title: "Nova tela (#500)", mergedAt: "2026-03-09T15:00:00-03:00", closedAt: "2026-03-09T15:00:00-03:00" })],
    projectItems: [board(500, "Done")],
  });
  const [entry] = out.entries;
  assert.equal(entry.status, "concluido");
  assert.equal(entry.deliveredAt, "2026-03-09T15:00:00-03:00");
  assert.equal(entry.hidden, false);
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/issues/500`));
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/pull/1500`));
  assert.ok(entry.evidence.some((line) => line.includes("#1500") && line.includes("09/03 15:00")));
});

test("an issue with many PRs keeps at most 20 sources, the issue and the delivering PR among them", () => {
  const many = Array.from({ length: 30 }, (_, i) => pr(2000 + i, { title: `Parte ${i} (#700)`, mergedAt: `2026-03-0${9 + (i % 2)}T10:00:00-03:00`, closedAt: `2026-03-0${9 + (i % 2)}T10:00:00-03:00` }));
  const late = pr(2999, { title: "Entrega final (#700)", mergedAt: "2026-03-10T18:00:00-03:00", closedAt: "2026-03-10T18:00:00-03:00" });
  const out = facts({
    issues: [issue(700, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T19:00:00-03:00" })],
    prs: [...many, late],
    projectItems: [board(700, "Done")],
  });
  const [entry] = out.entries;
  assert.ok(entry.sources.length <= 20, `got ${entry.sources.length}`);
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/issues/700`));
  assert.ok(entry.sources.includes(`https://github.com/${REPO}/pull/2999`));
  assert.equal(new Set(entry.sources).size, entry.sources.length);
});

test("a merge at 23:30 in São Paulo the day before the window is not a delivery of the window", () => {
  const before = facts({
    issues: [issue(600, { state: "closed", stateReason: "completed", closedAt: "2026-03-09T10:00:00-03:00" })],
    prs: [pr(1600, { title: "Entrega (#600)", createdAt: "2026-03-08T20:00:00-03:00", firstCommitAt: "2026-03-08T19:00:00-03:00", mergedAt: "2026-03-09T02:30:00Z", closedAt: "2026-03-09T02:30:00Z" })], // 08/03 23:30 in São Paulo
    projectItems: [board(600, "Done")],
  });
  assert.equal(before.entries[0].deliveredAt, "2026-03-08T23:30:00-03:00");
  assert.equal(before.entries[0].hidden, true);
  assert.match(before.entries[0].hiddenReason ?? "", /antes da janela/);

  const inside = facts({
    issues: [issue(601, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T10:00:00-03:00" })],
    prs: [pr(1601, { title: "Entrega (#601)", createdAt: "2026-03-09T20:00:00-03:00", mergedAt: "2026-03-10T02:30:00Z", closedAt: "2026-03-10T02:30:00Z" })], // 09/03 23:30
    projectItems: [board(601, "Done")],
  });
  assert.equal(inside.entries[0].deliveredAt, "2026-03-09T23:30:00-03:00");
  assert.equal(inside.entries[0].hidden, false);
});

test("an issue already delivered and closed before the window is left out even if a later PR mentions it", () => {
  const out = facts({
    issues: [issue(700, { createdAt: "2026-03-07T09:00:00-03:00", state: "closed", stateReason: "completed", closedAt: "2026-03-08T22:00:00-03:00" })],
    prs: [
      pr(1700, { title: "Correção (#700)", createdAt: "2026-03-08T20:00:00-03:00", mergedAt: "2026-03-08T22:00:00-03:00", closedAt: "2026-03-08T22:00:00-03:00" }),
      pr(1701, { title: "Teste da correção (#700)", createdAt: "2026-03-08T23:30:00-03:00", mergedAt: "2026-03-09T00:20:00-03:00", closedAt: "2026-03-09T00:20:00-03:00" }),
    ],
    projectItems: [board(700, "Done")],
  });
  assert.deepEqual(out.entries, []);
  assert.equal(out.internal.count, 0);
  assert.equal(out.ignored.settled, 1);
});

test("an issue closed in the window but delivered before it is kept as a hidden suggestion", () => {
  const out = facts({
    issues: [issue(710, { createdAt: "2026-03-05T09:00:00-03:00", state: "closed", stateReason: "completed", closedAt: "2026-03-09T09:00:00-03:00" })],
    prs: [pr(1710, { title: "Entrega (#710)", createdAt: "2026-03-06T09:00:00-03:00", firstCommitAt: "2026-03-06T08:00:00-03:00", mergedAt: "2026-03-06T10:00:00-03:00", closedAt: "2026-03-06T10:00:00-03:00" })],
    projectItems: [board(710, "Done")],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].hidden, true);
  assert.equal(out.entries[0].deliveredAt, "2026-03-06T10:00:00-03:00");
  assert.equal(out.internal.count, 0); // hidden for context, not an "internal adjustment"
});

test("issues created in one go with nobody assigned are planning, not progress", () => {
  const batch = Array.from({ length: 6 }, (_, k) =>
    issue(800 + k, { assignees: [], createdAt: `2026-03-09T09:0${k % 3}:00-03:00`, labels: ["type:feature"] })
  );
  const sprint = [issue(810), issue(811)]; // same minute, but assigned and on the sprint board: covers of the sprint
  const out = facts({
    issues: [...batch, ...sprint],
    projectItems: [...batch.map((i) => board(i.number, "Open")), board(810, "Development"), board(811, "Development")],
  });
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.sprint.epics.map((c) => c.issue), [810, 811]);
  assert.equal(out.internal.count, 6);
  assert.ok(out.internal.items.every((i) => /lote/i.test(i.reason)));
});

test("a short run of issues is not a batch", () => {
  const out = facts({
    issues: [issue(820, { assignees: [] }), issue(821, { assignees: [] })],
    projectItems: [board(820, "Open"), board(821, "Open")],
  });
  assert.equal(out.internal.count, 0);
  assert.equal(out.ignored.backlog, 2);
});

test("review follow-ups, chore and test labels are internal; a feature label keeps an issue in the report", () => {
  const out = facts({
    issues: [
      issue(900, { assignees: [], body: "PRD: achado A1 da revisão independente do PR 12 (issue 5), 09/03/2026." }),
      issue(901, { assignees: [], body: "Origem: follow-ups da 7 (PR 8, já na main)." }),
      issue(902, { assignees: [], labels: ["type:chore"] }),
      issue(903, { assignees: [], labels: ["test"] }),
      issue(904, { assignees: [], labels: ["infra", "type:feature"] }),
    ],
    prs: [pr(1904, { title: "Infra que o cliente vê (#904)", state: "open", mergedAt: null, closedAt: null })],
    projectItems: [board(904, "Open")],
  });
  assert.deepEqual(out.internal.items.map((i) => i.ref), ["#900", "#901", "#902", "#903"]);
  assert.deepEqual(out.entries.map((e) => [e.issue, e.status]), [[904, "em_validacao"]]);
});

test("an issue already broken into parts is real work, even if its body names a review or it carries a chore label", () => {
  const born = (hour: number) => ({ createdAt: `2026-03-09T0${hour}:00:00-03:00` }); // hours apart: no batch
  const out = facts({
    issues: [
      issue(930, { assignees: [], body: "PRD: achado A1 da revisão independente do PR 12.", ...born(1), ...closedIn("2026-03-10T10:00:00-03:00") }),
      issue(931, { parent: 930, ...born(2), ...closedIn("2026-03-10T09:00:00-03:00") }),
      issue(932, { assignees: [], labels: ["type:chore"], ...born(3), ...closedIn("2026-03-10T10:00:00-03:00") }),
      issue(933, { parent: 932, ...born(4), ...closedIn("2026-03-10T09:00:00-03:00") }),
      // The same texts on a small stray ticket (no parts) stay internal.
      issue(934, { assignees: [], body: "PRD: achado A1 da revisão independente do PR 12.", ...born(5) }),
      issue(935, { assignees: [], labels: ["type:chore"], ...born(6) }),
    ],
    projectItems: [board(930, "Done"), board(932, "Done")],
  });
  assert.deepEqual(out.entries.map((e) => e.issue), [930, 932]);
  assert.deepEqual(out.internal.items.map((i) => i.ref), ["#934", "#935"]);
});

test("an issue on the sprint board is real work even if it carries a chore label: a cover, never internal", () => {
  const out = facts({
    issues: [issue(910, { labels: ["type:chore"] })],
    projectItems: [board(910, "Development")],
  });
  assert.deepEqual(out.sprint.epics.map((c) => [c.issue, c.parts]), [[910, { total: 1, done: 0, remaining: 1 }]]);
  assert.equal(out.internal.count, 0);
});

test("PRs without any issue are internal; PRs that cite an issue belong to that issue", () => {
  const out = facts({
    issues: [issue(1000)],
    prs: [
      pr(2001, { title: "Ajusta a documentação interna" }),
      pr(2002, { title: "Funcionalidade 1000 (#1000)" }),
    ],
    projectItems: [board(1000, "Open")],
  });
  assert.equal(out.internal.count, 1);
  assert.equal(out.internal.items[0].ref, "PR #2001");
  assert.equal(out.entries[0].status, "em_validacao");
});

test("a PR that only mentions an issue in passing does not deliver it", () => {
  const out = facts({
    issues: [issue(1100)],
    prs: [pr(2100, { title: "Outra funcionalidade (#1101)" })],
    projectItems: [board(1100, "Development")],
    timelines: [timeline(1100)],
  });
  // 1100 is a cover of the sprint with its one part still to do: nothing was delivered by a PR that names another issue.
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.sprint.epics.map((c) => [c.issue, c.parts.remaining]), [[1100, 1]]);
  assert.deepEqual(out.delivered, { issues: 0, parts: 0 });
});

test("a PR that GitHub says closes the issue delivers it even without a number in its title", () => {
  const out = facts({
    issues: [issue(1200, { state: "closed", stateReason: "completed", closedAt: "2026-03-09T13:00:00-03:00" })],
    prs: [pr(2200, { title: "Corrige o cadastro", closing: [1200] })],
    projectItems: [board(1200, "Done")],
  });
  assert.equal(out.entries[0].status, "concluido");
  assert.equal(out.entries[0].deliveredAt, "2026-03-09T11:00:00-03:00");
});

test("work that exists on GitHub before the window ends shows as under way, and a quiet item off the sprint is left out", () => {
  const out = facts({
    issues: [issue(1300), issue(1301, { createdAt: "2026-02-20T09:00:00-03:00" })],
    prs: [
      // Opened after the window, but its branch already had commits inside it.
      pr(2300, { title: "Em construção (#1300)", state: "open", mergedAt: null, closedAt: null, createdAt: "2026-03-11T05:00:00-03:00", firstCommitAt: "2026-03-10T13:00:00-03:00" }),
    ],
    projectItems: [board(1300, "Open"), board(1301, "Open")],
  });
  assert.deepEqual(out.entries.map((e) => [e.issue, e.status]), [[1300, "em_andamento"]]);
  assert.equal(out.ignored.quiet, 1);
});

test("a board item on Development with no code at all is a cover with its one part left, never an entry", () => {
  const out = facts({ issues: [issue(1400)], projectItems: [board(1400, "Development")] });
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.sprint.epics, [{ issue: 1400, title: "Funcionalidade 1400", issues: { total: 1, done: 0 }, parts: { total: 1, done: 0, remaining: 1 }, open: [] }]);
  assert.deepEqual(out.sprint.totals, { covers: 1, remainingParts: 1 });
  assert.equal(out.ignored.covers, 1);
});

test("issues only sitting in the backlog, and closed ones with no work, are handled without noise", () => {
  const out = facts({
    issues: [
      issue(1500, { assignees: [] }),
      issue(1501, { state: "closed", stateReason: "completed", closedAt: "2026-03-10T09:00:00-03:00" }),
      issue(1502, { state: "closed", stateReason: "not_planned", closedAt: "2026-03-10T09:00:00-03:00" }),
    ],
    projectItems: [board(1500, "Open"), board(1501, "Done"), board(1502, "Done")],
  });
  assert.equal(out.ignored.backlog, 1);
  assert.deepEqual(out.entries.map((e) => [e.issue, e.hidden]), [[1501, true]]);
  assert.match(out.entries[0].hiddenReason ?? "", /sem PR/);
  assert.deepEqual(out.internal.items.map((i) => i.ref), ["#1502"]);
});

test("the local hide list takes issue numbers and title patterns", () => {
  const out = facts({
    issues: [issue(1600), issue(1601, { title: "Rascunho de limpeza" }), issue(1602)],
    projectItems: [board(1600, "Development"), board(1601, "Development"), board(1602, "Development")],
    hide: { issues: [1600], patterns: ["^rascunho"] },
  });
  assert.deepEqual(out.sprint.epics.map((c) => c.issue), [1602]); // a hidden issue is no cover either
  assert.deepEqual(out.entries, []);
  assert.equal(out.internal.count, 2);
  assert.ok(out.internal.items.every((i) => /hide\.json/.test(i.reason)));
});

test("a hide list from a file is read leniently", () => {
  assert.deepEqual(parseHideList({ issues: [3, "x", -1, 4.5, 9], patterns: ["^a", 7, ""] }), { issues: [3, 9], patterns: ["^a"] });
  assert.deepEqual(parseHideList(null), { issues: [], patterns: [] });
  assert.deepEqual(parseHideList("nonsense"), { issues: [], patterns: [] });
});

test("git work of the window feeds the coverage check: merges, branch commits, no duplicates, only the author's", () => {
  const c = (oid: string, at: string, author = "dev-a") => ({ oid, at, author });
  const out = facts({
    issues: [issue(1700)],
    prs: [
      pr(2700, {
        title: "Entrega (#1700)",
        mergedAt: "2026-03-09T16:00:00-03:00",
        mergeCommit: "ffff000",
        commits: [c("aaaa111", "2026-03-09T09:30:00-03:00"), c("bbbb222", "2026-03-09T10:30:00-03:00", "someone-else"), c("cccc333", "2026-03-08T10:00:00-03:00")],
      }),
    ],
    timelines: [timeline(1700, { commits: [c("aaaa111", "2026-03-09T09:30:00-03:00"), c("dddd444", "2026-03-09T09:45:00-03:00")] })],
    mainCommits: [c("ffff000", "2026-03-09T16:00:01-03:00"), c("eeee555", "2026-03-10T10:00:00-03:00")],
    projectItems: [board(1700, "Done")],
    author: "dev-a",
  });
  assert.deepEqual(out.gitWork, [
    { at: "2026-03-09T09:30:00-03:00", ref: "commit aaaa111" },
    { at: "2026-03-09T09:45:00-03:00", ref: "commit dddd444" },
    { at: "2026-03-09T16:00:00-03:00", ref: "PR #2700 mesclado" },
    { at: "2026-03-10T10:00:00-03:00", ref: "commit eeee555" },
  ]);
});

test("entries come out in issue order with the stable id the edits are stored under", () => {
  const out = facts({
    issues: [issue(30), issue(10), issue(20)],
    timelines: [30, 10, 20].map((n) => timeline(n, { commits: [{ oid: `aaaa${n}`, at: "2026-03-09T10:00:00-03:00", author: "dev-a" }] })),
    projectItems: [board(30, "Open"), board(10, "Open"), board(20, "Open")],
  });
  assert.deepEqual(out.entries.map((e) => e.id), ["gc-10", "gc-20", "gc-30"]);
  assert.equal(out.scope, "GeoCloud");
  assert.deepEqual(out.window, WINDOW);
});

/* ---------- Epics are groupers, not deliveries ---------- */

const epic = (number: number, over: Partial<GhIssue> = {}): GhIssue => issue(number, { title: `Epic ${number}`, labels: ["type:epic"], createdAt: OLD, ...over });
const part = (number: number, parent: number, over: Partial<GhIssue> = {}): GhIssue => issue(number, { parent, createdAt: OLD, ...over });

/**
 * 1000 (epic) > 1010 (epic) > 1020 (epic) > three deliveries and an old one:
 *   1021 a leaf closed in the window, with its PR; 1022 has parts, one of them has a part (PR on the grandchild);
 *   1023 is untouched; 1024 was delivered long before the window. The middle epic is on the sprint board (a cover),
 *   and 1100, with no epic above it, has a commit.
 */
function epicTree(over: Partial<FactsInput> = {}) {
  return facts({
    issues: [
      epic(1000),
      epic(1010, { parent: 1000 }),
      epic(1020, { parent: 1010 }),
      part(1021, 1020, closedIn("2026-03-10T10:00:00-03:00")),
      part(1022, 1020),
      part(1023, 1020),
      part(1024, 1020, closedIn("2026-03-02T10:00:00-03:00")),
      part(1031, 1022),
      part(1032, 1022, closedIn("2026-03-10T09:00:00-03:00")),
      part(1033, 1022),
      part(1041, 1031, closedIn("2026-03-10T11:00:00-03:00")),
      issue(1100, { createdAt: OLD }), // an issue with no epic above it stays its own delivery
    ],
    prs: [pr(2021, { title: "Entrega (#1021)" }), pr(2041, { title: "Parte (#1041)", mergedAt: "2026-03-10T12:00:00-03:00" })],
    timelines: [timeline(1100, { commits: [c("aaaa111", "2026-03-10T08:00:00-03:00")] })],
    projectItems: [board(1010, "Development"), board(1100, "Open")],
    ...over,
  });
}

test("an epic is never a delivery: each work root under it is, with the rules of any other issue", () => {
  const out = epicTree();
  assert.deepEqual(out.entries.map((e) => [e.issue, e.status]), [[1021, "concluido"], [1022, "em_andamento"], [1100, "em_andamento"]]);
  assert.equal(out.ignored.epics, 3); // 1000, 1010 (on the sprint board and all) and 1020
  assert.equal(out.ignored.children, 4); // 1031, 1032, 1033 and 1041 hang from a delivery
  assert.equal(out.ignored.quiet, 2); // 1023 was not touched, and 1024 was delivered before the window
  // The epic on the sprint board is a cover: its deliveries are 1021 to 1024, its parts the leaves under them.
  assert.deepEqual(out.sprint.epics, [
    {
      issue: 1010,
      title: "Epic 1010",
      issues: { total: 4, done: 2 },
      parts: { total: 6, done: 4, remaining: 2 }, // open: 1033 and 1023
      open: [{ issue: 1022, title: "Funcionalidade 1022" }, { issue: 1023, title: "Funcionalidade 1023" }],
    },
  ]);
});

test("a work root takes the parts, the PRs and the closures of its own subtree, at any depth", () => {
  const [one, two] = epicTree().entries;
  assert.equal(one.subIssues, null);
  assert.equal("slices" in one, false);
  assert.deepEqual(two.subIssues, { total: 3, done: 2 }); // 1041, 1032 and 1033
  assert.deepEqual(two.slices, {
    closed: [
      { title: "Funcionalidade 1032", closedAt: "2026-03-10T09:00:00-03:00" },
      { title: "Funcionalidade 1041", closedAt: "2026-03-10T11:00:00-03:00" },
    ],
    blocked: [],
  });
  assert.ok(two.sources.includes(`https://github.com/${REPO}/pull/2041`) && !two.sources.includes(`https://github.com/${REPO}/pull/2021`));
  assert.ok(!one.sources.includes(`https://github.com/${REPO}/pull/2041`));
});

test("a delivery names the epics above it: the closest one with its parts, and the whole chain from the outermost", () => {
  const [one, two, plain] = epicTree().entries;
  const chain = [{ issue: 1000, title: "Epic 1000" }, { issue: 1010, title: "Epic 1010" }, { issue: 1020, title: "Epic 1020" }];
  assert.deepEqual(one.epicPath, chain);
  assert.deepEqual(one.epic, { issue: 1020, title: "Epic 1020", parts: { total: 4, done: 2 } }); // 1021 and 1024 done, 1022 and 1023 not
  assert.deepEqual(two.epic, one.epic);
  assert.equal("epic" in plain || "epicPath" in plain, false);
});

test("the parts of an epic are its deliveries: a cancelled one is no part, and one under another epic counts", () => {
  const out = facts({
    issues: [
      epic(1300),
      epic(1301, { parent: 1300 }),
      part(1302, 1300, closedIn("2026-03-10T10:00:00-03:00")),
      part(1303, 1300, { state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T10:00:00-03:00" }),
      part(1304, 1301),
      part(1305, 1301, closedIn("2026-03-10T10:00:00-03:00")),
    ],
    prs: [pr(2302, { title: "Entrega (#1302)" })],
    timelines: [timeline(1304, { commits: [c("ffff666", "2026-03-10T08:00:00-03:00")] })],
    projectItems: [board(1304, "Open")],
  });
  assert.deepEqual(out.entries.map((e) => [e.issue, e.epic?.issue, e.epic?.parts]), [
    [1302, 1300, { total: 3, done: 2 }], // 1302, 1304 and 1305 under 1300 through 1301; 1303 was cancelled
    [1304, 1301, { total: 2, done: 1 }],
    [1305, 1301, { total: 2, done: 1 }],
  ]);
  assert.equal(out.ignored.epics, 2);
});

test("an epic below a delivery is just one more part of it, and an epic with nothing in it is only counted", () => {
  const out = facts({
    issues: [issue(1400, { createdAt: OLD }), epic(1401, { parent: 1400 }), part(1402, 1401, closedIn("2026-03-10T10:00:00-03:00")), epic(1500)],
    projectItems: [board(1400, "Open")],
  });
  assert.deepEqual(out.entries.map((e) => [e.issue, e.subIssues]), [[1400, { total: 1, done: 1 }]]);
  assert.equal(out.ignored.epics, 1); // 1500; 1401 is inside a delivery
  assert.equal(out.ignored.children, 2);
});

test("the local hide list reaches the deliveries under an epic it names, by number or by title", () => {
  for (const hide of [{ issues: [1000], patterns: [] }, { issues: [], patterns: ["^epic 1010$"] }]) {
    const out = epicTree({ hide });
    assert.deepEqual(out.entries.map((e) => e.issue), [1100], JSON.stringify(hide));
    assert.deepEqual(out.internal.items.filter((i) => i.ref.startsWith("#")).map((i) => [i.ref, i.reason]), [["#1021", "lista local (hide.json)"], ["#1022", "lista local (hide.json)"]]);
  }
});

test("a PR that cites only an epic belongs to no delivery: it is listed as internal, not lost", () => {
  const out = epicTree({
    prs: [pr(2021, { title: "Entrega (#1021)" }), pr(2999, { title: "Integra o passo (#1010)" }), pr(2998, { title: "Entrega e epic (#1010) (#1021)", createdAt: "2026-03-09T12:00:00-03:00", mergedAt: "2026-03-09T13:00:00-03:00" })],
  });
  const internal = out.internal.items.filter((i) => i.ref.startsWith("PR"));
  assert.deepEqual(internal.map((i) => [i.ref, /epic/i.test(i.reason)]), [["PR #2999", true]]);
  assert.ok(out.entries[0].sources.includes(`https://github.com/${REPO}/pull/2998`)); // it also cites 1021: that one is a delivery PR
});

/* ---------- The sprint: covers on Development, and what is left of them ---------- */

/**
 * 2000 (epic, Development) holds the deliveries 2010 (a leaf, closed in the window with its PR), 2020 (four parts,
 * all done, closed in the window), 2030 (a leaf, open) and 2040 (two parts, one done); 2100 (epic, Development)
 * holds two open leaves; 2200 (an epic with nothing in it) and 2300 (a plain issue) are on Development too.
 */
function sprintTree(over: Partial<FactsInput> = {}) {
  const done = (n: number, parent: number) => part(n, parent, closedIn("2026-03-10T10:00:00-03:00"));
  return facts({
    issues: [
      epic(2000), epic(2100), epic(2200), issue(2300, { createdAt: OLD }),
      done(2010, 2000), done(2020, 2000), part(2030, 2000), part(2040, 2000),
      done(2021, 2020), done(2022, 2020), done(2023, 2020), done(2024, 2020),
      done(2041, 2040), part(2042, 2040),
      part(2110, 2100), part(2111, 2100),
    ],
    prs: [pr(3010, { title: "Entrega (#2010)" }), pr(3024, { title: "Parte (#2024)", mergedAt: "2026-03-10T11:00:00-03:00" })],
    projectItems: [board(2000, "Development"), board(2100, "Development"), board(2200, "Development"), board(2300, "Development")],
    ...over,
  });
}

test("each open item on Development is a cover with what is left of it: deliveries, parts, and the deliveries still open", () => {
  const out = sprintTree();
  const [a, b, c, d] = out.sprint.epics;
  assert.deepEqual(out.sprint.epics.map((x) => x.issue), [2000, 2100, 2200, 2300]);
  // 2000: deliveries 2010, 2020, 2030, 2040 (2 done); parts 1 + 4 + 1 + 2 = 8, 6 done... 2010, 2021-2024, 2041 are done.
  assert.deepEqual(a.issues, { total: 4, done: 2 });
  assert.deepEqual(a.parts, { total: 8, done: 6, remaining: 2 }); // 2030 and 2042 are left
  assert.deepEqual(a.open, [{ issue: 2030, title: "Funcionalidade 2030" }, { issue: 2040, title: "Funcionalidade 2040" }]);
  assert.deepEqual(b.parts, { total: 2, done: 0, remaining: 2 });
  assert.deepEqual(b.issues, { total: 2, done: 0 });
  // A cover with nothing under it is its own single part, whether it is an epic or not.
  for (const alone of [c, d]) {
    assert.deepEqual(alone.issues, { total: 1, done: 0 });
    assert.deepEqual(alone.parts, { total: 1, done: 0, remaining: 1 });
    assert.deepEqual(alone.open, []);
  }
  assert.deepEqual(out.sprint.totals, { covers: 4, remainingParts: 2 + 2 + 1 + 1 });
  assert.equal(out.ignored.covers, 4);
});

test("a cover is never an entry, but the deliveries closed under it are: concluded in the window, on the sprint or not", () => {
  const out = sprintTree();
  assert.deepEqual(out.entries.map((e) => [e.issue, e.status]), [[2010, "concluido"], [2020, "concluido"], [2040, "em_andamento"]]);
  // 2010 has no parts and counts one; 2020 has four done. The delivery still under way is no "concluído".
  assert.deepEqual(out.delivered, { issues: 2, parts: 1 + 4 });
});

test("the delivered count only takes what is visible and concluded: hidden and unfinished ones do not count, a delivery with no parts counts one", () => {
  const none = facts({ issues: [issue(2400, { createdAt: OLD })], projectItems: [board(2400, "Open")] });
  assert.deepEqual(none.delivered, { issues: 0, parts: 0 });
  const hidden = sprintTree({ hide: { issues: [2010], patterns: [] } });
  assert.deepEqual(hidden.delivered, { issues: 1, parts: 4 });
});

test("a cover with nothing left is not in the block, and a cover inside another cover is not counted twice", () => {
  const out = facts({
    issues: [epic(2500), part(2510, 2500, closedIn("2026-03-10T10:00:00-03:00")), epic(2600), part(2610, 2600), part(2611, 2610), part(2620, 2600, closedIn("2026-03-10T10:00:00-03:00"))],
    projectItems: [board(2500, "Development"), board(2600, "Development"), board(2610, "Development")],
  });
  assert.deepEqual(out.sprint.epics.map((x) => [x.issue, x.parts]), [[2600, { total: 2, done: 1, remaining: 1 }]]); // 2500 is all done; 2610 is part of 2600
  assert.equal(out.sprint.totals.covers, 1);
  assert.equal(out.ignored.covers, 2); // 2500 and 2600; 2610 is inside 2600
  assert.deepEqual(out.entries.map((e) => e.issue), [2510, 2620]); // the closed deliveries still show; the open 2610 is on Development, so a part of the cover
});

test("a cancelled part or delivery is neither part nor delivery of a cover", () => {
  const out = facts({
    issues: [epic(2700), part(2710, 2700), part(2720, 2700, { state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T10:00:00-03:00" }), part(2711, 2710), part(2712, 2710, { state: "closed", stateReason: "not_planned", closedAt: "2026-03-09T10:00:00-03:00" })],
    projectItems: [board(2700, "Development")],
  });
  const [cover] = out.sprint.epics;
  assert.deepEqual(cover.issues, { total: 1, done: 0 }); // 2710 only
  assert.deepEqual(cover.parts, { total: 1, done: 0, remaining: 1 }); // 2711 only
});

test("an item that was no longer open when the window ended, or not on Development then, is no cover", () => {
  const out = facts({
    issues: [
      issue(2800, { createdAt: OLD, ...closedIn("2026-03-05T10:00:00-03:00") }), // closed before the end, board says Development
      issue(2810, { createdAt: OLD }), // on Done
      issue(2820, { createdAt: OLD, ...closedIn("2026-03-12T10:00:00-03:00") }), // closed after the window: still open at its end
    ],
    projectItems: [board(2800, "Development"), board(2810, "Done"), board(2820, "Development")],
  });
  assert.deepEqual(out.sprint.epics.map((x) => x.issue), [2820]);
});

test("a cover that was hidden, or sits under an epic that was, or is a synchronization test, is not in the block", () => {
  const out = facts({
    issues: [epic(2900), part(2910, 2900), issue(2920, { title: "TESTE DE SINCRONIZAÇÃO" }), issue(2930, { createdAt: OLD })],
    projectItems: [board(2910, "Development"), board(2920, "Development"), board(2930, "Development")],
    hide: { issues: [2900], patterns: [] },
  });
  assert.deepEqual(out.sprint.epics.map((x) => x.issue), [2930]);
});

test("the deliveries still open are at most thirty, in issue order", () => {
  const many = Array.from({ length: 40 }, (_, k) => part(3100 + k, 3000));
  const out = facts({ issues: [epic(3000), ...many], projectItems: [board(3000, "Development")] });
  const [cover] = out.sprint.epics;
  assert.equal(cover.open.length, 30);
  assert.equal(cover.open[0].issue, 3100);
  assert.deepEqual(cover.issues, { total: 40, done: 0 });
  assert.deepEqual(cover.parts, { total: 40, done: 0, remaining: 40 });
});

test("an item on Blocker is still an entry, as bloqueado: only Development makes a cover", () => {
  const out = facts({ issues: [issue(3200)], timelines: [timeline(3200, { commits: [c("aaaa111", "2026-03-09T10:00:00-03:00")] })], projectItems: [board(3200, "Blocker")] });
  assert.deepEqual(out.entries.map((e) => [e.issue, e.status]), [[3200, "bloqueado"]]);
  assert.deepEqual(out.sprint.epics, []);
});
