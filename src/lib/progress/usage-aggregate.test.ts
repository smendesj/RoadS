import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUsage, type UsageOptions } from "./usage-aggregate.ts";
import { parseUsageLine, type TranscriptSource, type UsageEvent } from "./usage-parse.ts";
import { GEOCLOUD_RULE } from "./usage-scope.ts";
import type { ProductRule } from "./usage-scope.ts";
import { OTHER_CWD, SCOPE_CWD, SENTINEL, assistantLine, source, userLine } from "./usage-fixtures.ts";

const NOW = new Date("2026-09-30T15:00:00Z");
const A = source("aaaa1111-0000-4000-8000-00000000000a");
const B = source("bbbb2222-0000-4000-8000-00000000000b");
const C = source("cccc3333-0000-4000-8000-00000000000c");
const subOf = (s: TranscriptSource) => ({ ...s, kind: "subagent" as const });

/** "09:00" on 28/09 in São Paulo. */
const at = (hhmm: string, day = "2026-09-28", seconds = "00") => `${day}T${hhmm}:${seconds}-03:00`;

function events(src: TranscriptSource, ...lines: string[]): UsageEvent[] {
  return lines.map((line) => {
    const event = parseUsageLine(line, src, { repos: GEOCLOUD_RULE.repos });
    assert.ok(event, "the fixture line must parse");
    return event;
  });
}

const run = (list: UsageEvent[], extra: Partial<UsageOptions> = {}) =>
  buildUsage(list, { from: "2026-09-28", to: "2026-09-29", now: NOW, ...extra });

const total = (t: { input: number; output: number; cacheRead: number; cacheWrite: number }) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** One answer the API gave, written as the 3 lines Claude Code stores for it, plus a second answer. */
const streamed = () =>
  events(
    A,
    userLine({ at: at("09:00") }),
    assistantLine({ at: at("09:00", "2026-09-28", "10"), id: "msg_1", usage: [10, 5, 100, 20] }),
    assistantLine({ at: at("09:00", "2026-09-28", "11"), id: "msg_1", usage: [10, 20, 100, 20] }),
    assistantLine({ at: at("09:00", "2026-09-28", "12"), id: "msg_1", usage: [10, 30, 100, 20] }),
    assistantLine({ at: at("09:01"), id: "msg_2", usage: [7, 8, 90, 0] })
  );

test("real counts each answer once; stats counts every line, as the /stats panel does", () => {
  const real = run(streamed()).usage;
  assert.equal(real.method, "real");
  // Input and cache from the first line of an answer, output = the largest value among its lines.
  assert.deepEqual(real.totals.tokens, { input: 17, output: 38, cacheRead: 190, cacheWrite: 20 });
  assert.equal(real.totals.messages, 3, "1 typed request + 2 distinct answers");
  assert.equal(real.days[0].otherMethodTokens, 550);

  const stats = run(streamed(), { method: "stats" }).usage;
  assert.equal(stats.method, "stats");
  assert.deepEqual(stats.totals.tokens, { input: 37, output: 63, cacheRead: 390, cacheWrite: 60 });
  assert.equal(stats.totals.messages, 5, "every user and assistant line of the main transcript");
  assert.equal(stats.days[0].otherMethodTokens, 265);
  assert.ok(total(stats.totals.tokens) / total(real.totals.tokens) > 2, "the known inflation of the panel");
});

test("the default method is real, and the model says which one it used", () => {
  assert.equal(run(streamed()).usage.method, "real");
});

test("a minute between 21:00 and 24:00 stays on its São Paulo day, even when UTC is already tomorrow", () => {
  const list = events(A, userLine({ at: at("23:30") }), userLine({ at: at("00:30", "2026-09-29") }));
  const { days } = run(list).usage;
  assert.equal(days[0].messages, 1);
  assert.equal(days[0].hourly[23], 1);
  assert.equal(days[1].messages, 1);
  assert.equal(days[1].hourly[0], 1);
});

