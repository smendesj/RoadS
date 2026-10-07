import { test } from "node:test";
import assert from "node:assert/strict";
import { boardStatusAt, classifyEntry, toSaoPauloIso } from "./gh-status.ts";
import type { PrFact, StatusInput } from "./gh-status.ts";

// Synthetic cases only: made-up instants, made-up PR numbers. The window ends at 10/03 00:00 (São Paulo).
const END = "2026-03-10T00:00:00-03:00";

const pr = (over: Partial<PrFact> = {}): PrFact => ({
  number: 11,
  title: "Entrega",
  url: "https://github.com/acme/app/pull/11",
  state: "merged",
  draft: false,
  base: "main",
  createdAt: "2026-03-08T10:00:00-03:00",
  closedAt: "2026-03-08T12:00:00-03:00",
  mergedAt: "2026-03-08T12:00:00-03:00",
  firstCommitAt: "2026-03-08T09:00:00-03:00",
  ...over,
});

const openPr = (over: Partial<PrFact> = {}): PrFact =>
  pr({ state: "open", draft: true, closedAt: null, mergedAt: null, number: 12, ...over });

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  windowEnd: END,
  closedAt: null,
  board: { atEnd: null, now: null },
  prs: [],
  commits: [],
  ...over,
});

const statusOf = (over: Partial<StatusInput>) => classifyEntry(input(over))?.status ?? null;

test("merged into main with the issue still open waits for the user's confirmation: em_validacao", () => {
  const decision = classifyEntry(input({ prs: [pr()], board: { atEnd: "Development", now: "Development" } }));
  assert.equal(decision?.status, "em_validacao");
  assert.equal(decision?.deliveredAt, "2026-03-08T12:00:00-03:00");
});

test("merged into main and the issue closed, or the board on Done: concluido", () => {
  assert.equal(statusOf({ prs: [pr()], closedAt: "2026-03-09T09:00:00-03:00" }), "concluido");
  assert.equal(statusOf({ prs: [pr()], board: { atEnd: "Development", now: "Done" } }), "concluido");
});

test("the user closing the issue after the window ended still counts as the confirmation", () => {
  assert.equal(statusOf({ prs: [pr()], closedAt: "2026-03-10T10:00:00-03:00" }), "concluido");
});

test("merged somewhere that is not main is not delivered yet, even with the issue closed", () => {
  const decision = classifyEntry(input({ prs: [pr({ base: "release/next" })], closedAt: "2026-03-09T09:00:00-03:00" }));
  assert.equal(decision?.status, "em_validacao");
  assert.equal(decision?.deliveredAt, null);
});

test("Development with no work at all until the end of the window is proximo", () => {
  assert.equal(statusOf({ board: { atEnd: "Development", now: "Development" } }), "proximo");
});

test("Development with a PR open (draft or not) is under validation, per the decided rule", () => {
  // The decided business rule says "PR open or draft, issue still open: em_validacao". Flip OPEN_PR_STATUS
  // in gh-status.ts if the product ever wants an open PR to read as "em_andamento".
  const board = { atEnd: "Development", now: "Development" } as const;
  assert.equal(statusOf({ prs: [openPr()], board }), "em_validacao");
  assert.equal(statusOf({ prs: [openPr({ draft: false })], board }), "em_validacao");
});

test("Development with commits citing the issue but no PR is em_andamento", () => {
  const board = { atEnd: "Development", now: "Development" } as const;
  assert.equal(statusOf({ commits: ["2026-03-09T15:00:00-03:00"], board }), "em_andamento");
});

test("work counts only until the end of the window: a commit made afterwards does not", () => {
  const board = { atEnd: "Development", now: "Development" } as const;
  assert.equal(statusOf({ commits: ["2026-03-10T08:00:00-03:00"], board }), "proximo");
});

test("a PR opened after the window, whose branch already had commits inside it, shows work under way", () => {
  const board = { atEnd: "Development", now: "Development" } as const;
  const late = openPr({ createdAt: "2026-03-10T05:00:00-03:00", firstCommitAt: "2026-03-09T13:00:00-03:00" });
  assert.equal(statusOf({ prs: [late], board }), "em_andamento");
  const wholly = openPr({ createdAt: "2026-03-10T05:00:00-03:00", firstCommitAt: "2026-03-10T04:00:00-03:00" });
  assert.equal(statusOf({ prs: [wholly], board }), "proximo");
});

test("a PR merged after the window ended was still open at its end", () => {
  const decision = classifyEntry(input({ prs: [pr({ mergedAt: "2026-03-10T09:00:00-03:00" })], board: { atEnd: "Development", now: "Development" } }));
  assert.equal(decision?.status, "em_validacao");
  assert.equal(decision?.deliveredAt, null);
});

test("a PR closed without merging is work done, not a validation", () => {
  const abandoned = pr({ state: "closed", mergedAt: null, closedAt: "2026-03-09T08:00:00-03:00" });
  assert.equal(statusOf({ prs: [abandoned], board: { atEnd: "Development", now: "Development" } }), "em_andamento");
});

