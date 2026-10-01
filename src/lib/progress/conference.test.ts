import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoverageGap, DayUsage, UsageModel } from "../progress-report.ts";
import { clockSP, conferenceRows, dayLabel, sessionSpan, totalTokens } from "./conference.ts";

const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const day = (date: string, over: Partial<DayUsage> = {}): DayUsage => ({
  date,
  sessions: [],
  firstPromptAt: null,
  lastPromptAt: null,
  messages: 0,
  tokens: none,
  hourly: Array(24).fill(0),
  ...over,
});

// Three São Paulo days: Mon 05/01, Tue 06/01, Wed 07/01 of 2026 (the window ends at the start of Thursday).
const model = (days: DayUsage[], over: Partial<UsageModel> = {}): UsageModel => ({
  scope: "GeoCloud",
  window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-08T00:00:00-03:00" },
  generatedAt: "2026-01-08T09:00:00-03:00",
  totals: { sessions: 0, messages: 0, activeDays: 0, tokens: none },
  byModel: [],
  favoriteModel: null,
  peakHour: null,
  days,
  ...over,
});

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/* ---------- one row per day ---------- */

test("every day of the window has a row, in order, and a day with no session keeps its row with zeros", () => {
  const rows = conferenceRows(model([day("2026-01-06", { messages: 40, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } })]));
  assert.deepEqual(rows.map((r) => r.date), ["2026-01-05", "2026-01-06", "2026-01-07"]);
  assert.deepEqual(rows[0], { date: "2026-01-05", sessions: [], firstPromptAt: null, lastPromptAt: null, messages: 0, tokens: 0 });
  assert.deepEqual(rows[2], { date: "2026-01-07", sessions: [], firstPromptAt: null, lastPromptAt: null, messages: 0, tokens: 0 });
});

