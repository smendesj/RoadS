import { test } from "node:test";
import assert from "node:assert/strict";
import { issueParts, partsOf } from "./parts.ts";

const BODY = [
  "## Problema",
  "- [x] fora da seção",
  "## Critérios de aceitação",
  "- [x] S1. Primeira parte.",
  "- [ ] S2. Segunda parte.",
  "  - Bloqueada: falta a chave",
  "- [ ] S3. Terceira parte.",
].join("\n");

const sub = (number: number, state: string, stateReason: string | null = null) => ({ number, state, stateReason });

test("the boxes of the acceptance criteria are parts even when the issue has sub-issues", () => {
  const parts = issueParts(BODY, [sub(11, "OPEN")]);
  assert.deepEqual(parts.boxes.map((b) => [b.text, b.checked, b.blocked]), [
    ["S1. Primeira parte.", true, null],
    ["S2. Segunda parte.", false, "falta a chave"],
    ["S3. Terceira parte.", false, null],
  ]);
});

test("a sub-issue still open is a part of its own, after the boxes", () => {
  const parts = issueParts(BODY, [sub(11, "OPEN")]);
  assert.deepEqual(parts.open, [{ number: 11, state: "OPEN", stateReason: null }]);
});

test("a closed sub-issue is no part, whether completed, not planned or a duplicate", () => {
  const parts = issueParts(BODY, [sub(11, "CLOSED", "COMPLETED"), sub(12, "OPEN"), sub(13, "CLOSED", "NOT_PLANNED"), sub(14, "CLOSED", "DUPLICATE")]);
  assert.deepEqual(parts.open.map((s) => s.number), [12]);
});

test("an issue converted to boxes, with three boxes (one ticked), two closed sub-issues and one open, is 1 of 4", () => {
  const parts = issueParts(BODY, [sub(11, "CLOSED", "COMPLETED"), sub(12, "CLOSED", "NOT_PLANNED"), sub(13, "OPEN")]);
  assert.deepEqual([parts.done, parts.total], [1, 4]);
});

test("an open sub-issue is never a done part, and a closed one never adds to the parts done", () => {
  const parts = issueParts("## Critérios de aceitação\n- [ ] S1. Única.", [sub(11, "OPEN"), sub(12, "CLOSED", "COMPLETED")]);
  assert.deepEqual([parts.done, parts.total], [0, 2]);
});

test("GitHub's REST spelling of the state (lower case) reads the same as GraphQL's", () => {
  const parts = issueParts(null, [sub(11, "open"), sub(12, "closed", "completed")]);
  assert.deepEqual([parts.open.map((s) => s.number), parts.done, parts.total], [[11], 0, 1]);
});

test("a sub-issue whose state is missing or unknown is not shown as open", () => {
  const subIssues: { number: number; state?: string }[] = [{ number: 11 }, sub(12, "MERGED")];
  const parts = issueParts(null, subIssues);
  assert.deepEqual([parts.open, parts.total], [[], 0]);
});

test("an issue with no criteria section and only closed sub-issues has no parts at all", () => {
  assert.deepEqual(issueParts("texto sem caixas", [sub(11, "CLOSED", "COMPLETED")]), { boxes: [], open: [], total: 0, done: 0 });
  assert.deepEqual(issueParts(undefined, []), { boxes: [], open: [], total: 0, done: 0 });
});

test("boxes already read count the same way as a body", () => {
  const boxes = [
    { text: "S1. Uma.", checked: true, blocked: null },
    { text: "S2. Outra.", checked: true, blocked: null },
  ];
  const parts = partsOf(boxes, [sub(11, "OPEN"), sub(12, "CLOSED", "COMPLETED")]);
  assert.deepEqual([parts.boxes.length, parts.open.map((s) => s.number), parts.done, parts.total], [2, [11], 2, 3]);
});
