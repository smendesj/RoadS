import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUsage, type UsageOptions } from "./usage-aggregate.ts";
import { parseUsageLine, type UsageEvent } from "./usage-parse.ts";
import { GEOCLOUD_RULE } from "./usage-scope.ts";
import { formatClock, formatTokens, formatUsageReport } from "./usage-report.ts";
import { OTHER_CWD, SENTINEL, assistantLine, source, userLine } from "./usage-fixtures.ts";

const at = (hhmm: string, day = "2026-09-28", seconds = "00") => `${day}T${hhmm}:${seconds}-03:00`;
const A = source("aaaa1111-0000-4000-8000-00000000000a");
const B = source("bbbb2222-0000-4000-8000-00000000000b");

const events = (src: typeof A, ...lines: string[]): UsageEvent[] =>
  lines.map((line) => parseUsageLine(line, src, { repos: GEOCLOUD_RULE.repos })!);

const report = (list: UsageEvent[], extra: Partial<UsageOptions> = {}) =>
  formatUsageReport(buildUsage(list, { from: "2026-09-28", to: "2026-09-29", now: new Date("2026-09-30T15:00:00Z"), ...extra })).join("\n");

test("big numbers are short, with a comma, as in the /stats panel", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(2_500), "2,5k");
  assert.equal(formatTokens(45_600), "45,6k");
  assert.equal(formatTokens(7_800_000), "7,8M");
  assert.equal(formatTokens(12_300_000_000), "12,3B");
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(999_999), "1M", "never '1000k'");
});

test("clock times are São Paulo times, whatever the zone of the machine", () => {
  assert.equal(formatClock("2026-09-29T02:30:00.000Z"), "23:30");
  assert.equal(formatClock("2026-09-29T12:05:59.000Z"), "09:05");
});

test("the table has a line per day with sessions, first and last prompt, messages and tokens", () => {
  const text = report(
    events(
      A,
      userLine({ at: at("09:00") }),
      assistantLine({ at: at("09:03"), id: "m1", usage: [10, 10, 1_000_000, 0] }),
      userLine({ at: at("15:30") }),
      assistantLine({ at: at("15:31"), id: "m2", usage: [10, 10, 1_000, 0] })
    )
  );
  assert.match(text, /GeoCloud/);
  assert.match(text, /28\/09\/2026 a 29\/09\/2026/);
  assert.match(text, /seg 28\/09\s+09:00-15:31\s+09:00\s+15:30\s+4\s+1M/);
  assert.match(text, /ter 29\/09\s+-\s+-\s+-\s+0\s+0/, "a day without work is still a line");
  assert.match(text, /1 sessão, 4 mensagens \(2 pedidos digitados\)/);
});

test("the report says how the numbers were counted, and shows the other count", () => {
  const list = events(A, userLine({ at: at("09:00") }), assistantLine({ at: at("09:01"), id: "m1", usage: [0, 0, 100, 0] }), assistantLine({ at: at("09:01", "2026-09-28", "05"), id: "m1", usage: [0, 0, 100, 0] }));
  assert.match(report(list), /contagem real/);
  assert.match(report(list, { method: "stats" }), /contagem do \/stats/);
  assert.match(report(list, { method: "stats" }), /real: 100/);
});

test("coverage notes are printed under the table", () => {
  const text = report(events(A, userLine({ at: at("09:00") })), { notes: [{ date: "2026-09-29", text: "só celular, fora do notebook" }] });
  assert.match(text, /29\/09: só celular, fora do notebook/);
});

/** Opened elsewhere; `geo` calls on the scope and `other` elsewhere. */
function elsewhere(geo: number, other: number): UsageEvent[] {
  const calls = [
    ...Array.from({ length: geo }, () => ({ command: "git -C C:/Software/GeoCloud/GeoCloudAI status" })),
    ...Array.from({ length: other }, () => ({ command: "ls C:/Software/Elsewhere" })),
  ];
  return events(B, userLine({ at: at("10:00"), cwd: OTHER_CWD }), assistantLine({ at: at("10:01"), id: "b1", cwd: OTHER_CWD, tools: calls, usage: [1, 1, 1, 1] }));
}

test("a doubtful session is named with the reason and the way to decide", () => {
  const minority = report(elsewhere(5, 15));
  assert.match(minority, /bbbb2222/);
  assert.match(minority, /FORA/);
  assert.match(minority, /25%.*20 chamadas/);
  assert.match(minority, /--include bbbb2222/);
  assert.match(minority, /--exclude bbbb2222/);

  const majority = report(elsewhere(4, 1));
  assert.match(majority, /bbbb2222.*ENTRA/);
  assert.match(majority, /80%.*5 chamadas/);

  const inside = report(
    events(A, userLine({ at: at("09:00") }), assistantLine({ at: at("09:01"), id: "m1", tools: Array.from({ length: 10 }, () => ({ command: "ls C:/Software/Elsewhere" })) }))
  );
  assert.match(inside, /aaaa1111.*ENTRA/);
  assert.match(inside, /0%.*10 chamadas com alvo/);

  assert.match(report(events(A, userLine({ at: at("09:00") }))), /Nenhuma sessão para confirmar/);
});

test("a session the person already decided is marked as such", () => {
  const text = report(elsewhere(5, 15), { scope: { include: ["bbbb2222"] } });
  assert.match(text, /bbbb2222.*ENTRA[\s\S]*decidido por você/);
});

test("nothing of the conversations is printed", () => {
  const list = events(
    A,
    userLine({ at: at("09:00"), text: `pedido ${SENTINEL}` }),
    assistantLine({ at: at("09:01"), id: "m1", text: `resposta ${SENTINEL}`, tools: [{ command: `cat C:/Software/Elsewhere/${SENTINEL}/x.ts` }] })
  );
  assert.ok(!report([...list, ...elsewhere(5, 15)]).includes(SENTINEL));
});

test("with several projects the console shows a per-project table to check, and the totals line still adds them up", () => {
  const products = [
    { name: "Alpha", folders: ["Software/Alpha"], repos: [] },
    { name: "Beta", folders: ["Software/Beta"], repos: [] },
    { name: "Gamma", folders: ["Software/Gamma"], repos: [] },
  ];
  const mk = (src: typeof A, id: string, cwd: string, tokens: number) =>
    events(src, userLine({ at: at("09:00"), cwd }), assistantLine({ at: at("09:01"), id, cwd, usage: [tokens, 0, 0, 0] }));
  const list = [...mk(A, "m1", "C:/Software/Alpha", 1_000), ...mk(B, "m2", "C:/Software/Beta", 2_500_000), ...mk(source("cccc3333-0000-4000-8000-00000000000c"), "m3", "C:/Software/Gamma", 10)];
  const text = report(list, { products });
  assert.match(text, /Por projeto/);
  assert.match(text, /Alpha\s+1\s+2\s+1k\b/);
  assert.match(text, /Beta\s+1\s+2\s+2,5M/);
  assert.match(text, /Gamma\s+1\s+2\s+10\b/);
  assert.match(text, /Total: 3 sessões, 6 mensagens/);
  assert.match(text, /Alpha, Beta e Gamma/, "the title names the projects counted");

  // One project: no table, nothing new to read.
  assert.doesNotMatch(report(events(A, userLine({ at: at("09:00") }))), /Por projeto/);
});
