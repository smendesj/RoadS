import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePeriod, instantRangeLabel, parseInstant, saoPauloInstant, windowFromInstants } from "./period.ts";

// Made-up instants only.

test("an instant is read with its offset, Z included, down to the millisecond", () => {
  assert.equal(parseInstant("2026-10-07T20:05:12-03:00"), Date.parse("2026-10-07T23:05:12Z"));
  assert.equal(parseInstant("2026-10-07T23:05:12Z"), Date.parse("2026-10-07T23:05:12Z"));
  assert.equal(parseInstant("2026-10-07T23:05:12+00:00"), Date.parse("2026-10-07T23:05:12Z"));
  assert.equal(parseInstant("2026-10-08T01:35:12+05:30"), Date.parse("2026-10-07T20:05:12Z"));
  assert.equal(parseInstant("2026-10-07T20:05-03:00"), Date.parse("2026-10-07T23:05:00Z"), "seconds may be left out");
  assert.equal(parseInstant("2026-10-07T23:05:12.345Z"), Date.parse("2026-10-07T23:05:12.345Z"));
  // How the database writes a stored period (more digits, all zeros past the millisecond).
  assert.equal(parseInstant("2026-10-07T23:05:12.345000+00:00"), Date.parse("2026-10-07T23:05:12.345Z"));
  assert.equal(parseInstant("2026-10-07T23:05:12.5Z"), Date.parse("2026-10-07T23:05:12.500Z"));
});

test("an instant without offset, on a day that does not exist, or finer than a millisecond is refused", () => {
  for (const bad of [
    "2026-10-07T20:05:12", // no offset: whose 20:05?
    "2026-10-07",
    "2026-10-07 20:05:12-03:00",
    "07/10/2026 20:05",
    "2026-02-30T10:00:00Z",
    "2026-10-07T24:00:00Z",
    "2026-10-07T20:60:00Z",
    "2026-10-07T20:05:12-15:00",
    "2026-10-07T23:05:12.3456Z",
    "ontem",
    "",
  ]) {
    assert.equal(parseInstant(bad), null, bad);
  }
});

test("the window keeps the instants and writes them with -03:00", () => {
  assert.deepEqual(windowFromInstants("2026-10-07T23:05:12Z", "2026-10-09T20:10:00-03:00"), {
    ok: true,
    window: { start: "2026-10-07T20:05:12-03:00", end: "2026-10-09T20:10:00-03:00" },
  });
  // Milliseconds are kept, so the instant never moves.
  const r = windowFromInstants("2026-10-07T23:05:12.345Z", "2026-10-09T23:10:00.001+00:00");
  assert.deepEqual(r, { ok: true, window: { start: "2026-10-07T20:05:12.345-03:00", end: "2026-10-09T20:10:00.001-03:00" } });
  assert.equal(r.ok && Date.parse(r.window.start), Date.parse("2026-10-07T23:05:12.345Z"));
  assert.equal(saoPauloInstant(Date.parse("2026-10-08T02:00:00Z")), "2026-10-07T23:00:00-03:00");
});

test("an end that is not after the start, or a bad instant, is refused in Portuguese", () => {
  const same = windowFromInstants("2026-10-07T20:05:12-03:00", "2026-10-07T23:05:12Z");
  assert.equal(same.ok, false);
  assert.match(!same.ok ? same.error : "", /--end precisa ser depois de --start/);
  const backwards = windowFromInstants("2026-10-09T20:00:00-03:00", "2026-10-07T20:00:00-03:00");
  assert.equal(backwards.ok, false);
  const noOffset = windowFromInstants("2026-10-07T20:05:12", "2026-10-09T20:00:00-03:00");
  assert.match(!noOffset.ok ? noOffset.error : "", /--start: instante inválido.*deslocamento/);
  const badEnd = windowFromInstants("2026-10-07T20:05:12-03:00", "amanhã");
  assert.match(!badEnd.ok ? badEnd.error : "", /--end: instante inválido/);
});

test("days or instants, never both, and each pair whole", () => {
  assert.deepEqual(choosePeriod({ from: "2026-10-07", to: "2026-10-09" }), { ok: true, period: { kind: "days", from: "2026-10-07", to: "2026-10-09" } });
  assert.deepEqual(choosePeriod({ start: "a", end: "b" }), { ok: true, period: { kind: "instants", start: "a", end: "b" } });
  const both = choosePeriod({ from: "2026-10-07", to: "2026-10-09", start: "2026-10-07T20:05:12-03:00", end: "2026-10-09T20:00:00-03:00" });
  assert.match(!both.ok ? both.error : "", /não os dois juntos/);
  const mixed = choosePeriod({ from: "2026-10-07", end: "2026-10-09T20:00:00-03:00" });
  assert.equal(mixed.ok, false);
  const onlyStart = choosePeriod({ start: "2026-10-07T20:05:12-03:00" });
  assert.match(!onlyStart.ok ? onlyStart.error : "", /--start e --end andam juntos/);
  const onlyEnd = choosePeriod({ end: "2026-10-07T20:05:12-03:00" });
  assert.match(!onlyEnd.ok ? onlyEnd.error : "", /--start e --end andam juntos/);
  const none = choosePeriod({});
  assert.match(!none.ok ? none.error : "", /Faltam --from e --to/);
});

test("the period in words is in São Paulo time", () => {
  assert.equal(instantRangeLabel({ start: "2026-10-07T23:05:12.345Z", end: "2026-10-09T20:10:00-03:00" }), "07/10/2026 20:05 a 09/10/2026 20:10");
  assert.equal(instantRangeLabel({ start: "x", end: "2026-10-09T20:10:00-03:00" }), null);
});
