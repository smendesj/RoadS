import { test } from "node:test";
import assert from "node:assert/strict";
import type { DayUsage, ProgressContent } from "../progress-report.ts";
import { combineWeek, groupByWeek, weekHeadline, weekStartOf, type WeekReport } from "./week.ts";
import { entry, sampleContent } from "./visual-fixture.ts";

// Made-up data only: invented deliveries and round numbers.

/* ---------- which week a report belongs to ---------- */

test("a report belongs to the week (Monday to Sunday, São Paulo time) of the day its period starts", () => {
  assert.equal(weekStartOf("2026-09-28T03:00:00.000Z"), "2026-09-28"); // Monday 00:00 in São Paulo
  assert.equal(weekStartOf("2026-10-01T03:00:00.000Z"), "2026-09-28"); // Thursday
  assert.equal(weekStartOf("2026-10-05T02:30:00.000Z"), "2026-09-28"); // Sunday 23:30 in São Paulo
  assert.equal(weekStartOf("2026-10-05T03:00:00.000Z"), "2026-10-05"); // the next Monday
  assert.equal(weekStartOf("2027-01-01T12:00:00.000Z"), "2026-12-28"); // across the year
});

test("the sent list is grouped by week, newest first, each group labelled Monday to Friday", () => {
  const sent = [
    { id: "c", period_start: "2026-10-05T03:00:00.000Z" },
    { id: "b", period_start: "2026-10-01T03:00:00.000Z" },
    { id: "a", period_start: "2026-09-28T03:00:00.000Z" },
  ];
  const groups = groupByWeek(sent);
  assert.deepEqual(
    groups.map((g) => [g.start, g.label, g.items.map((i) => i.id)]),
    [
      ["2026-10-05", "Semana de 05/10 a 09/10", ["c"]],
      ["2026-09-28", "Semana de 28/09 a 02/10", ["b", "a"]],
    ]
  );
  assert.deepEqual(groupByWeek([]), []);
});

/* ---------- the opening line ---------- */

test("the opening line counts what the week delivered, and says nothing it did not count", () => {
  assert.equal(weekHeadline({ concluido: 5, em_validacao: 2, em_andamento: 1, bloqueado: 0 }), "Na semana, 5 entregas concluídas, 2 em validação e 1 em andamento.");
  assert.equal(weekHeadline({ concluido: 1, em_validacao: 0, em_andamento: 0, bloqueado: 1 }), "Na semana, 1 entrega concluída e 1 bloqueada.");
  assert.equal(weekHeadline({ concluido: 0, em_validacao: 0, em_andamento: 3, bloqueado: 0 }), "Na semana, 3 entregas em andamento.");
  assert.equal(weekHeadline({ concluido: 0, em_validacao: 0, em_andamento: 0, bloqueado: 0 }), "Na semana, nenhuma entrega mudou de situação.");
});

/* ---------- putting the week together ---------- */

const day = (date: string, messages: number, model = "modelo-a"): DayUsage => ({
  date,
  sessions: [{ start: `${date}T09:00:00-03:00`, end: `${date}T12:00:00-03:00`, messages, tokens: messages * 100 }],
  firstPromptAt: `${date}T09:00:00-03:00`,
  lastPromptAt: `${date}T12:00:00-03:00`,
  messages,
  humanPrompts: messages / 10,
  tokens: { input: messages, output: messages * 2, cacheRead: messages * 10, cacheWrite: messages * 3 },
  hourly: Array.from({ length: 24 }, (_, h) => (h === (model === "modelo-a" ? 10 : 15) ? messages : 0)),
});

