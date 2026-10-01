import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GEOCLOUD_RULE,
  decideScope,
  mergeOverrides,
  readOverrides,
  readProducts,
  scopeMatcher,
  type ProductRule,
  type SessionFacts,
  type ToolTally,
} from "./usage-scope.ts";

const matcher = scopeMatcher();
const IN = "C:\\Software\\GeoCloud\\GeoCloudAI";
const OUT = "C:\\Software\\Elsewhere\\App";

const facts = (over: Omit<Partial<SessionFacts>, "tools"> & { tools?: Partial<ToolTally> } = {}): SessionFacts => ({
  id: "aaaa1111-0000-4000-8000-000000000001",
  startCwd: IN,
  lines: 100,
  scopeLines: 100,
  ...over,
  tools: { scope: 0, other: 0, both: 0, none: 0, noneInScopeCwd: 0, total: 0, ...over.tools },
});

test("a working directory is in scope only under the scope folder, on any drive, with any separators", () => {
  for (const cwd of ["C:\\Software\\GeoCloud\\GeoCloudAI", "c:/software/geocloud/geocloudai/wt", "D:\\Software\\GeoCloud", "C:\\Software\\GeoCloud\\"]) {
    assert.equal(matcher.inCwd(cwd), true, cwd);
  }
  for (const cwd of ["C:\\Software\\GeoCloudOther\\x", "C:\\Software\\RoadS", "C:\\Users\\someone\\GeoCloud", "", null, undefined]) {
    assert.equal(matcher.inCwd(cwd), false, String(cwd));
  }
});

test("a tool call points at the scope, elsewhere, both, or nowhere", () => {
  const repo = GEOCLOUD_RULE.repos[0];
  assert.equal(matcher.classify({ roots: ["C:/Software/GeoCloud/GeoCloudAI"], repos: [] }), "scope");
  assert.equal(matcher.classify({ roots: [], repos: [repo] }), "scope");
  assert.equal(matcher.classify({ roots: ["C:/Software/RoadS"], repos: [] }), "other");
  assert.equal(matcher.classify({ roots: ["C:/Software/RoadS", "C:/Software/GeoCloud/GeoCloudAI"], repos: [] }), "both");
  assert.equal(matcher.classify({ roots: ["C:/Software/RoadS"], repos: [repo] }), "both");
  assert.equal(matcher.classify({ roots: [], repos: [] }), "none");
});

test("a session opened in the scope folder belongs to the scope", () => {
  const d = decideScope(facts(), matcher);
  assert.equal(d.include, true);
  assert.equal(d.borderline, false);
  assert.equal(d.basis, "cwd");
  assert.equal(d.forced, null);
});

test("a session that starts elsewhere but spends most lines in the scope folder still belongs to it", () => {
  assert.equal(decideScope(facts({ startCwd: OUT, scopeLines: 50 }), matcher).include, true);
  assert.equal(decideScope(facts({ startCwd: OUT, scopeLines: 49 }), matcher).include, false);
});

test("in the scope folder but working on something else: kept, and flagged to confirm (needs 10+ explicit calls, under 25% on scope)", () => {
  const flagged = decideScope(facts({ tools: { other: 8, scope: 2, total: 10 } }), matcher);
  assert.deepEqual([flagged.include, flagged.borderline, flagged.explicitCalls, flagged.explicitShare], [true, true, 10, 0.2]);
  assert.equal(decideScope(facts({ tools: { other: 7, scope: 3, total: 10 } }), matcher).borderline, false, "30% is enough");
  assert.equal(decideScope(facts({ tools: { other: 9, total: 9 } }), matcher).borderline, false, "9 calls is too little to judge");
  assert.equal(decideScope(facts({ tools: { other: 10, total: 10 } }), matcher).borderline, true);
});

test("opened elsewhere but most tool calls touch the scope: included, and flagged to confirm", () => {
  const d = decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 3, both: 1, other: 1, total: 5 } }), matcher);
  assert.deepEqual([d.include, d.borderline, d.basis], [true, true, "tools_majority"]);
  // Exactly half is not "most"; fewer than five calls is not enough to say anything.
  assert.equal(decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 5, other: 5, total: 10 } }), matcher).include, false);
  assert.equal(decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 4, total: 4 } }), matcher).include, false);
});

test("calls without a target made from the scope folder count as scope calls", () => {
  const d = decideScope(facts({ startCwd: OUT, scopeLines: 10, lines: 100, tools: { none: 8, noneInScopeCwd: 8, other: 2, total: 10 } }), matcher);
  assert.equal(d.effectiveShare, 0.8);
  assert.equal(d.include, true);
});

