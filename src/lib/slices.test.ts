import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlices, sliceBlocks, slicesQuery, type SliceGroup } from "./slices.ts";

const URL = (n: number) => `https://github.com/Essencis-Labs/GeoCloudAI/issues/${n}`;
const sub = (number: number, state: "OPEN" | "CLOSED" = "OPEN") => ({ number, title: `Slice ${number}`, url: URL(number), state });
const parent = (number: number, nodes: ReturnType<typeof sub>[], totalCount = nodes.length) => ({
  number,
  title: `Issue ${number}`,
  url: URL(number),
  subIssues: { totalCount, nodes },
});

test("the query asks for the sub-issues of each issue of the sprint, one alias per issue", () => {
  const query = slicesQuery([10, 20]);
  assert.match(query, /i10: issue\(number: 10\)/);
  assert.match(query, /i20: issue\(number: 20\)/);
  assert.match(query, /subIssues\(first: 100\)/);
  assert.match(query, /owner: "Essencis-Labs", name: "GeoCloudAI"/);
});

test("only whole numbers get into the query, so nothing but numbers is ever sent to GitHub", () => {
  assert.doesNotMatch(slicesQuery([10, 1.5, NaN, -3, 0]), /i1\.5|NaN|i-3|i0:/);
  assert.match(slicesQuery([10, 1.5, NaN, -3, 0]), /i10:/);
});

test("the sprint's issues come back in the order of the sprint, each with its sub-issues and how many there are in all", () => {
  const data = { repository: { i2: parent(2, [sub(21), sub(22, "CLOSED")]), i1: parent(1, [sub(11)]) } };
  const groups = parseSlices(data, [1, 2]);
  assert.deepEqual(groups.map((g) => [g.parent.number, g.total, g.items.map((i) => [i.number, i.state])]), [
    [1, 1, [[11, "open"]]],
    [2, 2, [[21, "open"], [22, "closed"]]],
  ]);
  assert.deepEqual(groups[0].parent, { number: 1, title: "Issue 1", url: URL(1) });
});

test("an issue with no sub-issues, one GitHub didn't answer for, and a broken answer all leave nothing to show", () => {
  const data = { repository: { i1: parent(1, []), i2: null, i3: parent(3, [sub(31)]) } };
  assert.deepEqual(parseSlices(data, [1, 2, 3]).map((g) => g.parent.number), [3]);
  assert.deepEqual(parseSlices(null, [1]), []);
  assert.deepEqual(parseSlices({ repository: null }, [1]), []);
  assert.deepEqual(parseSlices({ repository: { i1: { number: 1 } } }, [1]), []);
});

test("more sub-issues than GitHub sent in one page still say how many there are", () => {
  const groups = parseSlices({ repository: { i1: parent(1, [sub(11)], 140) } }, [1]);
  assert.equal(groups[0].total, 140);
  assert.equal(groups[0].items.length, 1);
});

const GROUPS: SliceGroup[] = [
  {
    parent: { number: 1, title: "Issue 1", url: URL(1) },
    total: 4,
    items: [
      { number: 11, title: "Aberta sem card", url: URL(11), state: "open" },
      { number: 12, title: "Em andamento", url: URL(12), state: "open" },
      { number: 13, title: "Bloqueada", url: URL(13), state: "open" },
      { number: 14, title: "Fechada", url: URL(14), state: "closed" },
    ],
  },
];

test("each slice shows where it stands on the board, and a closed one is done whatever the board says", () => {
  const statusOf = new Map([
    [URL(12), "dev" as const],
    [URL(13), "blocker" as const],
    [URL(14), "open" as const],
  ]);
  const [block] = sliceBlocks(GROUPS, statusOf);
  assert.deepEqual(block.rows.map((r) => [r.ref, r.status, r.tone]), [
    ["#11", "A FAZER", "neutral"],
    ["#12", "EM ANDAMENTO", "brand"],
    ["#13", "BLOQUEADO", "red"],
    ["#14", "CONCLUÍDO", "green"],
  ]);
});

test("a block says what it belongs to and how many of its slices are done", () => {
  const [block] = sliceBlocks(GROUPS, new Map([[URL(12), "done" as const]]));
  assert.deepEqual({ title: block.title, ref: block.ref, url: block.url, done: block.done, total: block.total }, {
    title: "Issue 1",
    ref: "#1",
    url: URL(1),
    done: 2,
    total: 4,
  });
});

test("no groups, no blocks", () => {
  assert.deepEqual(sliceBlocks([], new Map()), []);
});
