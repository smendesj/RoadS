import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ALLOWED_DOMAINS, isAllowedEmail, isValidPassword } from "./validation.ts";

test("company addresses are allowed, in any case and with a plus tag", () => {
  assert.equal(isAllowedEmail("ana@essencislabs.com"), true);
  assert.equal(isAllowedEmail("Ana.Silva@ESSENCISTECH.COM.BR"), true);
  assert.equal(isAllowedEmail("  ana+roads@essencislabs.com  "), true);
});

test("everything else is refused, lookalike domains included", () => {
  for (const email of [
    "ana@gmail.com",
    "ana@essencislabs.com.evil.com",
    "ana@evilessencislabs.com",
    "ana@sub.essencislabs.com",
    "ana@essencislabs.com@evil.com",
    "essencislabs.com",
    "",
  ]) {
    assert.equal(isAllowedEmail(email), false, email);
  }
});

test("passwords need 8+ characters with a letter and a digit", () => {
  assert.equal(isValidPassword("abcdefg1"), true);
  assert.equal(isValidPassword("abcdefgh"), false);
  assert.equal(isValidPassword("12345678"), false);
  assert.equal(isValidPassword("abc12"), false);
});

// The signup page checks the domain in the browser, which anyone can skip by calling the API, so
// the database enforces the same list. If one side changes without the other, this fails.
test("the database's allowed e-mail domains are exactly the app's", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const definers = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("function public.enforce_allowed_email_domain"));
  assert.ok(definers.length > 0, "no migration defines enforce_allowed_email_domain");

  const sql = readFileSync(new URL(definers[definers.length - 1], dir), "utf8");
  const list = sql.match(/not in \(([^)]*)\)/)?.[1] ?? "";
  const inDatabase = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inDatabase, [...ALLOWED_DOMAINS].sort());
});