test("opened elsewhere with a real minority of scope calls: left out, but listed to confirm", () => {
  const d = decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 5, other: 15, total: 20 } }), matcher);
  assert.deepEqual([d.include, d.borderline, d.basis, d.effectiveShare], [false, true, "tools_minority", 0.25]);
  // Under 15%, or under five scope calls, is just background noise.
  assert.deepEqual(decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 5, other: 35, total: 40 } }), matcher).borderline, false);
  const quiet = decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 4, other: 6, total: 10 } }), matcher);
  assert.deepEqual([quiet.include, quiet.borderline, quiet.basis], [false, false, "outside"]);
});

test("the person's decision wins over the rule, by id prefix, and exclude wins over include", () => {
  const minority = facts({ id: "bbbb2222-1111", startCwd: OUT, scopeLines: 0, tools: { scope: 5, other: 15, total: 20 } });
  const forcedIn = decideScope(minority, matcher, { include: ["bbbb2222"] });
  assert.deepEqual([forcedIn.include, forcedIn.forced, forcedIn.borderline], [true, "include", true]);
  const forcedOut = decideScope(facts({ id: "aaaa1111-2222" }), matcher, { exclude: ["AAAA1111"] });
  assert.deepEqual([forcedOut.include, forcedOut.forced], [false, "exclude"]);
  const both = decideScope(facts({ id: "aaaa1111-2222" }), matcher, { include: ["aaaa1111"], exclude: ["aaaa1111"] });
  assert.equal(both.include, false);
  // Somebody else's id changes nothing.
  assert.equal(decideScope(facts({ id: "aaaa1111-2222" }), matcher, { exclude: ["cccc3333"] }).include, true);
});

test("decisions come from a small file or from the command line, and the command line wins", () => {
  assert.deepEqual(readOverrides({ include: ["bbbb2222"], exclude: ["aaaa1111", "cccc3333"] }), {
    include: ["bbbb2222"],
    exclude: ["aaaa1111", "cccc3333"],
  });
  assert.deepEqual(readOverrides({}), { include: [], exclude: [] });
  assert.throws(() => readOverrides({ include: "bbbb2222" }), /include/);
  assert.throws(() => readOverrides({ exclude: [42] }), /exclude/);
  assert.throws(() => readOverrides({ exclude: ["ab"] }), /ab/, "a prefix this short would match half the sessions");
  assert.throws(() => readOverrides([]), /objeto/);

  const merged = mergeOverrides(
    { include: ["aaaa1111", "bbbb2222"], exclude: ["cccc3333"] },
    { include: ["cccc3333"], exclude: ["aaaa1111"] }
  );
  assert.deepEqual(merged, { include: ["bbbb2222", "cccc3333"], exclude: ["aaaa1111"] });
});

/* ---------- several connected projects ---------- */

const ALPHA = "C:\\Software\\Alpha";
const BETA = "D:\\Work\\Beta";
const products: ProductRule[] = [
  { name: "Alpha", folders: ["Software/Alpha"], repos: ["Example-Org/Alpha"] },
  { name: "Beta", folders: ["Work/Beta", "Work/Beta-tools"], repos: [] },
  { name: "Gamma", folders: ["Software/Gamma"], repos: ["Example-Org/Gamma"] },
];
const three = scopeMatcher(products);

test("with several projects, a working directory is in scope under the folder of ANY of them, and knows which", () => {
  assert.equal(three.productOfCwd(`${ALPHA}\\wt\\issue-1`), 0);
  assert.equal(three.productOfCwd(`${BETA}`), 1);
  assert.equal(three.productOfCwd("d:/work/beta-tools/x"), 1, "a second folder of the same project");
  assert.equal(three.productOfCwd("C:/Software/Gamma"), 2);
  assert.equal(three.inCwd("C:/Software/Gamma/app"), true);
  // Another project's folder, or a folder that only starts like one of ours, stays out.
  for (const cwd of ["C:\\Software\\Delta", "C:\\Software\\AlphaOther", "D:\\Work\\BetaX", "", null]) {
    assert.equal(three.productOfCwd(cwd), -1, String(cwd));
    assert.equal(three.inCwd(cwd), false, String(cwd));
  }
});

