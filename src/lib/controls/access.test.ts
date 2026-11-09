import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROLS_MEMBERS, isControlsEmail } from "./access.ts";

test("the two members (and the test admin's plus-address) are recognized, case-insensitively", () => {
  assert.ok(isControlsEmail("sergio.mendes@essencislabs.com"));
  assert.ok(isControlsEmail("JOAO.FIORI@essencistech.com.br"));
  assert.ok(isControlsEmail("  sergio.mendes+roads-test@essencislabs.com  "));
});

test("everyone else is refused, including empty and null", () => {
  assert.equal(isControlsEmail("luiz.damore@essencislabs.com"), false);
  assert.equal(isControlsEmail("stranger@gmail.com"), false);
  assert.equal(isControlsEmail(""), false);
  assert.equal(isControlsEmail(null), false);
  assert.equal(isControlsEmail(undefined), false);
});

test("the allowlist stays in step with the database (migration 0046) — exactly three addresses", () => {
  assert.equal(CONTROLS_MEMBERS.length, 3);
});
