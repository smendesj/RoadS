import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { CALL_RETENTION_DAYS, USER_AGENT_MAX, describeCall, pruneCalls, pruneCutoff, recordCall } from "./calls.ts";
import type { CallRecord, CallStore } from "./calls.ts";
import { fakeClient } from "./fake-client.ts";
import { supabaseCallStore } from "./calls-store.ts";

const call = (extra: Partial<Parameters<typeof describeCall>[0]> = {}) =>
  describeCall({ method: "POST", route: "/ack", status: 200, userAgent: "frontlights-roadmap-sync/0.18.0", startedAt: 1_000, endedAt: 1_250, ...extra });

/* ---------- what is kept of a call ---------- */

test("a call keeps its method, route, status, who it says it is and how long it took, and nothing else", () => {
  assert.deepEqual(call(), { method: "POST", route: "/ack", status: 200, user_agent: "frontlights-roadmap-sync/0.18.0", duration_ms: 250 });
});

test("a call that names no client, or a blank one, keeps none", () => {
  assert.equal(call({ userAgent: null }).user_agent, null);
  assert.equal(call({ userAgent: "   " }).user_agent, null);
});

test("what a caller says about itself is cleaned and cut: no control characters, at most 200 characters", () => {
  assert.equal(call({ userAgent: "cliente/1\r\nX-Injected: 1\u0000" }).user_agent, "cliente/1X-Injected: 1");
  const long = call({ userAgent: "a".repeat(5000) }).user_agent;
  assert.equal(long?.length, USER_AGENT_MAX);
  assert.equal(USER_AGENT_MAX, 200);
});

test("a duration is whole milliseconds and never negative", () => {
  assert.equal(call({ startedAt: 1_000, endedAt: 1_000.6 }).duration_ms, 1);
  assert.equal(call({ startedAt: 2_000, endedAt: 1_000 }).duration_ms, 0);
});

/* ---------- writing it down must never get in the way ---------- */

test("a call is handed to the store as it is", async () => {
  const seen: CallRecord[] = [];
  const store: CallStore = { insert: async (r) => void seen.push(r), deleteOlderThan: async () => 0 };
  await recordCall(store, call());
  assert.deepEqual(seen, [call()]);
});

test("a store that fails is logged, never raised: the answer was already sent", async () => {
  const log = mock.method(console, "error", () => {});
  const failure = new Error("db down");
  const store: CallStore = {
    insert: async () => {
      throw failure;
    },
    deleteOlderThan: async () => 0,
  };
  await assert.doesNotReject(() => recordCall(store, call()));
  assert.deepEqual(log.mock.calls[0].arguments, ["frontlights call log failed", failure]);
  log.mock.restore();
});

/* ---------- keeping them for 90 days ---------- */

test("they are kept for 90 days", () => {
  assert.equal(CALL_RETENTION_DAYS, 90);
  assert.equal(pruneCutoff(new Date("2026-10-05T12:00:00.000Z")), "2026-07-07T12:00:00.000Z");
});

test("pruning asks the store to drop what is older than the cutoff and says how many went", async () => {
  const asked: string[] = [];
  const store: CallStore = {
    insert: async () => {},
    deleteOlderThan: async (cutoff) => {
      asked.push(cutoff);
      return 7;
    },
  };
  assert.equal(await pruneCalls(store, new Date("2026-10-05T12:00:00.000Z")), 7);
  assert.deepEqual(asked, ["2026-07-07T12:00:00.000Z"]);
});

/* ---------- the Supabase side ---------- */

test("the store writes one row of frontlights_calls", async () => {
  const { client, asked } = fakeClient({ frontlights_calls: { data: null } });
  await supabaseCallStore(client).insert(call());
  assert.equal(asked[0].table, "frontlights_calls");
  assert.deepEqual(asked[0].steps, [["insert", { method: "POST", route: "/ack", status: 200, user_agent: "frontlights-roadmap-sync/0.18.0", duration_ms: 250 }]]);
});

test("the store raises what the database refuses, so the logger can say it", async () => {
  const { client } = fakeClient({ frontlights_calls: { error: { message: "boom" } } });
  await assert.rejects(() => supabaseCallStore(client).insert(call()), { message: "boom" });
});

test("the store deletes only rows made before the cutoff, and counts them", async () => {
  const { client, asked } = fakeClient({ frontlights_calls: { data: [{ id: 1 }, { id: 2 }] } });
  assert.equal(await supabaseCallStore(client).deleteOlderThan("2026-07-07T12:00:00.000Z"), 2);
  assert.deepEqual(asked[0].steps.filter(([m]) => m !== "select"), [["delete"], ["lt", "created_at", "2026-07-07T12:00:00.000Z"]]);
});
