import { test } from "node:test";
import assert from "node:assert/strict";
import type { DayUsage, ProgressContent } from "../progress-report.ts";
import { combineWeek, groupByWeek, weekHeadline, weekMeetingOf, weekOfPeriod, weekStartOf, type WeekReport } from "./week.ts";
import { entry, sampleContent } from "./visual-fixture.ts";

// Made-up data only: invented deliveries and round numbers.

/* ---------- which week a report belongs to ---------- */

test("an instant falls in the week (Monday to Sunday, São Paulo time) of its day", () => {
  assert.equal(weekStartOf("2026-09-28T03:00:00.000Z"), "2026-09-28"); // Monday 00:00 in São Paulo
  assert.equal(weekStartOf("2026-10-01T03:00:00.000Z"), "2026-09-28"); // Thursday
  assert.equal(weekStartOf("2026-10-05T02:30:00.000Z"), "2026-09-28"); // Sunday 23:30 in São Paulo
  assert.equal(weekStartOf("2026-10-05T03:00:00.000Z"), "2026-10-05"); // the next Monday
  assert.equal(weekStartOf("2027-01-01T12:00:00.000Z"), "2026-12-28"); // across the year
});

test("a report belongs to the week its period ends in, not the one it starts in", () => {
  // Monday to Wednesday and Thursday to Friday: both end in the week they start in, as before.
  assert.equal(weekOfPeriod({ period_start: "2026-09-28T03:00:00.000Z", period_end: "2026-10-01T03:00:00.000Z" }), "2026-09-28");
  assert.equal(weekOfPeriod({ period_start: "2026-10-01T03:00:00.000Z", period_end: "2026-10-03T03:00:00.000Z" }), "2026-09-28");
  // Starts on the Saturday (where the report before it stopped) and ends on Wednesday evening: the Wednesday's week.
  assert.equal(weekOfPeriod({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-08T00:30:00.000Z" }), "2026-10-05");
});

test("the end of a period is exclusive: a period that stops at Monday 00:00 belongs to the week that just ended", () => {
  assert.equal(weekOfPeriod({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-05T03:00:00.000Z" }), "2026-09-28");
  assert.equal(weekOfPeriod({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-05T03:00:00.001Z" }), "2026-10-05");
  // A period with no length still has a week: the one it sits in.
  assert.equal(weekOfPeriod({ period_start: "2026-10-05T12:00:00.000Z", period_end: "2026-10-05T12:00:00.000Z" }), "2026-10-05");
});

/* ---------- the Monday scrum where a report is presented ---------- */

test("the meeting of a report is the Monday after the week it belongs to", () => {
  // Monday to Wednesday of one week is presented at the Monday scrum of the next.
  assert.equal(weekMeetingOf({ period_start: "2026-09-28T03:00:00.000Z", period_end: "2026-10-01T03:00:00.000Z" }), "2026-10-05");
  assert.equal(weekMeetingOf({ period_start: "2026-10-01T03:00:00.000Z", period_end: "2026-10-03T03:00:00.000Z" }), "2026-10-05");
});

test("a period that starts on the weekend is presented by the week it ENDS in, never the one it starts in", () => {
  // Saturday to Wednesday evening: it starts in the week of 28/09 but belongs to 05/10, so the meeting is 12/10.
  assert.equal(weekMeetingOf({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-08T00:30:00.000Z" }), "2026-10-12");
  // The Friday report of that week, Thursday to Friday, goes to the very same meeting.
  assert.equal(weekMeetingOf({ period_start: "2026-10-08T03:00:00.000Z", period_end: "2026-10-10T00:00:00.000Z" }), "2026-10-12");
  // Friday to Tuesday, across the Sunday.
  assert.equal(weekMeetingOf({ period_start: "2026-10-02T03:00:00.000Z", period_end: "2026-10-07T01:00:00.000Z" }), "2026-10-12");
});

test("the end is exclusive here too: a period that stops at Monday 00:00 is presented at that very Monday", () => {
  assert.equal(weekMeetingOf({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-05T03:00:00.000Z" }), "2026-10-05");
  assert.equal(weekMeetingOf({ period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-05T03:00:00.001Z" }), "2026-10-12");
});

test("São Paulo's calendar decides, whatever offset the period is written in", () => {
  // 23:00 in São Paulo on a Monday is already Tuesday in UTC.
  assert.equal(weekMeetingOf({ period_start: "2026-10-05T03:00:00.000Z", period_end: "2026-10-06T02:00:00.000Z" }), "2026-10-12");
  assert.equal(weekMeetingOf({ period_start: "2026-10-05T00:00:00-03:00", period_end: "2026-10-06T23:00:00-03:00" }), "2026-10-12");
  // Sunday 23:59:59 in São Paulo still belongs to the week that ends there.
  assert.equal(weekMeetingOf({ period_start: "2026-10-01T03:00:00.000Z", period_end: "2026-10-05T02:59:59.000Z" }), "2026-10-05");
});

test("the meeting crosses the year", () => {
  assert.equal(weekMeetingOf({ period_start: "2026-12-28T03:00:00.000Z", period_end: "2026-12-31T03:00:00.000Z" }), "2027-01-04");
});

test("the meeting is always a Monday, for every day a period can end on", () => {
  for (let day = 0; day < 120; day++) {
    const end = new Date(Date.parse("2026-10-01T15:00:00.000Z") + day * 24 * 60 * 60 * 1000).toISOString();
    const meeting = weekMeetingOf({ period_start: "2026-09-28T03:00:00.000Z", period_end: end });
    assert.match(meeting, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${meeting}T00:00:00Z`).getUTCDay(), 1, `${end} -> ${meeting}`);
  }
});

test("the sent list is grouped by week, newest first, each group labelled Monday to Friday", () => {
  const sent = [
    { id: "c", period_start: "2026-10-03T03:00:00.000Z", period_end: "2026-10-08T00:30:00.000Z" },
    { id: "b", period_start: "2026-10-01T03:00:00.000Z", period_end: "2026-10-03T03:00:00.000Z" },
    { id: "a", period_start: "2026-09-28T03:00:00.000Z", period_end: "2026-10-01T03:00:00.000Z" },
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

test("each delivery appears once, as the latest report of the week that showed it left it, edits included", () => {
  const week = combineWeek([report("sexta", {}, { "entry:gc-4:title": { value: "Entrega quatro, editada" } }), report("quarta")]);
  const byIssue = Object.fromEntries(week.content.entries.map((e) => [e.issue, e]));
  assert.deepEqual(Object.keys(byIssue).map(Number).sort(), [1, 2, 3, 4]);
  assert.equal(byIssue[1].status, "concluido"); // em andamento on Wednesday, done on Friday
  assert.equal(byIssue[1].title, "Entrega um na sexta");
  assert.equal(byIssue[2].status, "concluido"); // only on Wednesday: kept as it was
  assert.equal(byIssue[3].hidden, false); // shown on Wednesday: hidden on Friday does not take it out of the week
  assert.equal(byIssue[3].title, "Entrega três"); // ...and it is Wednesday's copy
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
  assert.equal(combineWeek([report("quarta"), blank]).content.headline, "Na semana, 2 entregas concluídas, 1 em validação e 1 em andamento.");
});

test("a delivery shown in any report of the week is on show, as the latest report that showed it left it", () => {
  // The collector puts on Friday, hidden, what was delivered before Friday's period: Wednesday showed it.
  const fri = report("sexta");
  fri.content.entries.push(entry(2, "concluido", { title: "Entrega dois, escondida na sexta", hidden: true }));
  const week = combineWeek([report("quarta"), fri]);
  const two = week.content.entries.find((e) => e.issue === 2);
  assert.equal(two?.hidden, false);
  assert.equal(two?.title, "Entrega dois");
  // Hidden in every report of the week: left out.
  const wed = report("quarta");
  wed.content.entries[2].hidden = true; // #3, hidden on Wednesday too (it is hidden on Friday already)
  assert.equal(combineWeek([wed, report("sexta")]).content.entries.find((e) => e.issue === 3)?.hidden, true);
  // Blank on Friday (no title, no sentence): not shown there either, so Wednesday's copy wins.
  const blankFriday = report("sexta");
  blankFriday.content.entries[0] = entry(1, "concluido", { title: "", summary: "" });
  const blank = combineWeek([report("quarta"), blankFriday]);
  assert.equal(blank.content.entries.find((e) => e.issue === 1)?.title, "Entrega um na quarta");
});

test("the opening line is generated from the deliveries on show, never taken from one of the e-mails", () => {
  const week = combineWeek([report("quarta"), report("sexta")]);
  // On show: 1 and 2 done, 3 in validation (shown on Wednesday), 4 under way.
  assert.equal(week.content.headline, "Na semana, 2 entregas concluídas, 1 em validação e 1 em andamento.");
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

const coverOf = (issue: number, remaining: number) => ({
  issue,
  title: `Capa ${issue}`,
  summary: "",
  issues: { total: 3, done: 1 },
  parts: { total: 10, done: 10 - remaining, remaining },
  open: [{ issue: issue + 1, title: `Entrega aberta ${issue + 1}` }],
});

test("what is left of the sprint is the latest report's picture, never a sum; reports with no block give the week none", () => {
  const wed = report("quarta", { sprint: { epics: [coverOf(900, 7), coverOf(950, 5)], totals: { covers: 2, remainingParts: 12 } } });
  const fri = report("sexta", { sprint: { epics: [coverOf(900, 4)], totals: { covers: 1, remainingParts: 4 } } });
  const week = combineWeek([fri, wed]); // any order in: the dates decide which one is the latest
  assert.deepEqual(week.content.sprint, fri.content.sprint);
  // The week's "concluído" is made from its deliveries, each issue once, as already done.
  assert.equal(combineWeek([wed, report("sexta")]).content.sprint, undefined); // the latest has no block: the week has none
  assert.equal("sprint" in combineWeek([report("quarta"), report("sexta")]).content, false);
});
