import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTRY_STATUSES,
  PRODUCTION_ORIGIN,
  STATUS_LABEL,
  defaultReportWindow,
  isSendDay,
  isShareToken,
  localDay,
  nextReportWindow,
  shotPath,
  visualPath,
} from "./progress-report.ts";

test("every status has a label in Portuguese", () => {
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...ENTRY_STATUSES].sort());
  assert.equal(STATUS_LABEL.concluido, "Concluído");
  assert.equal(STATUS_LABEL.em_validacao, "Em validação");
});

test("the local day follows São Paulo, not UTC", () => {
  // 02:30 UTC on 01/10 is still 23:30 of 30/09 in São Paulo.
  assert.equal(localDay("2026-10-01T02:30:00Z"), "2026-09-30");
  assert.equal(localDay(new Date("2026-10-01T03:00:00Z")), "2026-10-01");
});

test("the next window starts at the end of the last sent report and stops before today", () => {
  const thursday = new Date("2026-10-01T15:00:00Z"); // 12:00 in São Paulo
  assert.deepEqual(nextReportWindow(null, thursday), {
    start: "2026-09-28T00:00:00-03:00",
    end: "2026-10-01T00:00:00-03:00",
  });
  assert.deepEqual(nextReportWindow("2026-10-01T00:00:00-03:00", new Date("2026-10-03T15:00:00Z")), {
    start: "2026-10-01T00:00:00-03:00",
    end: "2026-10-03T00:00:00-03:00",
  });
});

test("the window can include today, and never ends before it starts", () => {
  const now = new Date("2026-10-01T15:00:00Z");
  assert.equal(nextReportWindow(null, now, { includeToday: true }).end, "2026-10-01T15:00:00.000Z");
  // Nothing happened since the last report (it ended today at 00:00): an empty window, not a negative one.
  const w = nextReportWindow("2026-10-01T00:00:00-03:00", now);
  assert.equal(w.start, w.end);
});

test("the report goes out Wednesday and Friday at the end of the day, so that day's work is in it", () => {
  assert.ok(isSendDay("2026-09-30T20:00:00-03:00")); // Wednesday evening
  assert.ok(isSendDay("2026-10-02T17:00:00-03:00")); // Friday
  assert.ok(!isSendDay("2026-10-01T12:00:00-03:00")); // Thursday
  assert.ok(!isSendDay("2026-10-03T09:00:00-03:00")); // Saturday
  // 21:30 in São Paulo on Wednesday is already Thursday in UTC: the day is São Paulo's.
  assert.ok(isSendDay("2026-10-01T00:30:00Z"));
});

test("the default window includes today on a send day and stops before today otherwise", () => {
  // Friday 17:00: the previous report ended Thursday 00:00 (it was the Wednesday one, sent late), and Friday counts.
  const friday = new Date("2026-10-02T20:00:00Z"); // 17:00 in São Paulo
  const w = defaultReportWindow("2026-10-01T00:00:00-03:00", friday);
  assert.deepEqual(w, { start: "2026-10-01T00:00:00-03:00", end: "2026-10-02T20:00:00.000Z" });
  // The Wednesday report sent late, on Thursday: Monday to Wednesday, Thursday is left for Friday's.
  assert.deepEqual(defaultReportWindow(null, new Date("2026-10-01T15:00:00Z")), {
    start: "2026-09-28T00:00:00-03:00",
    end: "2026-10-01T00:00:00-03:00",
  });
  // Prepared on Saturday for Friday's report: all of Friday is in.
  assert.equal(defaultReportWindow("2026-10-01T00:00:00-03:00", new Date("2026-10-03T12:00:00Z")).end, "2026-10-03T00:00:00-03:00");
});

test("a share token is a uuid and nothing else", () => {
  assert.ok(isShareToken("0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4"));
  assert.ok(!isShareToken("0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c"));
  assert.ok(!isShareToken("../../etc/passwd"));
  assert.ok(!isShareToken(""));
});

test("image paths carry the token and a version that changes when the draft is pushed again", () => {
  const token = "0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const v1 = visualPath(token, "2026-10-01T15:00:00Z");
  const v2 = visualPath(token, "2026-10-01T15:05:00Z");
  assert.match(v1, /^\/api\/progress-report\/0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4\/[0-9a-z]+\/visual\.png$/);
  assert.notEqual(v1, v2);
  assert.match(shotPath(token, "2026-10-01T15:00:00Z", 2, "jpg"), /\/shot-2\.jpg$/);
});

test("e-mail links always point at the production site", () => {
  assert.equal(PRODUCTION_ORIGIN, "https://roads-psi.vercel.app");
});
