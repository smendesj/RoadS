import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { serverError } from "./api-response.ts";

test("a server error says nothing about what failed", async () => {
  const log = mock.method(console, "error", () => {});
  const res = serverError("pending-changes", new Error('relation "roadmap_sync_queue" does not exist'));
  const body = await res.text();
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(body), { error: "internal_error" });
  assert.doesNotMatch(body, /roadmap_sync_queue|relation/);
  log.mock.restore();
});

test("the details still reach the server log", () => {
  const log = mock.method(console, "error", () => {});
  const failure = new Error("db down");
  serverError("ack", failure);
  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0].arguments, ["ack failed", failure]);
  log.mock.restore();
});
