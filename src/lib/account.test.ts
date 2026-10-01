import { test } from "node:test";
import assert from "node:assert/strict";
import { finishPasswordReset } from "./account.ts";

function ports(userId: string | null, failSet = false) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      getUserId: async () => userId,
      setPassword: async (password: string) => {
        calls.push(`set:${password}`);
        if (failSet) throw new Error("auth refused");
      },
      clearMustReset: async (id: string) => {
        calls.push(`clear:${id}`);
      },
    },
  };
}

test("a good password is set, and only then is the account's flag cleared", async () => {
  const { calls, deps } = ports("u1");
  await finishPasswordReset("Nova-senha-9", deps);
  assert.deepEqual(calls, ["set:Nova-senha-9", "clear:u1"]);
});

test("a weak password is refused before anything is touched (the server enforces the rule, not just the page)", async () => {
  for (const weak of ["abc", "abcdefgh", "12345678", ""]) {
    const { calls, deps } = ports("u1");
    await assert.rejects(finishPasswordReset(weak, deps), /weak_password/);
    assert.deepEqual(calls, [], weak);
  }
});

test("nobody signed in can neither set a password nor clear a flag", async () => {
  const { calls, deps } = ports(null);
  await assert.rejects(finishPasswordReset("Nova-senha-9", deps), /not_authenticated/);
  assert.deepEqual(calls, []);
});

test("if the password can't be changed the flag stays, so the reset isn't skipped", async () => {
  const { calls, deps } = ports("u1", true);
  await assert.rejects(finishPasswordReset("Nova-senha-9", deps), /auth refused/);
  assert.deepEqual(calls, ["set:Nova-senha-9"]);
});
