import { test } from "node:test";
import assert from "node:assert/strict";
import { endSession } from "./logout.ts";

// Each sign-out attempt consumes the next scripted result; an Error means the call throws.
function setup(results: Array<{ error: unknown } | Error>) {
  const calls: string[] = [];
  let next = 0;
  return {
    calls,
    deps: {
      clearActivity: () => {
        calls.push("clear");
      },
      signOut: async (scope: "global" | "local") => {
        calls.push(`signOut:${scope}`);
        const result = results[next++];
        if (result instanceof Error) throw result;
        return result;
      },
      navigate: (to: string) => {
        calls.push(`navigate:${to}`);
      },
    },
  };
}

test("logging out clears the idle stamp, signs out, then goes to /login", async () => {
  const { calls, deps } = setup([{ error: null }]);
  await endSession(deps);
  assert.deepEqual(calls, ["clear", "signOut:global", "navigate:/login"]);
});

test("if the server can't be reached the session is still dropped locally, so /login doesn't bounce back into the app", async () => {
  const { calls, deps } = setup([{ error: new Error("network") }, { error: null }]);
  await endSession(deps);
  assert.deepEqual(calls, ["clear", "signOut:global", "signOut:local", "navigate:/login"]);
});

test("a sign-out that throws is treated like one that failed", async () => {
  const { calls, deps } = setup([new Error("boom"), { error: null }]);
  await endSession(deps);
  assert.deepEqual(calls, ["clear", "signOut:global", "signOut:local", "navigate:/login"]);
});

test("the user still lands on /login even when the local sign-out throws too", async () => {
  const { calls, deps } = setup([new Error("boom"), new Error("boom again")]);
  await endSession(deps);
  assert.deepEqual(calls, ["clear", "signOut:global", "signOut:local", "navigate:/login"]);
});
