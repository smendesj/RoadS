import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches } from "./secret.ts";

const SECRET = "s3cret-Value_123";

test("the exact bearer token is accepted", () => {
  assert.equal(bearerMatches(`Bearer ${SECRET}`, SECRET), true);
});

test("anything else is refused", () => {
  for (const header of [
    null,
    "",
    "Bearer",
    "Bearer ",
    `Bearer ${SECRET}x`,
    `Bearer ${SECRET.slice(0, -1)}`,
    `bearer ${SECRET}`,
    `Bearer  ${SECRET}`,
    ` Bearer ${SECRET}`,
    SECRET,
    `Basic ${SECRET}`,
    "Bearer wrong",
  ]) {
    assert.equal(bearerMatches(header, SECRET), false, String(header));
  }
});

test("without a configured secret nothing matches, not even look-alikes", () => {
  for (const secret of [undefined, ""]) {
    for (const header of ["Bearer ", "Bearer undefined", "Bearer ", "", null]) {
      assert.equal(bearerMatches(header, secret), false, `${String(secret)} / ${String(header)}`);
    }
  }
});
