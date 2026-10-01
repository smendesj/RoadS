import { test } from "node:test";
import assert from "node:assert/strict";
import { findCoverageGaps, messageTimesFromUsage } from "./gaps.ts";
import type { UsageModel } from "../progress-report.ts";

const at = (hhmm: string) => `2026-03-10T${hhmm}:00-03:00`;

test("exactly 90 minutes from a message is not a gap, 91 is", () => {
  const messages = [at("10:00")];
  assert.deepEqual(findCoverageGaps([{ at: at("11:30"), ref: "commit a1" }], messages), []);
  assert.deepEqual(findCoverageGaps([{ at: at("08:30"), ref: "commit a2" }], messages), []);
  assert.deepEqual(findCoverageGaps([{ at: at("11:31"), ref: "commit a3" }], messages), [
    { at: at("11:31"), ref: "commit a3", nearestMessageMinutes: 91 },
  ]);
  assert.equal(findCoverageGaps([{ at: at("08:29"), ref: "commit a4" }], messages)[0].nearestMessageMinutes, 91);
});

test("the nearest message wins, before or after the work", () => {
  const messages = [at("06:00"), at("12:00"), at("20:00")];
  const gaps = findCoverageGaps([{ at: at("15:00"), ref: "PR #5 mesclado" }], messages);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].nearestMessageMinutes, 180); // 12:00 is 3 h away, 20:00 is 5 h away
  assert.deepEqual(findCoverageGaps([{ at: at("12:45"), ref: "commit b1" }], messages), []);
});

test("with no messages at all, all git work is a gap", () => {
  const gaps = findCoverageGaps(
    [
      { at: at("09:00"), ref: "commit c1" },
      { at: at("09:05"), ref: "commit c2" },
    ],
    []
  );
  assert.deepEqual(gaps, [
    { at: at("09:00"), ref: "commit c1", nearestMessageMinutes: null },
    { at: at("09:05"), ref: "commit c2", nearestMessageMinutes: null },
  ]);
});

test("gaps come out in chronological order, ties broken by ref, whatever the input order", () => {
  const gaps = findCoverageGaps(
    [
      { at: at("14:00"), ref: "commit z" },
      { at: at("09:00"), ref: "commit b" },
      { at: at("09:00"), ref: "commit a" },
    ],
    []
  );
  assert.deepEqual(
    gaps.map((g) => g.ref),
    ["commit a", "commit b", "commit z"]
  );
});

test("the threshold is adjustable and the same work listed twice counts once", () => {
  const work = [
    { at: at("12:00"), ref: "commit d1" },
    { at: at("12:00"), ref: "commit d1" },
  ];
  assert.equal(findCoverageGaps(work, [at("11:00")], 30).length, 1);
  assert.equal(findCoverageGaps(work, [at("11:00")], 60).length, 0);
});

test("unreadable instants are ignored instead of poisoning the result", () => {
  assert.deepEqual(findCoverageGaps([{ at: "not a date", ref: "commit e1" }], [at("10:00")]), []);
  const gaps = findCoverageGaps([{ at: at("10:00"), ref: "commit e2" }], ["garbage", at("10:30")]);
  assert.deepEqual(gaps, []);
});

const usage = (sessions: { start: string; end: string }[], extra: Partial<UsageModel["days"][number]> = {}): UsageModel => ({
  scope: "GeoCloud",
  window: { start: "2026-03-10T00:00:00-03:00", end: "2026-03-11T00:00:00-03:00" },
  generatedAt: "2026-03-11T09:00:00-03:00",
  totals: { sessions: sessions.length, messages: 10, activeDays: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  byModel: [],
  favoriteModel: null,
  peakHour: null,
  days: [
    {
      date: "2026-03-10",
      sessions: sessions.map((s) => ({ ...s, messages: 5, tokens: 100 })),
      firstPromptAt: sessions[0]?.start ?? null,
      lastPromptAt: sessions.at(-1)?.end ?? null,
      messages: 10,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      hourly: new Array(24).fill(0),
      ...extra,
    },
  ],
});

test("a work item in the middle of a long session is covered even though no message sits exactly there", () => {
  const times = messageTimesFromUsage(usage([{ start: at("08:00"), end: at("14:00") }]));
  assert.deepEqual(findCoverageGaps([{ at: at("11:00"), ref: "commit f1" }], times), []);
  // Three hours after the session ended is a gap; its distance is measured from the session end.
  assert.deepEqual(findCoverageGaps([{ at: at("17:00"), ref: "commit f2" }], times), [
    { at: at("17:00"), ref: "commit f2", nearestMessageMinutes: 180 },
  ]);
});

test("a usage file with no sessions yields no message instants", () => {
  assert.deepEqual(messageTimesFromUsage(usage([], { firstPromptAt: null, lastPromptAt: null })), []);
});
