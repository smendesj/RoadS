import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlices, partsByIssue, slicesQuery, type SliceGroup } from "./slices.ts";

const URL = (n: number) => `https://github.com/Essencis-Labs/GeoCloudAI/issues/${n}`;
const sub = (number: number, state: "OPEN" | "CLOSED" = "OPEN", stateReason: string | null = null) => ({ number, title: `Slice ${number}`, url: URL(number), state, stateReason });
const parent = (number: number, nodes: ReturnType<typeof sub>[], totalCount = nodes.length, body = "") => ({
  number,
  title: `Issue ${number}`,
  url: URL(number),
  body,
  subIssues: { totalCount, nodes },
});

test("the query asks for the sub-issues of each issue of the sprint, one alias per issue", () => {
  const query = slicesQuery([10, 20]);
  assert.match(query, /i10: issue\(number: 10\)/);
  assert.match(query, /i20: issue\(number: 20\)/);
  assert.match(query, /subIssues\(first: 100\)/);
  assert.match(query, /owner: "Essencis-Labs", name: "GeoCloudAI"/);
});

test("the query asks for the state and the reason it was closed of each sub-issue, since GitHub can't filter them", () => {
  assert.match(slicesQuery([7]), /nodes \{ number title url state stateReason \}/);
});

test("only whole numbers get into the query, so nothing but numbers is ever sent to GitHub", () => {
  assert.doesNotMatch(slicesQuery([10, 1.5, NaN, -3, 0]), /i1\.5|NaN|i-3|i0:/);
  assert.match(slicesQuery([10, 1.5, NaN, -3, 0]), /i10:/);
});

test("the sprint's issues come back in the order of the sprint, each with only its sub-issues still open", () => {
  const data = { repository: { i2: parent(2, [sub(21), sub(22, "CLOSED", "COMPLETED")]), i1: parent(1, [sub(11)]) } };
  const groups = parseSlices(data, [1, 2]);
  assert.deepEqual(groups.map((g) => [g.parent.number, g.total, g.items.map((i) => [i.number, i.state])]), [
    [1, 1, [[11, "open"]]],
    [2, 1, [[21, "open"]]],
  ]);
  assert.deepEqual(groups[0].parent, { number: 1, title: "Issue 1", url: URL(1) });
});

test("an issue with only closed sub-issues and no boxes, one GitHub didn't answer for, and a broken answer all leave nothing to show", () => {
  const data = { repository: { i1: parent(1, [sub(12, "CLOSED", "NOT_PLANNED")]), i2: null, i3: parent(3, [sub(31)]) } };
  assert.deepEqual(parseSlices(data, [1, 2, 3]).map((g) => g.parent.number), [3]);
  assert.deepEqual(parseSlices(null, [1]), []);
  assert.deepEqual(parseSlices({ repository: null }, [1]), []);
  assert.deepEqual(parseSlices({ repository: { i1: { number: 1 } } }, [1]), []);
});

test("how many sub-issues GitHub says there are no longer counts: only the parts read do", () => {
  const groups = parseSlices({ repository: { i1: parent(1, [sub(11)], 140) } }, [1]);
  assert.equal(groups[0].total, 1);
});

/* ---------- The boxes of the acceptance criteria, always ---------- */

const BODY = ["## Problema", "- [x] fora da seção", "## Critérios de aceitação", "- [x] S1. Primeira parte. Detalhe.", "- [ ] S2. Segunda parte.", "  - Bloqueada: falta a chave", "- [ ] S3. Terceira parte."].join("\n");

test("the query also asks for each issue's body, where its boxes are", () => {
  assert.match(slicesQuery([7]), /i7: issue\(number: 7\) \{ number title url body subIssues/);
});

test("every issue of the sprint keeps the boxes of its acceptance criteria, with or without sub-issues; one with neither is left out", () => {
  const data = {
    repository: {
      i7: parent(7, [], 0, BODY),
      i8: parent(8, [], 0, "texto"),
      i9: parent(9, [sub(90), sub(91, "CLOSED", "COMPLETED"), sub(92, "CLOSED", "DUPLICATE")], 3, BODY),
    },
  };
  const groups = parseSlices(data, [7, 8, 9]);
  assert.deepEqual(groups.map((g) => [g.parent.number, g.total, g.items.map((i) => i.number), g.boxes?.length ?? 0]), [
    [7, 3, [], 3],
    [9, 4, [90], 3],
  ]);
});

const CONVERTED = parseSlices(
  { repository: { i7: parent(7, [sub(71, "CLOSED", "COMPLETED"), sub(73), sub(72, "CLOSED", "NOT_PLANNED"), sub(74)], 4, BODY) } },
  [7]
);

test("an issue's rows are its boxes, in the order of the body and with no link, then its open sub-issues, each with its link", () => {
  const parts = partsByIssue(CONVERTED, new Map([[URL(73), "dev" as const]])).get(7);
  assert.deepEqual(parts?.rows.map((r) => [r.title, r.status, r.tone, r.url, r.ref]), [
    ["S1. Primeira parte.", "DONE", "green", null, ""],
    ["S2. Segunda parte.", "BLOCKER", "red", null, ""],
    ["S3. Terceira parte.", "OPEN", "neutral", null, ""],
    ["Slice 74", "OPEN", "neutral", URL(74), "#74"],
    ["Slice 73", "DEVELOPMENT", "brand", URL(73), "#73"],
  ]);
});

test("the count is the parts by the rule: three boxes with one ticked and two open sub-issues is 1 of 5", () => {
  const parts = partsByIssue(CONVERTED, new Map([[URL(74), "done" as const]])).get(7);
  assert.deepEqual([parts?.done, parts?.total], [1, 5]);
});

test("a snapshot written before the rule changed still hides and leaves uncounted the sub-issues it had as closed", () => {
  const old: SliceGroup[] = [
    {
      parent: { number: 1, title: "Issue 1", url: URL(1) },
      total: 3,
      items: [
        { number: 11, title: "Aberta", url: URL(11), state: "open" },
        { number: 12, title: "Fechada", url: URL(12), state: "closed" },
        { number: 13, title: "Fechada também", url: URL(13), state: "closed" },
      ],
    },
  ];
  const parts = partsByIssue(old, new Map()).get(1);
  assert.deepEqual([parts?.rows.map((r) => r.ref), parts?.done, parts?.total], [["#11"], 0, 1]);
});

test("each issue's parts are found by its number; an issue with none has no entry", () => {
  const parts = partsByIssue([...CONVERTED, ...parseSlices({ repository: { i5: parent(5, [sub(51)]) } }, [5])], new Map());
  assert.deepEqual([...parts.keys()].sort(), [5, 7]);
  assert.equal(parts.get(6), undefined);
  assert.equal(partsByIssue([], new Map()).size, 0);
});
