import { test } from "node:test";
import assert from "node:assert/strict";
import { isIsoTimestamp, isWithin } from "./timestamp.ts";

test("ISO timestamps with an offset are accepted, microseconds included", () => {
  assert.equal(isIsoTimestamp("2026-10-01T11:16:55Z"), true);
  assert.equal(isIsoTimestamp("2026-10-01T11:16:55.123Z"), true);
  assert.equal(isIsoTimestamp("2026-10-01T11:16:55.123456+00:00"), true);
  assert.equal(isIsoTimestamp("2026-10-01T08:16:55-03:00"), true);
});

test("everything the database would choke on is refused up front", () => {
  for (const value of ["not-a-date", "2026", "2026-10-01", "2026-10-01T11:16:55", "2026-13-45T00:00:00Z", "", " ", "2026-10-01 11:16:55+00", "2026-10-01T11:16:55+00", "2026-10-01T08:16:55-0300"]) {
    assert.equal(isIsoTimestamp(value), false, JSON.stringify(value));
  }
  for (const value of [null, undefined, 123, {}, []]) {
    assert.equal(isIsoTimestamp(value), false, JSON.stringify(value));
  }
});

test("a sync counts as recent inside the cooldown window, and not at or after its edge", () => {
  const now = Date.parse("2026-10-01T12:00:30.000Z");
  assert.equal(isWithin("2026-10-01T12:00:10.000Z", now, 30_000), true);
  assert.equal(isWithin("2026-10-01T12:00:00.001Z", now, 30_000), true);
  assert.equal(isWithin("2026-10-01T12:00:00.000Z", now, 30_000), false);
  assert.equal(isWithin("2026-10-01T11:00:00.000Z", now, 30_000), false);
});

test("a timestamp from the future or not a date never counts as recent", () => {
  const now = Date.parse("2026-10-01T12:00:30.000Z");
  assert.equal(isWithin("2026-10-01T12:05:00.000Z", now, 30_000), false);
  assert.equal(isWithin("not a date", now, 30_000), false);
});