test("a session that crosses midnight is split by day, and stays one session", () => {
  const list = events(
    A,
    userLine({ at: at("23:50") }),
    assistantLine({ at: at("23:55"), id: "m1", usage: [1, 1, 10, 0] }),
    assistantLine({ at: at("00:10", "2026-09-29"), id: "m2", usage: [1, 1, 20, 0] }),
    assistantLine({ at: at("00:20", "2026-09-29"), id: "m3", usage: [1, 1, 30, 0] })
  );
  const { usage } = run(list);
  const [d1, d2] = usage.days;
  assert.deepEqual(d1.sessions, [
    { start: new Date(at("23:50")).toISOString(), end: new Date(at("23:55")).toISOString(), messages: 2, tokens: 12 },
  ]);
  assert.deepEqual(d2.sessions, [
    { start: new Date(at("00:10", "2026-09-29")).toISOString(), end: new Date(at("00:20", "2026-09-29")).toISOString(), messages: 2, tokens: 54 },
  ]);
  assert.equal(usage.totals.sessions, 1);
});

test("days without any work are still there, with zeros", () => {
  const { usage } = run(events(A, userLine({ at: at("09:00", "2026-09-29") })), { to: "2026-09-30" });
  assert.deepEqual(usage.days.map((d) => d.date), ["2026-09-28", "2026-09-29", "2026-09-30"]);
  const [empty] = usage.days;
  assert.deepEqual(empty, {
    date: "2026-09-28",
    sessions: [],
    firstPromptAt: null,
    lastPromptAt: null,
    messages: 0,
    humanPrompts: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    otherMethodTokens: 0,
    hourly: new Array(24).fill(0),
  });
  assert.equal(usage.totals.activeDays, 1);
});

