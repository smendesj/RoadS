import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, answerJson, frontlightsJson, unsupportedSchema } from "./contract.ts";

test("every JSON body of a Frontlights door says the version of the contract", async () => {
  const res = frontlightsJson({ acked: 3 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { schemaVersion: 1, acked: 3 });
  assert.equal(SCHEMA_VERSION, 1);
});

test("an error says the version too, and keeps its status", async () => {
  const res = frontlightsJson({ error: "unauthorized" }, 401);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { schemaVersion: 1, error: "unauthorized" });
});

test("an answer made by a handler becomes a response with the same status and body, plus the version", async () => {
  const res = answerJson({ status: 409, body: { error: "period_already_sent" } });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { schemaVersion: 1, error: "period_already_sent" });
});

test("a body that already names the current version is left as it is", async () => {
  assert.deepEqual(await frontlightsJson({ schemaVersion: 1, asOf: "x" }).json(), { schemaVersion: 1, asOf: "x" });
});

test("a request that names no version is version 1", () => {
  assert.equal(unsupportedSchema({ asOf: "2026-01-01T00:00:00Z" }), null);
  assert.equal(unsupportedSchema({ produto: "GeoCloud", content: {} }), null);
});

test("a request that names version 1 is accepted", () => {
  assert.equal(unsupportedSchema({ schemaVersion: 1, asOf: "2026-01-01T00:00:00Z" }), null);
});

test("a request that names any other version is refused with the one that is supported", () => {
  const expected = { status: 400, body: { error: "unsupported_schema_version", supported: 1 } };
  assert.deepEqual(unsupportedSchema({ schemaVersion: 2 }), expected);
  assert.deepEqual(unsupportedSchema({ schemaVersion: 0 }), expected);
  assert.deepEqual(unsupportedSchema({ schemaVersion: "1" }), expected);
  assert.deepEqual(unsupportedSchema({ schemaVersion: null }), expected);
});

test("a body that is not an object has no version to refuse (the handler says what is wrong with it)", () => {
  assert.equal(unsupportedSchema(null), null);
  assert.equal(unsupportedSchema("1"), null);
  assert.equal(unsupportedSchema([1]), null);
});