test("a day row carries its sessions, first and last prompt, messages and total tokens (cache included)", () => {
  const [row] = conferenceRows(
    model(
      [
        day("2026-01-05", {
          sessions: [
            { start: "2026-01-05T17:00:00Z", end: "2026-01-05T20:30:00Z", messages: 30, tokens: 900 },
            { start: "2026-01-05T12:10:00Z", end: "2026-01-05T14:00:00Z", messages: 20, tokens: 600 },
          ],
          firstPromptAt: "2026-01-05T12:10:00Z",
          lastPromptAt: "2026-01-05T20:25:00Z",
          messages: 50,
          tokens: { input: 100, output: 200, cacheRead: 3000, cacheWrite: 40 },
        }),
      ],
      { window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-06T00:00:00-03:00" } }
    )
  );
  assert.deepEqual(row, {
    date: "2026-01-05",
    sessions: [
      { start: "2026-01-05T12:10:00Z", end: "2026-01-05T14:00:00Z" },
      { start: "2026-01-05T17:00:00Z", end: "2026-01-05T20:30:00Z" },
    ],
    firstPromptAt: "2026-01-05T12:10:00Z",
    lastPromptAt: "2026-01-05T20:25:00Z",
    messages: 50,
    tokens: 3340,
  });
  assert.equal(totalTokens({ input: 100, output: 200, cacheRead: 3000, cacheWrite: 40 }), 3340);
});

test("the window is half-open: its end belongs to the next day, unless it falls inside that day", () => {
  assert.equal(conferenceRows(model([])).length, 3);
  const withToday = conferenceRows(model([], { window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-08T12:00:00-03:00" } }));
  assert.deepEqual(withToday.map((r) => r.date), ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
  const empty = conferenceRows(model([], { window: { start: "2026-01-05T00:00:00-03:00", end: "2026-01-05T00:00:00-03:00" } }));
  assert.deepEqual(empty, []);
});

test("a window that cannot be read still shows the days that came with data", () => {
  const rows = conferenceRows(model([day("2026-01-06", { messages: 3 })], { window: { start: "nope", end: "nada" } }));
  assert.deepEqual(rows.map((r) => [r.date, r.messages]), [["2026-01-06", 3]]);
});

test("a day with data outside the window is still listed: nothing the collector counted disappears", () => {
  const rows = conferenceRows(model([day("2026-01-02", { messages: 7 }), day("2026-01-09", { messages: 8 })]));
  assert.deepEqual(rows.map((r) => r.date), ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-09"]);
});

test("the rows are new objects: the usage is left as it was", () => {
  const usage = deepFreeze(
    model([day("2026-01-06", { sessions: [{ start: "2026-01-06T12:00:00Z", end: "2026-01-06T13:00:00Z", messages: 1, tokens: 1 }] })], {
      notes: [{ date: "2026-01-06", text: "Nota." }],
    })
  );
  const gaps = deepFreeze<CoverageGap[]>([{ at: "2026-01-06T15:00:00Z", ref: "PR 12", nearestMessageMinutes: 30 }]);
  assert.doesNotThrow(() => conferenceRows(usage, gaps));
});

/* ---------- São Paulo time ---------- */

test("hours are São Paulo hours, with midnight as 00:00", () => {
  assert.equal(clockSP("2026-01-07T02:30:00Z"), "23:30");
  assert.equal(clockSP(new Date("2026-01-06T03:00:00Z")), "00:00");
  assert.equal(clockSP("2026-01-06T15:05:00-03:00"), "15:05");
  assert.equal(clockSP("not a date"), "—");
});

test("a session is written as start–end, even across midnight", () => {
  assert.equal(sessionSpan({ start: "2026-01-06T12:10:00Z", end: "2026-01-06T14:00:00Z" }), "09:10–11:00");
  assert.equal(sessionSpan({ start: "2026-01-07T02:30:00Z", end: "2026-01-07T03:10:00Z" }), "23:30–00:10");
});

test("a session that starts at 23:30 local stays in the local day it was reported for", () => {
  const late = { start: "2026-01-07T02:30:00Z", end: "2026-01-07T03:10:00Z", messages: 5, tokens: 10 }; // 23:30–00:10 of 06/01
  const rows = conferenceRows(model([day("2026-01-06", { sessions: [late], firstPromptAt: late.start, messages: 5 })]));
  const tuesday = rows.find((r) => r.date === "2026-01-06")!;
  const wednesday = rows.find((r) => r.date === "2026-01-07")!;
  assert.deepEqual(tuesday.sessions, [{ start: late.start, end: late.end }]);
  assert.equal(sessionSpan(tuesday.sessions[0]), "23:30–00:10");
  assert.deepEqual(wednesday.sessions, []);
});

test("days read as day/month", () => {
  assert.equal(dayLabel("2026-01-06"), "06/01");
  assert.equal(dayLabel("2026-12-31"), "31/12");
});

/* ---------- notes, other counts ---------- */

test("the note of a day shows on that day only; several notes are joined; a note for a day outside has no row", () => {
  const rows = conferenceRows(
    model([day("2026-01-05", { messages: 2 })], {
      notes: [
        { date: "2026-01-06", text: "Só celular, fora do notebook." },
        { date: "2026-01-06", text: "Sessão longa na nuvem." },
        { date: "2026-02-01", text: "Fora da janela." },
      ],
    })
  );
  assert.equal(rows[0].note, undefined);
  assert.equal(rows[1].note, "Só celular, fora do notebook. · Sessão longa na nuvem.");
  assert.equal(rows[2].note, undefined);
  assert.equal(rows.length, 3);
});

test("prompts typed by the person and the other counting method travel with the row when the collector sent them", () => {
  const rows = conferenceRows(model([day("2026-01-06", { messages: 9, humanPrompts: 4, otherMethodTokens: 5000 })]));
  assert.equal(rows[1].humanPrompts, 4);
  assert.equal(rows[1].otherMethodTokens, 5000);
  assert.equal(rows[0].humanPrompts, 0, "a quiet day shows 0 where the busy ones show a count");
  assert.equal(rows[0].otherMethodTokens, 0);
});

test("when the collector did not send those counts, the rows do not invent them", () => {
  for (const row of conferenceRows(model([day("2026-01-06", { messages: 9 })]))) {
    assert.ok(!("humanPrompts" in row) && !("otherMethodTokens" in row), row.date);
  }
});

/* ---------- coverage gaps ---------- */

test("without gaps there are only day rows, and none is a warning", () => {
  assert.ok(conferenceRows(model([])).every((r) => !("warning" in r)));
  assert.equal(conferenceRows(model([]), []).length, 3);
});

test("a coverage gap becomes a warning line after the days, on its São Paulo day", () => {
  const gaps: CoverageGap[] = [
    { at: "2026-01-07T02:30:00Z", ref: "PR 21", nearestMessageMinutes: 95 }, // 23:30 of 06/01 in São Paulo
    { at: "2026-01-05T17:32:00Z", ref: "commit a1b2c3d", nearestMessageMinutes: 47.6 },
  ];
  const rows = conferenceRows(model([]), gaps);
  assert.equal(rows.length, 5);
  const [early, late] = rows.slice(3);
  assert.deepEqual(rows.slice(0, 3).map((r) => "warning" in r), [false, false, false]);

  assert.equal(early.warning, true);
  assert.equal(early.date, "2026-01-05");
  assert.deepEqual([early.sessions, early.messages, early.tokens, early.firstPromptAt], [[], 0, 0, null]);
  assert.match(early.note!, /^Aviso: /);
  assert.match(early.note!, /05\/01 às 14:32/);
  assert.match(early.note!, /commit a1b2c3d/);
  assert.match(early.note!, /48 min/);

  assert.equal(late.date, "2026-01-06", "23:30 in São Paulo is still the 6th");
  assert.match(late.note!, /06\/01 às 23:30/);
  assert.match(late.note!, /PR 21/);
  assert.match(late.note!, /95 min/);
});

test("gaps are listed by time, whatever the order they came in", () => {
  const rows = conferenceRows(model([]), [
    { at: "2026-01-07T15:00:00Z", ref: "B", nearestMessageMinutes: 60 },
    { at: "2026-01-05T15:00:00Z", ref: "A", nearestMessageMinutes: 60 },
  ]);
  assert.deepEqual(rows.slice(3).map((r) => r.note!.includes("(A)")), [true, false]);
});

test("a gap with no Claude message at all in the period says exactly that", () => {
  const [gap] = conferenceRows(model([]), [{ at: "2026-01-06T15:00:00Z", ref: "PR 7", nearestMessageMinutes: null }]).slice(3);
  assert.match(gap.note!, /nenhuma mensagem do Claude/);
  assert.doesNotMatch(gap.note!, /null|NaN/);
});

test("a gap line keeps the reference short and on one line, and a date that cannot be read does not break the table", () => {
  const rows = conferenceRows(model([]), [
    { at: "2026-01-06T15:00:00Z", ref: `linha um\nlinha dois ${"x".repeat(200)}`, nearestMessageMinutes: 10 },
    { at: "quando?", ref: "PR 9", nearestMessageMinutes: 10 },
  ]);
  const [long, unreadable] = rows.slice(3);
  assert.ok(!long.note!.includes("\n"));
  assert.ok(long.note!.length < 300);
  assert.equal(unreadable.date, "");
  assert.match(unreadable.note!, /data desconhecida/);
});
