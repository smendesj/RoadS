import { test } from "node:test";
import assert from "node:assert/strict";
import { saveAvatar } from "./profile.ts";

function store(userId: string | null, failWrite = false) {
  const writes: Array<[string, string]> = [];
  return {
    writes,
    deps: {
      getUserId: async () => userId,
      setAvatar: async (id: string, avatar: string) => {
        if (failWrite) throw new Error("db down");
        writes.push([id, avatar]);
      },
    },
  };
}

test("the picture is saved on the signed-in user's own profile", async () => {
  const { writes, deps } = store("u1");
  await saveAvatar("avatar-12", deps);
  assert.deepEqual(writes, [["u1", "avatar-12"]]);
});

test("an id outside the shipped set is refused before anything is written", async () => {
  const { writes, deps } = store("u1");
  await assert.rejects(saveAvatar("../../secret", deps), /invalid_avatar/);
  assert.deepEqual(writes, []);
});

test("nobody signed in means nothing is written", async () => {
  const { writes, deps } = store(null);
  await assert.rejects(saveAvatar("avatar-01", deps), /not_authenticated/);
  assert.deepEqual(writes, []);
});

test("a failed write reaches the caller, so the screen can roll back", async () => {
  const { deps } = store("u1", true);
  await assert.rejects(saveAvatar("avatar-01", deps), /db down/);
});
