import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_HEADERS } from "./security-headers.ts";

const header = (key: string) => SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

test("no other site can frame the app (clickjacking), old browsers included", () => {
  assert.equal(header("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.equal(header("X-Frame-Options"), "DENY");
});

test("browsers are told not to sniff content types, and to leak less in the referrer", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("sensors the app never uses are switched off", () => {
  assert.equal(header("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
});

// The CSP header is only frame-ancestors on purpose: a script/style policy would have to whitelist
// Next's inline bootstrap and the theme script, and would break pages if it drifted.
test("the CSP leaves scripts and styles alone", () => {
  assert.doesNotMatch(header("Content-Security-Policy") ?? "", /script-src|style-src|default-src/);
});