test("Blocker on the board is bloqueado, unless the work was already delivered and confirmed", () => {
  const board = { atEnd: "Blocker", now: "Blocker" } as const;
  assert.equal(statusOf({ board, commits: ["2026-03-09T10:00:00-03:00"] }), "bloqueado");
  assert.equal(statusOf({ board, prs: [openPr()] }), "bloqueado");
  assert.equal(statusOf({ board, prs: [pr()], closedAt: "2026-03-09T09:00:00-03:00" }), "concluido");
});

test("a part of the umbrella closed before the window ended means work was done: never proximo", () => {
  const board = { atEnd: "Development", now: "Development" } as const;
  const subIssues = { total: 8, done: 3 };
  assert.equal(statusOf({ board, subIssues, closedParts: ["2026-03-09T15:00:00-03:00"] }), "em_andamento");
  assert.equal(classifyEntry(input({ board, subIssues, closedParts: ["2026-03-09T15:00:00-03:00"] }))?.reason, "work_in_progress");
  // The same umbrella with no part closed yet, and one whose only closure came after the window: still next.
  assert.equal(statusOf({ board, subIssues: { total: 8, done: 0 } }), "proximo");
  assert.equal(statusOf({ board, subIssues, closedParts: ["2026-03-10T08:00:00-03:00"] }), "proximo");
});

test("an issue that is only in the backlog is not part of the report", () => {
  assert.equal(classifyEntry(input({ board: { atEnd: "Open", now: "Open" } })), null);
  assert.equal(classifyEntry(input()), null);
  assert.equal(statusOf({ board: { atEnd: "Open", now: "Open" }, commits: ["2026-03-09T10:00:00-03:00"] }), "em_andamento");
});

test("a delivery at 23:30 in São Paulo (already the next day in UTC) lands on the right day", () => {
  const late = pr({ mergedAt: "2026-03-09T02:30:00Z" }); // 08/03 23:30 in São Paulo
  const decision = classifyEntry(input({ prs: [late], closedAt: "2026-03-09T09:00:00-03:00" }));
  assert.equal(decision?.deliveredAt, "2026-03-08T23:30:00-03:00");
  assert.equal(decision?.deliveredDay, "2026-03-08");
  assert.equal(toSaoPauloIso("2026-03-09T02:30:00Z"), "2026-03-08T23:30:00-03:00");
});

test("the delivery is the PR that closed the issue, not a later PR that only mentions it in its title", () => {
  const fix = pr({ number: 21, mergedAt: "2026-03-08T12:00:00-03:00", closedAt: "2026-03-08T12:00:00-03:00" });
  const residue = pr({ number: 22, mergedAt: "2026-03-09T00:23:00-03:00", closedAt: "2026-03-09T00:23:00-03:00" });
  const closedAt = "2026-03-08T12:00:00-03:00";
  assert.equal(classifyEntry(input({ prs: [residue, fix], closers: [21], closedAt }))?.delivery?.number, 21);
  // No closing reference: the last PR merged up to the closure is the delivery.
  assert.equal(classifyEntry(input({ prs: [residue, fix], closedAt }))?.delivery?.number, 21);
  // Never closed: the last piece merged so far.
  assert.equal(classifyEntry(input({ prs: [fix, residue] }))?.delivery?.number, 22);
});

test("a parent still has sub-issues open: its merged PR does not make it concluido", () => {
  const decision = classifyEntry(
    input({ prs: [pr()], closedAt: "2026-03-09T09:00:00-03:00", subIssues: { total: 3, done: 1 } })
  );
  assert.equal(decision?.status, "em_andamento");
  assert.equal(statusOf({ prs: [pr()], closedAt: "2026-03-09T09:00:00-03:00", subIssues: { total: 3, done: 3 } }), "concluido");
});

test("an issue closed without any PR is concluido with no delivery date", () => {
  const decision = classifyEntry(input({ closedAt: "2026-03-09T09:00:00-03:00" }));
  assert.equal(decision?.status, "concluido");
  assert.equal(decision?.deliveredAt, null);
  assert.equal(decision?.reason, "closed_without_pr");
});

test("the board status at the end of the window comes from the item or, if it changed later, from its history", () => {
  const item = { status: "Done", statusUpdatedAt: "2026-03-11T10:00:00-03:00" };
  assert.equal(boardStatusAt({ status: "Development", statusUpdatedAt: "2026-03-08T10:00:00-03:00" }, [], END), "Development");
  const history = [
    { at: "2026-03-05T10:00:00-03:00", to: "Open" },
    { at: "2026-03-07T10:00:00-03:00", to: "Development" },
    { at: "2026-03-11T10:00:00-03:00", to: "Done" },
  ];
  assert.equal(boardStatusAt(item, history, END), "Development");
  // Changed after the end and no recorded history: the honest answer is "unknown".
  assert.equal(boardStatusAt(item, [], END), null);
  assert.equal(boardStatusAt(null, [], END), null);
  assert.equal(boardStatusAt({ status: "Something else", statusUpdatedAt: null }, [], END), null);
});