test("tool calls are judged against every project, and say which ones they touch", () => {
  assert.equal(three.classify({ roots: ["C:/Software/Alpha"], repos: [] }), "scope");
  assert.equal(three.classify({ roots: [], repos: ["Example-Org/Gamma"] }), "scope");
  assert.equal(three.classify({ roots: ["C:/Software/Delta"], repos: [] }), "other");
  assert.equal(three.classify({ roots: ["C:/Software/Delta", "D:/Work/Beta"], repos: [] }), "both");
  assert.deepEqual(three.touched({ roots: ["C:/Software/Alpha", "D:/Work/Beta", "C:/Software/Delta"], repos: ["Example-Org/Gamma"] }), [0, 1, 2]);
  assert.deepEqual(three.touched({ roots: ["C:/Software/Delta"], repos: [] }), []);
});

test("the rule over three projects: opened in any of them is in; a session of a fourth project stays out; include/exclude still win", () => {
  assert.equal(decideScope(facts({ startCwd: BETA }), three).include, true);
  assert.equal(decideScope(facts({ startCwd: `${ALPHA}\\wt` }), three).basis, "cwd");
  const fourth = facts({ id: "dddd4444-0", startCwd: "C:\\Software\\Delta", scopeLines: 0, tools: { other: 20, total: 20 } });
  const out = decideScope(fourth, three);
  assert.deepEqual([out.include, out.borderline, out.basis], [false, false, "outside"]);
  assert.equal(decideScope(fourth, three, { include: ["dddd4444"] }).include, true);
  assert.equal(decideScope(facts({ startCwd: BETA, id: "eeee5555-0" }), three, { exclude: ["eeee5555"] }).include, false);
  // Opened elsewhere, most explicit calls on the three projects together: in, and flagged.
  const wander = decideScope(facts({ startCwd: OUT, scopeLines: 0, tools: { scope: 5, other: 1, total: 6 } }), three);
  assert.deepEqual([wander.include, wander.borderline, wander.basis], [true, true, "tools_majority"]);
});

test("scope.json products: valid content becomes rules; absent means the default; malformed content is refused in Portuguese", () => {
  assert.equal(readProducts({ include: [] }), undefined);
  const rules = readProducts({
    products: [
      { name: "  Alpha ", roots: ["C:\\Software\\Alpha", "c:/Software/Alpha-extra/"], repos: ["Example-Org/Alpha"] },
      { name: "Beta", roots: ["D:\\Work\\Beta"] },
    ],
  });
  assert.deepEqual(rules, [
    { name: "Alpha", folders: ["Software/Alpha", "Software/Alpha-extra"], repos: ["Example-Org/Alpha"] },
    { name: "Beta", folders: ["Work/Beta"], repos: [] },
  ]);

  const bad = (products: unknown, message: RegExp): void => assert.throws(() => readProducts({ products }), message);
  bad("Alpha", /«products»/);
  bad([], /«products»/);
  bad([null], /projeto 1/);
  bad([{ name: "", roots: ["C:\\Software\\A"] }], /nome/);
  bad([{ name: "   ", roots: ["C:\\Software\\A"] }], /nome/);
  bad([{ name: "x".repeat(61), roots: ["C:\\Software\\A"] }], /60/);
  bad([{ name: 7, roots: ["C:\\Software\\A"] }], /nome/);
  bad([{ name: "A" }], /«roots»/);
  bad([{ name: "A", roots: [] }], /«roots»/);
  bad([{ name: "A", roots: ["relative/path"] }], /absoluto/);
  bad([{ name: "A", roots: [""] }], /absoluto/);
  bad([{ name: "A", roots: ["C:\\\\"] }], /absoluto/); // a bare drive would swallow every session
  bad([{ name: "A", roots: [5] }], /absoluto/);
  bad([{ name: "A", roots: ["C:\\Software\\A"], repos: ["not a repo"] }], /repos/);
  bad([{ name: "A", roots: ["C:\\Software\\A"] }, { name: "a", roots: ["C:\\Software\\B"] }], /repetido/);
  bad(Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, roots: [`C:\\Software\\P${i}`] })), /8/);
});

test("a project named GeoCloud without its own repos list gets the known GeoCloud repository", () => {
  const [geo, other] = readProducts({ products: [{ name: "geocloud", roots: ["C:/Software/GeoCloud"] }, { name: "Beta", roots: ["C:/Software/Beta"] }] })!;
  assert.deepEqual(geo.repos, GEOCLOUD_RULE.repos);
  assert.deepEqual(other.repos, []);
  assert.deepEqual(readProducts({ products: [{ name: "GeoCloud", roots: ["C:/Software/GeoCloud"], repos: ["Example-Org/X"] }] })![0].repos, ["Example-Org/X"]);
});