test("the window is the São Paulo days asked for, the end exclusive", () => {
  const { usage } = run([], { from: "2026-09-28", to: "2026-09-30" });
  assert.deepEqual(usage.window, { start: "2026-09-28T00:00:00-03:00", end: "2026-10-01T00:00:00-03:00" });
  assert.equal(usage.generatedAt, NOW.toISOString());
  assert.equal(usage.scope, "GeoCloud");
  assert.deepEqual(usage.totals, { sessions: 0, messages: 0, humanPrompts: 0, activeDays: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual([usage.favoriteModel, usage.peakHour, usage.byModel], [null, null, []]);
});

test("lines outside the window are not counted", () => {
  const list = events(A, userLine({ at: at("23:59", "2026-09-27") }), userLine({ at: at("00:00", "2026-09-30") }), userLine({ at: at("12:00") }));
  assert.equal(run(list).usage.totals.messages, 1);
});

test("hourly has one bucket per São Paulo hour, with the messages of that hour", () => {
  const list = events(A, userLine({ at: at("09:05") }), userLine({ at: at("09:55") }), userLine({ at: at("14:00") }));
  const hourly = run(list, { method: "stats" }).usage.days[0].hourly;
  assert.equal(hourly.length, 24);
  assert.deepEqual([hourly[9], hourly[14], hourly.reduce((a, b) => a + b, 0)], [2, 1, 3]);
});

test("the peak hour is the hour with most messages, not the hour most sessions started", () => {
  const list = [
    ...events(A, userLine({ at: at("09:00") })),
    ...events(B, userLine({ at: at("09:30") })),
    ...events(C, userLine({ at: at("14:00") }), userLine({ at: at("14:10") }), userLine({ at: at("14:20") })),
  ];
  assert.equal(run(list, { method: "stats" }).usage.peakHour, 14);
});

test("model names are friendly, merged when two ids share a name, and listed by total tokens", () => {
  const list = events(
    A,
    userLine({ at: at("09:00") }),
    assistantLine({ at: at("09:01"), id: "m1", model: "claude-haiku-4-5-20251001", usage: [1, 1, 10, 0] }),
    assistantLine({ at: at("09:02"), id: "m2", model: "claude-haiku-4-5", usage: [1, 1, 10, 0] }),
    assistantLine({ at: at("09:03"), id: "m3", model: "claude-opus-5-5", usage: [5, 5, 1000, 0] })
  );
  const { byModel, favoriteModel } = run(list).usage;
  assert.deepEqual(byModel.map((m) => m.model), ["Opus 5.5", "Haiku 4.5"]);
  assert.deepEqual(byModel[1], { model: "Haiku 4.5", input: 2, output: 2, cacheRead: 20, cacheWrite: 0, messages: 2 });
  assert.equal(favoriteModel, "Opus 5.5");
});

test("the favorite model is the one with most total tokens, cache included, not the one that wrote most", () => {
  const list = events(
    A,
    userLine({ at: at("09:00") }),
    assistantLine({ at: at("09:01"), id: "m1", model: "claude-sonnet-5", usage: [1, 5000, 100, 0] }),
    assistantLine({ at: at("09:02"), id: "m2", model: "claude-fable-5-1", usage: [1, 10, 90000, 0] })
  );
  assert.equal(run(list).usage.favoriteModel, "Fable 5.1");
});

test("a <synthetic> answer carries no tokens and is no answer of Claude's, but the panel still counts its line", () => {
  const list = events(
    A,
    userLine({ at: at("09:00") }),
    assistantLine({ at: at("09:01"), id: "m1", model: "<synthetic>", usage: [9, 9, 9, 9] }),
    assistantLine({ at: at("09:02"), id: "m2", usage: [1, 2, 3, 4] })
  );
  const real = run(list).usage;
  assert.deepEqual(real.totals.tokens, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.deepEqual(real.byModel.map((m) => m.model), ["Opus 5.5"]);
  assert.equal(real.totals.messages, 2);
  assert.equal(run(list, { method: "stats" }).usage.totals.messages, 3);
});

test("only what the person typed is a request: first and last prompt skip commands and automatic notices", () => {
  const list = events(
    A,
    userLine({ at: at("08:00"), text: "<command-name>/clear</command-name>" }),
    userLine({ at: at("10:00"), text: "primeiro pedido" }),
    userLine({ at: at("12:00"), toolResult: "ok" }),
    userLine({ at: at("15:00"), text: "último pedido" }),
    userLine({ at: at("17:00"), text: "<task-notification>pronto</task-notification>" })
  );
  const [day] = run(list).usage.days;
  assert.equal(day.firstPromptAt, new Date(at("10:00")).toISOString());
  assert.equal(day.lastPromptAt, new Date(at("15:00")).toISOString());
  assert.equal(day.humanPrompts, 2);
  const real = run(list).usage;
  assert.equal(real.totals.humanPrompts, 2);
  assert.equal(real.totals.messages, 3, "2 typed requests + 1 command, no answers");
  assert.equal(run(list, { method: "stats" }).usage.totals.messages, 5, "the panel counts every user line");
});

test("subagent lines add tokens and answers, never messages of the panel, and never a session", () => {
  const list = [
    ...events(A, userLine({ at: at("09:00") }), assistantLine({ at: at("09:01"), id: "m1", usage: [1, 1, 10, 0] })),
    ...events(subOf(A), assistantLine({ at: at("09:02"), id: "s1", usage: [2, 2, 20, 0] }), assistantLine({ at: at("09:03"), id: "s2", usage: [3, 3, 30, 0] })),
  ];
  const stats = run(list, { method: "stats" }).usage;
  assert.equal(stats.totals.messages, 2, "only the main transcript");
  assert.equal(total(stats.totals.tokens), 12 + 24 + 36);
  const real = run(list).usage;
  assert.equal(real.totals.messages, 4, "1 request + 3 answers, subagents included");
  assert.equal(real.totals.sessions, 1);
});

test("workflow files are ignored altogether", () => {
  const list = [...events(A, userLine({ at: at("09:00") })), ...events({ ...A, kind: "workflow" }, assistantLine({ at: at("09:01"), id: "w1", usage: [100, 100, 100, 100] }))];
  const { totals } = run(list).usage;
  assert.equal(totals.messages, 1);
  assert.equal(total(totals.tokens), 0);
});

test("the same answer copied into two session files (a fork) is one answer in real, two in stats", () => {
  const line = assistantLine({ at: at("09:01"), id: "m1", requestId: "r1", usage: [10, 10, 100, 0] });
  const list = [...events(A, userLine({ at: at("09:00") }), line), ...events(B, userLine({ at: at("09:30") }), line)];
  assert.equal(total(run(list).usage.totals.tokens), 120);
  assert.equal(total(run(list, { method: "stats" }).usage.totals.tokens), 240);
  assert.equal(run(list).usage.totals.sessions, 2);
});

test("a response is told apart by its id and request id together; lines without an id each count", () => {
  const list = events(
    A,
    userLine({ at: at("09:00") }),
    assistantLine({ at: at("09:01"), id: "m1", requestId: "r1", usage: [1, 1, 1, 0] }),
    assistantLine({ at: at("09:02"), id: "m1", requestId: "r2", usage: [1, 1, 1, 0] }),
    assistantLine({ at: at("09:03"), id: null, requestId: null, usage: [1, 1, 1, 0] }),
    assistantLine({ at: at("09:04"), id: null, requestId: null, usage: [1, 1, 1, 0] })
  );
  assert.equal(run(list).usage.totals.messages, 5);
});

test("a session opened in the scope folder is in; one opened elsewhere is out, but still listed", () => {
  const list = [
    ...events(A, userLine({ at: at("09:00") })),
    ...events(B, userLine({ at: at("09:10"), cwd: OTHER_CWD }), userLine({ at: at("09:20"), cwd: OTHER_CWD })),
  ];
  const result = run(list, { method: "stats" });
  assert.equal(result.usage.totals.messages, 1);
  assert.equal(result.usage.totals.sessions, 1);
  assert.deepEqual(result.sessions.map((s) => [s.id, s.included, s.borderline]), [
    ["aaaa1111", true, false],
    ["bbbb2222", false, false],
  ]);
  assert.equal(result.sessions[1].root, "C:\\Software\\Elsewhere", "only the root of the folder, never deeper");
  assert.equal(result.sessions[1].messages, 2);
});

/** A session opened elsewhere whose assistant made `geo` calls on the scope and `other` calls elsewhere. */
function elsewhere(src: TranscriptSource, geo: number, other: number): UsageEvent[] {
  const calls = [
    ...Array.from({ length: geo }, () => ({ command: `git -C C:/Software/GeoCloud/GeoCloudAI status` })),
    ...Array.from({ length: other }, () => ({ command: `ls C:/Software/Elsewhere` })),
  ];
  return events(src, userLine({ at: at("09:00"), cwd: OTHER_CWD }), assistantLine({ at: at("09:01"), id: `m-${src.session}`, cwd: OTHER_CWD, tools: calls, usage: [1, 1, 10, 0] }));
}

test("a session opened elsewhere whose tool calls mostly touch the scope is in, and is flagged to confirm", () => {
  const result = run(elsewhere(B, 4, 1));
  assert.equal(result.usage.totals.sessions, 1);
  assert.deepEqual(result.borderline.map((s) => [s.id, s.included, s.basis]), [["bbbb2222", true, "tools_majority"]]);
});

test("a session opened elsewhere with a real minority of scope calls is out, but never dropped in silence", () => {
  const result = run(elsewhere(B, 5, 15));
  assert.equal(result.usage.totals.sessions, 0);
  assert.equal(result.usage.totals.messages, 0);
  const [flagged] = result.borderline;
  assert.deepEqual([flagged.id, flagged.included, flagged.basis, flagged.forced], ["bbbb2222", false, "tools_minority", null]);
  assert.equal(flagged.calls.total, 20);
  assert.equal(flagged.calls.scope, 5);
});

test("the person's include and exclude change the decision, by id prefix, and stay in the list", () => {
  const minority = elsewhere(B, 5, 15);
  const included = run(minority, { scope: { include: ["bbbb2222"] } });
  assert.equal(included.usage.totals.sessions, 1);
  assert.deepEqual(included.borderline.map((s) => [s.id, s.included, s.forced]), [["bbbb2222", true, "include"]]);

  const inside = events(A, userLine({ at: at("09:00") }));
  const excluded = run(inside, { scope: { exclude: ["aaaa1111"] } });
  assert.equal(excluded.usage.totals.sessions, 0);
  assert.deepEqual(excluded.sessions.map((s) => [s.id, s.included, s.forced]), [["aaaa1111", false, "exclude"]]);
});

test("a session only needs to be seen in the window to be judged; one that never touched it is not listed", () => {
  const list = events(A, userLine({ at: at("09:00", "2026-09-20") }));
  const result = run(list);
  assert.deepEqual(result.sessions, []);
});

test("the scope facts use the whole session, not just the days in the window", () => {
  // The calls that reveal what the session is about happened the day before the window.
  const calls = Array.from({ length: 6 }, () => ({ command: "git -C C:/Software/GeoCloud/GeoCloudAI status" }));
  const list = events(
    B,
    userLine({ at: at("20:00", "2026-09-27"), cwd: OTHER_CWD }),
    assistantLine({ at: at("20:01", "2026-09-27"), id: "old", cwd: OTHER_CWD, tools: calls }),
    userLine({ at: at("09:00"), cwd: OTHER_CWD })
  );
  assert.equal(run(list).usage.totals.sessions, 1);
});

test("activity minutes: distinct minutes with a message of the scope, a day of margin on each side", () => {
  const list = [
    ...events(
      A,
      userLine({ at: at("22:30", "2026-09-27", "10") }),
      userLine({ at: at("09:00", "2026-09-28", "05") }),
      assistantLine({ at: at("09:00", "2026-09-28", "50"), id: "m1" }),
      userLine({ at: at("09:01") }),
      userLine({ at: at("10:00", "2026-09-30") }),
      userLine({ at: at("10:00", "2026-09-26") })
    ),
    ...events(subOf(A), assistantLine({ at: at("11:00"), id: "s1" })),
    ...events(B, userLine({ at: at("15:00"), cwd: OTHER_CWD })),
  ];
  const { activity } = run(list);
  const minute = (iso: string) => new Date(Math.floor(Date.parse(iso) / 60_000) * 60_000).toISOString();
  assert.deepEqual(activity, [
    minute(at("22:30", "2026-09-27")),
    minute(at("09:00")),
    minute(at("09:01")),
    minute(at("11:00")),
    minute(at("10:00", "2026-09-30")),
  ]);
  assert.ok(activity.every((m) => m.endsWith(":00.000Z")));
});

test("notes about coverage are kept for the days of the window only", () => {
  const notes = [
    { date: "2026-09-29", text: "só celular, fora do notebook" },
    { date: "2026-08-01", text: "de outro relatório" },
    { date: "2026-09-29", text: "só celular, fora do notebook" },
  ];
  assert.deepEqual(run(streamed(), { notes }).usage.notes, [{ date: "2026-09-29", text: "só celular, fora do notebook" }]);
  assert.equal("notes" in run(streamed()).usage, false);
});

test("the session summary tells how much of the window each session used, by the chosen method", () => {
  const { sessions } = run(streamed());
  assert.equal(sessions.length, 1);
  const [s] = sessions;
  assert.equal(s.id, "aaaa1111");
  assert.equal(s.root, SCOPE_CWD);
  assert.deepEqual([s.messages, s.humanPrompts, s.tokens], [3, 1, 265]);
  assert.equal(s.firstAt, new Date(at("09:00")).toISOString());
  assert.equal(s.lastAt, new Date(at("09:01")).toISOString());
});

test("nothing of the conversation reaches the result", () => {
  const calls = [{ command: `cat C:/Software/Elsewhere/${SENTINEL}/x.ts`, file_path: `${OTHER_CWD}\\${SENTINEL}\\y.ts`, content: SENTINEL }];
  const list = [
    ...events(
      A,
      userLine({ at: at("09:00"), text: `pedido ${SENTINEL}`, cwd: `${SCOPE_CWD}\\${SENTINEL}` }),
      assistantLine({ at: at("09:01"), id: "m1", text: `resposta ${SENTINEL}`, tools: calls, usage: [1, 1, 1, 1] }),
      userLine({ at: at("09:02"), toolResult: `saída ${SENTINEL}` })
    ),
    ...elsewhere(B, 5, 15),
  ];
  for (const method of ["real", "stats"] as const) {
    const json = JSON.stringify(run(list, { method, scope: { include: ["bbbb2222"] } }));
    assert.ok(!json.includes(SENTINEL), `${method}: text leaked`);
    assert.ok(!json.includes("x.ts") && !json.includes("y.ts"), `${method}: a file name leaked`);
  }
});

test("the title of the usage picture is cleaned: trimmed, controls dropped, 60 characters at most, absent when empty", () => {
  const label = (raw: string | undefined) => run(streamed(), { label: raw }).usage.label;
  assert.equal(label("  Example - AI usage  "), "Example - AI usage");
  assert.equal(label("Exam\u0007ple - AI\n\t usage"), "Example - AI usage", "bell dropped, line breaks and tabs become one space");
  assert.equal(label("x".repeat(80)), "x".repeat(60));
  assert.equal(label("é".repeat(80)), "é".repeat(60));
  assert.equal(label(`${"a".repeat(59)} bbbb`), "a".repeat(59), "the cut never leaves a trailing space");
  assert.equal([...(label(`${"a".repeat(59)}😀😀`) ?? "")].length, 60, "an emoji is one character, never cut in half");
  assert.equal(label("   \n "), undefined);
  assert.equal(label(undefined), undefined);
  assert.equal("label" in run(streamed()).usage, false, "no key at all when there is no title");
  assert.deepEqual(Object.keys(run(streamed(), { label: "Example - AI usage" }).usage).slice(0, 4), ["scope", "window", "generatedAt", "label"]);
});

test("a window that makes no sense is refused", () => {
  assert.throws(() => run([], { from: "28/09/2026" }), /from/);
  assert.throws(() => run([], { to: "2026-02-31" }), /to/);
  assert.throws(() => run([], { from: "2026-09-30", to: "2026-09-28" }), /to/);
});

/* ---------- several connected projects ---------- */

const PRODUCTS: ProductRule[] = [
  { name: "Alpha", folders: ["Software/Alpha"], repos: ["Example-Org/Alpha"] },
  { name: "Beta", folders: ["Software/Beta"], repos: [] },
  { name: "Gamma", folders: ["Software/Gamma"], repos: [] },
];
const ALL_REPOS = PRODUCTS.flatMap((p) => p.repos);
const cwdOf = (name: string) => `C:/Software/${name}`;

function eventsWith(src: TranscriptSource, ...lines: string[]): UsageEvent[] {
  return lines.map((line) => {
    const event = parseUsageLine(line, src, { repos: ALL_REPOS });
    assert.ok(event, "the fixture line must parse");
    return event;
  });
}

/** One typed request and one answer of `tokens` in a session opened in `cwd`. */
const small = (src: TranscriptSource, cwd: string, hhmm: string, tokens: number, tools: unknown[] = []) =>
  eventsWith(
    src,
    userLine({ at: at(hhmm), cwd }),
    assistantLine({ at: at(hhmm, "2026-09-28", "05"), id: `m-${src.session}`, cwd, usage: [tokens, 0, 0, 0], tools })
  );

const D1 = source("dddd4444-0000-4000-8000-00000000000d");
const E1 = source("eeee5555-0000-4000-8000-00000000000e");

function threeProjects(): UsageEvent[] {
  const bashOn = (root: string) => Array.from({ length: 6 }, () => ({ command: `git -C ${root} status` }));
  return [
    ...small(A, cwdOf("Alpha"), "09:00", 100),
    ...small(B, cwdOf("Beta"), "10:00", 200),
    ...small(C, cwdOf("Gamma"), "11:00", 400),
    // Another project's session: out, not even doubtful.
    ...small(D1, cwdOf("Delta"), "12:00", 800),
    // Opened in another folder but working on Beta all the way: in, flagged, counted for Beta.
    ...small(E1, cwdOf("Delta"), "13:00", 1600, bashOn(cwdOf("Beta"))),
  ];
}

test("three connected projects: any of them is in scope, another project's session stays out, and the model lists the projects", () => {
  const r = run(threeProjects(), { products: PRODUCTS });
  assert.deepEqual(r.usage.products, ["Alpha", "Beta", "Gamma"]);
  assert.equal(r.usage.scope, "GeoCloud", "the scope stays the one of the issues");
  assert.equal(r.usage.totals.sessions, 4);
  assert.equal(r.usage.totals.humanPrompts, 4);
  assert.equal(total(r.usage.totals.tokens), 100 + 200 + 400 + 1600);
  const d = r.sessions.find((s) => s.id === "dddd4444")!;
  assert.deepEqual([d.included, d.borderline, d.product], [false, false, null]);
  const e = r.sessions.find((s) => s.id === "eeee5555")!;
  assert.deepEqual([e.included, e.borderline, e.basis, e.product], [true, true, "tools_majority", "Beta"]);
});

test("the per-project breakdown, in the order of the configuration: sessions, messages, tokens", () => {
  const r = run(threeProjects(), { products: PRODUCTS });
  assert.deepEqual(
    r.byProduct.map((p) => [p.name, p.sessions, p.messages, p.humanPrompts, p.tokens]),
    [
      ["Alpha", 1, 2, 1, 100],
      ["Beta", 2, 4, 2, 1800],
      ["Gamma", 1, 2, 1, 400],
    ]
  );
  // The projects add up to the totals the report shows.
  assert.equal(r.byProduct.reduce((n, p) => n + p.messages, 0), r.usage.totals.messages);
  assert.equal(r.byProduct.reduce((n, p) => n + p.tokens, 0), total(r.usage.totals.tokens));
});

test("a forced include with no project in sight is counted for the first project, never lost", () => {
  const r = run(threeProjects(), { products: PRODUCTS, scope: { include: ["dddd4444"] } });
  assert.equal(r.usage.totals.sessions, 5);
  assert.equal(r.byProduct.reduce((n, p) => n + p.sessions, 0), 5);
  assert.equal(r.sessions.find((s) => s.id === "dddd4444")!.product, "Alpha");
});

test("with one project the model does not list products, and the breakdown has just that one", () => {
  const r = run(threeProjects(), { products: [PRODUCTS[0]] });
  assert.equal(r.usage.products, undefined);
  assert.deepEqual(r.byProduct.map((p) => [p.name, p.sessions]), [["Alpha", 1]]);
  // Without any configuration the GeoCloud default applies, as before.
  const defaults = run(events(A, userLine({ at: at("09:00") })));
  assert.equal(defaults.usage.products, undefined);
  assert.deepEqual(defaults.byProduct.map((p) => p.name), ["GeoCloud"]);
});

test("activity (for the coverage gaps of the issues) covers only the issues' project: GeoCloud by name, else the first, or the one asked", () => {
  const minutes = (r: ReturnType<typeof run>) => new Set(r.activity);
  const m = (hhmm: string) => new Date(at(hhmm)).toISOString();
  const first = minutes(run(threeProjects(), { products: PRODUCTS }));
  assert.ok(first.has(m("09:00")) && !first.has(m("10:00")) && !first.has(m("11:00")) && !first.has(m("13:00")), "no GeoCloud among them: the first project");

  const named = [{ name: "Other", folders: ["Software/Beta"], repos: [] }, { name: "geocloud", folders: ["Software/Gamma"], repos: [] }];
  const byName = minutes(run(threeProjects(), { products: named }));
  assert.ok(byName.has(m("11:00")) && !byName.has(m("10:00")));

  const asked = minutes(run(threeProjects(), { products: PRODUCTS, activityProduct: "Beta" }));
  assert.ok(asked.has(m("10:00")) && asked.has(m("13:00")) && !asked.has(m("09:00")));
});
