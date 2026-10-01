import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_LIMIT_MS, isIdleExpired } from "./idle.ts";

test("the idle limit is 10 minutes", () => {
  assert.equal(IDLE_LIMIT_MS, 10 * 60 * 1000);
});

test("not expired just before 10 minutes of inactivity", () => {
  assert.equal(isIdleExpired(0, IDLE_LIMIT_MS - 1), false);
});

test("expired at exactly 10 minutes of inactivity", () => {
  assert.equal(isIdleExpired(0, IDLE_LIMIT_MS), true);
});

test("a missing or unreadable last-activity stamp never expires the session", () => {
  assert.equal(isIdleExpired(null, 999_999_999), false);
  assert.equal(isIdleExpired(Number.NaN, 999_999_999), false);
});
