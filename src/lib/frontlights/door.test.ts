import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { frontlightsDoor } from "./door.ts";
import type { CallRecord } from "./calls.ts";

const request = (headers: Record<string, string> = {}, method = "GET") => new Request("https://example.test/api/frontlights/x?since=secret-looking-value", { method, headers });
const open = { route: "/x", authorized: () => true };

test("a call without the secret is refused in the server's log, with its method and route and nothing else", async () => {
  const warn = mock.method(console, "warn", () => {});
  const door = frontlightsDoor({ route: "/ack", authorized: () => false }, async () => Response.json({}));
  await door(request({ authorization: "Bearer wrong-secret-value" }, "POST"), undefined);
  assert.deepEqual(warn.mock.calls[0].arguments, ["frontlights POST /ack refused: no valid secret"]);
  assert.doesNotMatch(JSON.stringify(warn.mock.calls), /wrong-secret-value|since|secret-looking/);
  warn.mock.restore();
});

test("a call without the secret is a 401 that says the version, and the handler never runs", async () => {
  const warn = mock.method(console, "warn", () => {});
  let ran = false;
  const door = frontlightsDoor({ route: "/x", authorized: () => false }, async () => {
    ran = true;
    return Response.json({});
  });
  const res = await door(request(), undefined);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { schemaVersion: 1, error: "unauthorized" });
  assert.equal(ran, false);
  warn.mock.restore();
});

test("a call with the secret gets what the handler answers, untouched", async () => {
  const door = frontlightsDoor(open, async () => Response.json({ schemaVersion: 1, hello: "world" }, { status: 201 }));
  const res = await door(request(), undefined);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { schemaVersion: 1, hello: "world" });
});

test("the handler gets the request and the context of the route", async () => {
  const seen: unknown[] = [];
  const door = frontlightsDoor<{ id: string }>(open, async (req, ctx) => {
    seen.push(req.headers.get("x-probe"), ctx);
    return Response.json({});
  });
  await door(request({ "x-probe": "1" }), { id: "abc" });
  assert.deepEqual(seen, ["1", { id: "abc" }]);
});

test("a handler that throws is a 500 that says nothing about what broke, and the details reach the log", async () => {
  const log = mock.method(console, "error", () => {});
  const failure = new Error('relation "roadmap_sync_queue" does not exist');
  const door = frontlightsDoor({ route: "/pending-changes", authorized: () => true }, async () => {
    throw failure;
  });
  const res = await door(request(), undefined);
  const text = await res.text();
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(text), { schemaVersion: 1, error: "internal_error" });
  assert.doesNotMatch(text, /roadmap_sync_queue|relation/);
  assert.deepEqual(log.mock.calls[0].arguments, ["GET /pending-changes failed", failure]);
  log.mock.restore();
});

/* ---------- the log of calls ---------- */

function recorded(extra: Partial<Parameters<typeof frontlightsDoor>[0]> = {}) {
  const calls: CallRecord[] = [];
  let clock = 5_000;
  const options = { ...open, record: (c: CallRecord) => void calls.push(c), now: () => (clock += 40), ...extra };
  return { calls, options };
}

test("a call with the secret is written down: method, route, status, who it says it is and how long it took", async () => {
  const { calls, options } = recorded({ route: "/ack" });
  const door = frontlightsDoor(options, async () => Response.json({ acked: 1 }));
  await door(request({ "user-agent": "frontlights-roadmap-sync/0.18.0" }, "POST"), undefined);
  assert.deepEqual(calls, [{ method: "POST", route: "/ack", status: 200, user_agent: "frontlights-roadmap-sync/0.18.0", duration_ms: 40 }]);
});

test("the route written down is the pattern, never the address that was called", async () => {
  const { calls, options } = recorded({ route: "/progress-report/[id]/shots" });
  const door = frontlightsDoor(options, async () => Response.json({}));
  await door(new Request("https://example.test/api/frontlights/progress-report/9f1c-real-id/shots?since=x", { method: "POST" }), undefined);
  assert.equal(calls[0].route, "/progress-report/[id]/shots");
  assert.doesNotMatch(JSON.stringify(calls), /real-id|since|secret/);
});

test("a call that fails is written down with its 500", async () => {
  const log = mock.method(console, "error", () => {});
  const { calls, options } = recorded();
  const door = frontlightsDoor(options, async () => {
    throw new Error("boom");
  });
  await door(request(), undefined);
  assert.equal(calls[0].status, 500);
  log.mock.restore();
});

test("a call without the secret is NOT written down, so nobody outside can fill the table", async () => {
  const { calls, options } = recorded({ authorized: () => false });
  const door = frontlightsDoor(options, async () => Response.json({}));
  await door(request(), undefined);
  assert.deepEqual(calls, []);
});

test("a call that names no client is written down with none", async () => {
  const { calls, options } = recorded();
  await frontlightsDoor(options, async () => Response.json({}))(request(), undefined);
  assert.equal(calls[0].user_agent, null);
});

test("a log that breaks never breaks the answer", async () => {
  const log = mock.method(console, "error", () => {});
  const door = frontlightsDoor({ ...open, record: () => { throw new Error("log down"); } }, async () => Response.json({ ok: true }));
  const res = await door(request(), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(log.mock.callCount(), 1);
  log.mock.restore();
});