function report(kind: "quarta" | "sexta", patch: Partial<ProgressContent> = {}, overrides: WeekReport["overrides"] = {}): WeekReport {
  const wed = kind === "quarta";
  const window = wed ? { start: "2026-09-28T00:00:00-03:00", end: "2026-10-01T00:00:00-03:00" } : { start: "2026-10-01T00:00:00-03:00", end: "2026-10-03T00:00:00-03:00" };
  const days = wed ? [day("2026-09-28", 100), day("2026-09-29", 50)] : [day("2026-10-01", 30, "modelo-b")];
  const content = sampleContent(2, {
    window,
    headline: `Abertura escrita na ${kind}.`,
    entries: wed
      ? [entry(1, "em_andamento", { title: "Entrega um na quarta" }), entry(2, "concluido", { title: "Entrega dois" }), entry(3, "em_validacao", { title: "Entrega três" })]
      : [entry(1, "concluido", { title: "Entrega um na sexta" }), entry(4, "em_andamento", { title: "Entrega quatro" }), entry(3, "em_validacao", { hidden: true })],
    internal: { count: wed ? 2 : 3, text: `Ajustes internos da ${kind}.` },
    difficulties: [{ id: "d1", text: `Dificuldade da ${kind}.`, needs: "Uma decisão." }],
    nextSteps: [{ id: "n1", text: `Passo da ${kind}.` }],
    shots: [{ id: "shot-1", caption: `Print da ${kind}`, mime: "image/png", issue: wed ? 2 : 1, path: `${(wed ? "a" : "b").repeat(64)}.png` }],
    access: { account: "leitor@example.test", password: "Senha-temp-1" },
    ...patch,
  });
  content.usage = {
    ...content.usage,
    window,
    label: "Uso de IA (exemplo)",
    days,
    totals: { sessions: days.length, messages: days.reduce((t, d) => t + d.messages, 0), humanPrompts: 0, activeDays: days.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    byModel: [{ model: wed ? "modelo-a" : "modelo-b", messages: days.reduce((t, d) => t + d.messages, 0), input: 10, output: 20, cacheRead: wed ? 30 : 9000, cacheWrite: 40 }],
  };
  return { content, overrides, share_token: wed ? "token-quarta" : "token-sexta", pushed_at: wed ? "2026-09-30T20:00:00Z" : "2026-10-02T20:00:00Z", period_start: new Date(window.start).toISOString() };
}

test("each delivery appears once, as the latest report of the week left it, edits included", () => {
  const week = combineWeek([report("sexta", {}, { "entry:gc-4:title": { value: "Entrega quatro, editada" } }), report("quarta")]);
  const byIssue = Object.fromEntries(week.content.entries.map((e) => [e.issue, e]));
  assert.deepEqual(Object.keys(byIssue).map(Number).sort(), [1, 2, 3, 4]);
  assert.equal(byIssue[1].status, "concluido"); // em andamento on Wednesday, done on Friday
  assert.equal(byIssue[1].title, "Entrega um na sexta");
  assert.equal(byIssue[2].status, "concluido"); // only on Wednesday: kept as it was
  assert.equal(byIssue[3].hidden, true); // hidden on Friday wins
  assert.equal(byIssue[4].title, "Entrega quatro, editada");
});

test("difficulties and next steps come from the latest report; the internal work and Claude's usage add up", () => {
  const week = combineWeek([report("quarta"), report("sexta")]); // any order in, the dates decide
  assert.deepEqual(week.content.difficulties.map((d) => d.text), ["Dificuldade da sexta."]);
  assert.deepEqual(week.content.nextSteps.map((n) => n.text), ["Passo da sexta."]);
  assert.equal(week.content.internal.count, 5);
  assert.match(week.content.internal.text, /5 ajustes internos/);
  const u = week.content.usage;
  assert.deepEqual(u.days.map((d) => d.date), ["2026-09-28", "2026-09-29", "2026-10-01"]);
  assert.equal(u.totals.messages, 180);
  assert.equal(u.totals.activeDays, 3);
  assert.equal(u.totals.sessions, 3); // what the two e-mails said: 2 + 1
  assert.deepEqual(u.totals.tokens, { input: 180, output: 360, cacheRead: 1800, cacheWrite: 540 });
  assert.deepEqual(u.byModel.map((m) => [m.model, m.messages]).sort(), [["modelo-a", 150], ["modelo-b", 30]]);
  assert.equal(u.favoriteModel, "modelo-b"); // the most tokens, like the collector (not the most messages)
  assert.equal(u.peakHour, 10);
  assert.equal(u.label, "Uso de IA (exemplo)");
  assert.deepEqual(week.content.window, { start: "2026-09-28T00:00:00-03:00", end: "2026-10-03T00:00:00-03:00" });
});

test("the week counts sessions as the e-mails did, not the pieces a session leaves on each day", () => {
  // One session that ran past midnight: the collector leaves a piece of it on each day, and counts it once.
  const wed = report("quarta");
  wed.content.usage.days[1].sessions.push({ start: "2026-09-29T23:00:00-03:00", end: "2026-09-29T23:59:00-03:00", messages: 1, tokens: 10 });
  wed.content.usage.totals.sessions = 2;
  assert.equal(combineWeek([wed, report("sexta")]).content.usage.totals.sessions, 3);
});

test("the internal work of a report whose line the user removed from the e-mail does not come back", () => {
  const cleared = combineWeek([report("quarta", {}, { internal: { value: "" } }), report("sexta")]);
  assert.equal(cleared.content.internal.count, 3);
  assert.equal(cleared.content.internal.text, "Também houve 3 ajustes internos de organização.");
  const one = combineWeek([report("quarta", { internal: { count: 1, text: "Um ajuste." } }, {})]);
  assert.equal(one.content.internal.text, "Também houve 1 ajuste interno de organização.");
  const none = combineWeek([report("quarta", {}, { internal: { value: "" } })]);
  assert.deepEqual(none.content.internal, { count: 0, text: "" });
});

test("a delivery with neither title nor sentence is not on show, as in the e-mail", () => {
  const blank = report("sexta");
  blank.content.entries.push(entry(5, "concluido", { title: "", summary: "" }));
  assert.equal(combineWeek([report("quarta"), blank]).content.headline, "Na semana, 2 entregas concluídas e 1 em andamento.");
});

test("the opening line is generated from the deliveries on show, never taken from one of the e-mails", () => {
  const week = combineWeek([report("quarta"), report("sexta")]);
  // On show: 1 and 2 done, 4 under way (3 is hidden).
  assert.equal(week.content.headline, "Na semana, 2 entregas concluídas e 1 em andamento.");
});

test("the prints of both reports come along, each with the link of its own report, and no sign-in details", () => {
  const week = combineWeek([report("quarta"), report("sexta")]);
  assert.deepEqual(week.content.shots?.map((s) => [s.caption, s.issue]), [["Print da quarta", 2], ["Print da sexta", 1]]);
  assert.deepEqual(week.shotSources, [
    { token: "token-quarta", pushedAt: "2026-09-30T20:00:00Z", n: 1, ext: "png" },
    { token: "token-sexta", pushedAt: "2026-10-02T20:00:00Z", n: 1, ext: "png" },
  ]);
  assert.equal(week.content.access, undefined);
  assert.equal(week.content.gaps, undefined);
});

test("a week with a single report is that report, with the generated opening line", () => {
  const one = combineWeek([report("quarta")]);
  assert.deepEqual(one.content.entries.map((e) => e.issue), [1, 2, 3]);
  assert.equal(one.content.headline, "Na semana, 1 entrega concluída, 1 em validação e 1 em andamento.");
  assert.equal(one.content.usage.totals.messages, 150);
});
