import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UsageModel } from "../progress-report.ts";
import { OTHER_CWD, SENTINEL, assistantLine, userLine } from "./usage-fixtures.ts";

const SCRIPT = fileURLToPath(new URL("../../../scripts/progress/usage.ts", import.meta.url));
const at = (hhmm: string, day = "2026-09-28", seconds = "00") => `${day}T${hhmm}:${seconds}-03:00`;

const A = "aaaa1111-0000-4000-8000-00000000000a";
const B = "bbbb2222-0000-4000-8000-00000000000b";
const D = "dddd4444-0000-4000-8000-00000000000d";

/** A made-up ~/.claude with three sessions, a subagent, and the files a collector must step around. */
function fakeClaudeDir(): { dir: string; root: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-cli-"));
  const root = path.join(dir, "claude");
  const project = path.join(root, "projects", "C--Software-Demo");
  mkdirSync(path.join(project, A, "subagents", "workflows", "w1"), { recursive: true });
  const put = (file: string, lines: string[], tail = "") => writeFileSync(path.join(project, file), lines.join("\n") + "\n" + tail);

  // In scope. The first answer is written as two lines, like Claude Code does while it streams.
  put(
    `${A}.jsonl`,
    [
      userLine({ at: at("09:00"), text: `Pedido ${SENTINEL}` }),
      assistantLine({ at: at("09:01", "2026-09-28", "01"), id: "m1", usage: [10, 5, 100, 5], text: SENTINEL }),
      assistantLine({ at: at("09:01", "2026-09-28", "02"), id: "m1", usage: [10, 20, 100, 5] }),
      userLine({ at: at("09:02"), toolResult: SENTINEL }),
      assistantLine({ at: at("09:03"), id: "m2", usage: [1, 2, 3, 4], tools: [{ command: `echo ${SENTINEL}` }] }),
    ],
    '{"type":"user","timestamp":"2026-09-28T09:0' // a line still being written: must be tolerated
  );
  put(path.join(A, "subagents", "agent-1.jsonl"), [assistantLine({ at: at("09:02", "2026-09-28", "30"), id: "s1", usage: [5, 5, 50, 0] })]);
  put(path.join(A, "subagents", "workflows", "w1", "agent-2.jsonl"), [assistantLine({ at: at("09:04"), id: "w1", usage: [900, 900, 900, 900] })]);
  // Opened elsewhere, no GeoCloud in sight: out, not even doubtful.
  put(`${B}.jsonl`, [userLine({ at: at("10:00"), cwd: OTHER_CWD }), assistantLine({ at: at("10:01"), id: "b1", cwd: OTHER_CWD, usage: [1, 1, 1, 1] })]);
  // Opened elsewhere, 5 of 20 tool calls on GeoCloud: out, but doubtful.
  const calls = [
    ...Array.from({ length: 5 }, () => ({ command: "git -C C:/Software/GeoCloud/GeoCloudAI status" })),
    ...Array.from({ length: 15 }, () => ({ command: "ls C:/Software/Elsewhere" })),
  ];
  put(`${D}.jsonl`, [userLine({ at: at("11:00"), cwd: OTHER_CWD }), assistantLine({ at: at("11:01"), id: "d1", cwd: OTHER_CWD, tools: calls, usage: [2, 2, 2, 2] })]);
  writeFileSync(path.join(project, "empty.jsonl"), "");
  writeFileSync(path.join(project, "notes.txt"), SENTINEL);
  return { dir, root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const everything = (dir: string, out: string, err: string): string => {
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
  return [out, err, ...files(dir).filter((f) => !f.includes(`${path.sep}projects${path.sep}`) && !f.endsWith("notes.txt")).map((f) => readFileSync(f, "utf8"))].join("\n");
};

test("the collector reads a fake ~/.claude and writes usage.json, activity.json and the review of doubtful sessions", () => {
  const fake = fakeClaudeDir();
  try {
    const r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-29", "--root", fake.root]);
    assert.equal(r.code, 0, r.err);

    const outDir = path.join(fake.dir, ".frontlights", "progress");
    const usage = readJson<UsageModel>(path.join(outDir, "usage.json"));
    assert.equal(usage.scope, "GeoCloud");
    assert.equal(usage.method, "real");
    assert.deepEqual(usage.window, { start: "2026-09-28T00:00:00-03:00", end: "2026-09-30T00:00:00-03:00" });
    assert.ok(!Number.isNaN(Date.parse(usage.generatedAt)));
    assert.deepEqual(usage.days.map((d) => d.date), ["2026-09-28", "2026-09-29"]);
    for (const day of usage.days) {
      assert.equal(day.hourly.length, 24);
      assert.deepEqual(Object.keys(day.tokens).sort(), ["cacheRead", "cacheWrite", "input", "output"]);
    }
    // Real: m1 once (135), m2 (10), the subagent's answer (60); the workflow file and the other sessions are out.
    assert.deepEqual(usage.totals, { sessions: 1, messages: 4, humanPrompts: 1, activeDays: 1, tokens: { input: 16, output: 27, cacheRead: 153, cacheWrite: 9 } });
    assert.deepEqual(usage.byModel.map((m) => [m.model, m.messages]), [["Opus 5.5", 3]]);
    assert.equal(usage.favoriteModel, "Opus 5.5");
    assert.equal(usage.peakHour, 9);
    assert.equal(usage.days[0].firstPromptAt, new Date(at("09:00")).toISOString());
    assert.equal(usage.days[0].sessions.length, 1);
    assert.equal(usage.days[0].otherMethodTokens, 325);

    const activity = readJson<string[]>(path.join(outDir, "activity.json"));
    assert.ok(Array.isArray(activity) && activity.length >= 4 && activity.every((m) => m.endsWith(":00.000Z")));
    assert.ok(activity.includes(new Date(at("09:01")).toISOString()));
    assert.ok(!activity.includes(new Date(at("10:00")).toISOString()), "the session of another folder is not scope activity");

    const review = readJson<{ borderline: { id: string; included: boolean }[]; sessions: unknown[] }>(path.join(outDir, "scope-review.json"));
    assert.deepEqual(review.borderline.map((s) => [s.id, s.included]), [["dddd4444", false]]);
    assert.equal(review.sessions.length, 3);

    // The table the person checks before trusting the numbers, and the doubtful session, in Portuguese.
    assert.match(r.out, /28\/09/);
    assert.match(r.out, /09:00-09:03/);
    assert.match(r.out, /dddd4444/);
    assert.match(r.out, /--include dddd4444/);
    assert.match(r.out, /usage\.json/);
    assert.ok(!everything(fake.dir, r.out, r.err).includes(SENTINEL), "nothing of the conversations may leak");
  } finally {
    fake.cleanup();
  }
});

test("--method stats counts every line, as the /stats panel does", () => {
  const fake = fakeClaudeDir();
  try {
    const r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--method", "stats", "--out", path.join(fake.dir, "out")]);
    assert.equal(r.code, 0, r.err);
    const usage = readJson<UsageModel>(path.join(fake.dir, "out", "usage.json"));
    assert.equal(usage.method, "stats");
    // 5 main lines; m1 counted on both of its lines.
    assert.equal(usage.totals.messages, 5);
    assert.deepEqual(usage.totals.tokens, { input: 26, output: 32, cacheRead: 253, cacheWrite: 14 });
    assert.equal(usage.days[0].otherMethodTokens, 205);
  } finally {
    fake.cleanup();
  }
});

test("the person's decisions, from scope.json and from the command line, change who is in", () => {
  const fake = fakeClaudeDir();
  try {
    const out = path.join(fake.dir, "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "scope.json"), JSON.stringify({ include: ["dddd4444"], exclude: ["aaaa1111"] }));
    let r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--out", out]);
    assert.equal(r.code, 0, r.err);
    let usage = readJson<UsageModel>(path.join(out, "usage.json"));
    assert.equal(usage.totals.sessions, 1);
    assert.equal(usage.totals.humanPrompts, 1, "the doubtful session is now in, the first one is out");
    assert.match(r.out, /decidido por você/);

    // The command line wins over the file.
    r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--out", out, "--include", "aaaa1111", "--exclude", "dddd4444"]);
    assert.equal(r.code, 0, r.err);
    usage = readJson<UsageModel>(path.join(out, "usage.json"));
    assert.equal(usage.totals.sessions, 1);
    assert.equal(usage.totals.messages, 4);
  } finally {
    fake.cleanup();
  }
});

test("coverage notes come from --note and from notes.json, for the days of the window", () => {
  const fake = fakeClaudeDir();
  try {
    const out = path.join(fake.dir, "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "notes.json"), JSON.stringify([{ date: "2026-09-29", text: "nota do arquivo" }, { date: "2026-01-01", text: "de outra época" }]));
    const r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-29", "--root", fake.root, "--out", out, "--note", "2026-09-28=só celular, fora do notebook"]);
    assert.equal(r.code, 0, r.err);
    const usage = readJson<UsageModel>(path.join(out, "usage.json"));
    assert.deepEqual(usage.notes, [
      { date: "2026-09-28", text: "só celular, fora do notebook" },
      { date: "2026-09-29", text: "nota do arquivo" },
    ]);
  } finally {
    fake.cleanup();
  }
});

test("the title of the usage picture comes from --label or from usageLabel in config.json, the option winning", () => {
  const fake = fakeClaudeDir();
  try {
    const out = path.join(fake.dir, "out");
    mkdirSync(out);
    const base = ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--out", out];
    const label = (): string | undefined => readJson<UsageModel>(path.join(out, "usage.json")).label;

    assert.equal(run(fake.dir, base).code, 0);
    assert.equal(label(), undefined, "neither given: no title");

    writeFileSync(path.join(out, "config.json"), JSON.stringify({ usageLabel: "  Example config - AI usage " }));
    assert.equal(run(fake.dir, base).code, 0);
    assert.equal(label(), "Example config - AI usage");

    assert.equal(run(fake.dir, [...base, "--label", "Example - AI usage"]).code, 0);
    assert.equal(label(), "Example - AI usage", "the option wins over the file");

    assert.equal(run(fake.dir, [...base, "--label", "   "]).code, 0);
    assert.equal(label(), "Example config - AI usage", "a blank option counts as not given");

    writeFileSync(path.join(out, "config.json"), "{ not json");
    const broken = run(fake.dir, base);
    assert.equal(broken.code, 2);
    assert.match(broken.err, /config\.json/);
  } finally {
    fake.cleanup();
  }
});

test("a bad command line stops with a message in Portuguese and writes nothing", () => {
  const fake = fakeClaudeDir();
  try {
    const base = ["--root", fake.root, "--out", path.join(fake.dir, "out")];
    const cases: [string[], RegExp][] = [
      [[], /--from/],
      [["--from", "ontem", "--to", "2026-09-29"], /--from/],
      [["--from", "2026-09-30", "--to", "2026-09-28"], /--to/],
      [["--from", "2026-09-28", "--to", "2026-09-29", "--method", "tanto-faz"], /--method/],
      [["--from", "2026-09-28", "--to", "2026-09-29", "--note", "sem-data"], /--note/],
      [["--from", "2026-09-28", "--to", "2026-09-29", "--exclude", "ab"], /ab/],
      [["--from", "2026-09-28", "--to", "2026-09-29", "--root", path.join(fake.dir, "nao-existe")], /projects/],
    ];
    for (const [args, expected] of cases) {
      const withBase = args.includes("--root") ? [...args, "--out", path.join(fake.dir, "out")] : [...args, ...base];
      const r = run(fake.dir, withBase);
      assert.equal(r.code, 2, `${args.join(" ")}\n${r.out}${r.err}`);
      assert.match(r.err, expected, args.join(" "));
    }
    assert.throws(() => readdirSync(path.join(fake.dir, "out")), /ENOENT/, "nothing written");
  } finally {
    fake.cleanup();
  }
});

test("--start/--end cut the window at instants: usage.json carries exactly that window and only what is inside it", () => {
  const fake = fakeClaudeDir();
  try {
    // The cut is at 09:02 on 28/09: the request at 09:00 and its answer at 09:01 belong to the previous report.
    const r = run(fake.dir, ["--start", "2026-09-28T12:02:00Z", "--end", "2026-09-29T00:00:00-03:00", "--root", fake.root]);
    assert.equal(r.code, 0, r.err);
    const usage = readJson<UsageModel>(path.join(fake.dir, ".frontlights", "progress", "usage.json"));
    assert.deepEqual(usage.window, { start: "2026-09-28T09:02:00-03:00", end: "2026-09-29T00:00:00-03:00" });
    assert.deepEqual(usage.days.map((d) => d.date), ["2026-09-28"]);
    // Left: the subagent's answer (09:02:30) and m2 (09:03); no typed request.
    assert.deepEqual(usage.totals, { sessions: 1, messages: 2, humanPrompts: 0, activeDays: 1, tokens: { input: 6, output: 7, cacheRead: 53, cacheWrite: 4 } });
    assert.equal(usage.days[0].firstPromptAt, null);
    assert.match(r.out, /28\/09\/2026 09:02 a 29\/09\/2026 00:00 \(o fim não entra\)/);
  } finally {
    fake.cleanup();
  }
});

test("--start/--end mixed with --from/--to, half a pair, or a bad instant stop the run with a clear message", () => {
  const fake = fakeClaudeDir();
  try {
    const out = path.join(fake.dir, "out");
    const cases: [string[], RegExp][] = [
      [["--from", "2026-09-28", "--to", "2026-09-29", "--start", "2026-09-28T09:02:00-03:00", "--end", "2026-09-29T00:00:00-03:00"], /não os dois juntos/],
      [["--start", "2026-09-28T09:02:00-03:00"], /--start e --end andam juntos/],
      [["--start", "2026-09-28T09:02:00", "--end", "2026-09-29T00:00:00-03:00"], /--start: instante inválido/],
      [["--start", "2026-09-28T09:02:00-03:00", "--end", "2026-09-28T09:02:00-03:00"], /--end precisa ser depois de --start/],
    ];
    for (const [args, expected] of cases) {
      const r = run(fake.dir, [...args, "--root", fake.root, "--out", out]);
      assert.equal(r.code, 2, `${args.join(" ")}\n${r.out}${r.err}`);
      assert.match(r.err, expected, args.join(" "));
    }
    assert.throws(() => readdirSync(out), /ENOENT/, "nothing written");
  } finally {
    fake.cleanup();
  }
});

/** A made-up ~/.claude with one session in each of three made-up projects, plus one of a fourth. */
function threeProjectsDir(): { dir: string; root: string; out: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-cli-3p-"));
  const root = path.join(dir, "claude");
  const project = path.join(root, "projects", "C--Software-Demo");
  mkdirSync(project, { recursive: true });
  const out = path.join(dir, "out");
  mkdirSync(out);
  const session = (id: string, cwd: string, hhmm: string, tokens: number, tools: unknown[] = []) =>
    writeFileSync(
      path.join(project, `${id}.jsonl`),
      [
        userLine({ at: at(hhmm), cwd, text: `Pedido ${SENTINEL}` }),
        assistantLine({ at: at(hhmm, "2026-09-28", "10"), id: `m-${id}`, cwd, usage: [tokens, 0, 0, 0], text: SENTINEL, tools }),
      ].join("\n") + "\n"
    );
  session("aaaa1111-0000-4000-8000-00000000000a", "C:/Software/Alpha/app", "09:00", 100);
  session("bbbb2222-0000-4000-8000-00000000000b", "C:/Software/Beta", "10:00", 2000);
  session("cccc3333-0000-4000-8000-00000000000c", "C:/Software/Gamma/wt/issue-1", "11:00", 30000);
  session("dddd4444-0000-4000-8000-00000000000d", "C:/Software/Delta", "12:00", 400000);
  // Opened in the fourth project's folder, but every call points at Gamma: in, flagged, Gamma's.
  session(
    "eeee5555-0000-4000-8000-00000000000e",
    "C:/Software/Delta",
    "13:00",
    5000,
    Array.from({ length: 6 }, () => ({ command: "git -C C:/Software/Gamma status" }))
  );
  writeFileSync(
    path.join(out, "scope.json"),
    JSON.stringify({
      products: [
        { name: "Alpha", roots: ["C:/Software/Alpha"] },
        { name: "Beta", roots: ["C:/Software/Beta"] },
        { name: "Gamma", roots: ["C:/Software/Gamma"] },
      ],
      include: [],
      exclude: [],
    })
  );
  return { dir, root, out, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("three projects in scope.json: their use is summed, listed in usage.json and printed per project, and nothing leaks", () => {
  const fake = threeProjectsDir();
  try {
    const r = run(fake.dir, ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--out", fake.out]);
    assert.equal(r.code, 0, r.err);
    const usage = readJson<UsageModel>(path.join(fake.out, "usage.json"));
    assert.equal(usage.scope, "GeoCloud");
    assert.deepEqual(usage.products, ["Alpha", "Beta", "Gamma"]);
    // Four sessions in (Alpha, Beta, Gamma, and the one working on Gamma); the fourth project's own is out.
    assert.deepEqual([usage.totals.sessions, usage.totals.humanPrompts, usage.totals.messages], [4, 4, 8]);
    assert.equal(usage.totals.tokens.input, 100 + 2000 + 30000 + 5000);

    assert.match(r.out, /Alpha, Beta e Gamma/);
    assert.match(r.out, /Por projeto/);
    assert.match(r.out, /Alpha\s+1\s+2\s+100\b/);
    assert.match(r.out, /Beta\s+1\s+2\s+2k\b/);
    assert.match(r.out, /Gamma\s+2\s+4\s+35k\b/);
    assert.match(r.out, /eeee5555/, "the session opened elsewhere is listed to confirm");

    // The coverage gaps are about the issues' project (the first one here, GeoCloud being absent).
    const activity = readJson<string[]>(path.join(fake.out, "activity.json"));
    assert.ok(activity.includes(new Date(at("09:00")).toISOString()));
    assert.ok(!activity.includes(new Date(at("10:00")).toISOString()) && !activity.includes(new Date(at("11:00")).toISOString()));

    const review = readJson<{ sessions: { id: string; product: string | null }[] }>(path.join(fake.out, "scope-review.json"));
    assert.deepEqual(
      review.sessions.map((s) => [s.id, s.product]),
      [["aaaa1111", "Alpha"], ["bbbb2222", "Beta"], ["cccc3333", "Gamma"], ["dddd4444", null], ["eeee5555", "Gamma"]]
    );
    assert.ok(!everything(fake.dir, r.out, r.err).includes(SENTINEL), "nothing of the conversations may leak");
  } finally {
    fake.cleanup();
  }
});

test("a malformed products list in scope.json stops the run with a message in Portuguese and writes nothing", () => {
  const fake = threeProjectsDir();
  try {
    const base = ["--from", "2026-09-28", "--to", "2026-09-28", "--root", fake.root, "--out", fake.out];
    const cases: [unknown, RegExp][] = [
      [[{ name: "", roots: ["C:/Software/Alpha"] }], /nome/],
      [[{ name: "Alpha", roots: [] }], /roots/],
      [[{ name: "Alpha", roots: ["Software/Alpha"] }], /absoluto/],
      [Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, roots: [`C:/Software/P${i}`] })), /8/],
    ];
    for (const [products, expected] of cases) {
      writeFileSync(path.join(fake.out, "scope.json"), JSON.stringify({ products }));
      const r = run(fake.dir, base);
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.err, expected);
    }
    assert.deepEqual(readdirSync(fake.out), ["scope.json"], "nothing written");
  } finally {
    fake.cleanup();
  }
});
