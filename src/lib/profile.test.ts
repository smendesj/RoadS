import { test } from "node:test";
import assert from "node:assert/strict";
import { answerAvatarRequest, saveAvatar } from "./profile.ts";

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

// The door the menu posts to (src/app/api/profile/avatar/route.ts): same rules, answered as HTTP.
const sameSite = (body: unknown) => ({ origin: "https://roads.example", host: "roads.example", body });

test("the door saves a good pick from the app's own page and answers 200", async () => {
  const { writes, deps } = store("u1");
  assert.deepEqual(await answerAvatarRequest(sameSite({ avatar: "avatar-07" }), deps), { status: 200, body: { ok: true } });
  assert.deepEqual(writes, [["u1", "avatar-07"]]);
});

test("the door refuses a post from another site, or with no Origin, before anything is written", async () => {
  const { writes, deps } = store("u1");
  for (const origin of ["https://evil.example", null, "not a url"]) {
    const answer = await answerAvatarRequest({ origin, host: "roads.example", body: { avatar: "avatar-07" } }, deps);
    assert.equal(answer.status, 403, String(origin));
  }
  assert.deepEqual(writes, []);
});

test("the door answers 400 to a bad id or a body that is not { avatar }, and 401 to nobody signed in", async () => {
  const { writes, deps } = store("u1");
  for (const body of [{ avatar: "../../secret" }, { avatar: 7 }, null, "avatar-01"]) {
    assert.deepEqual(await answerAvatarRequest(sameSite(body), deps), { status: 400, body: { error: "invalid_avatar" } }, JSON.stringify(body));
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(await answerAvatarRequest(sameSite({ avatar: "avatar-01" }), store(null).deps), { status: 401, body: { error: "not_authenticated" } });
});

test("a failed write is a 500 that names no database detail", async () => {
  assert.deepEqual(await answerAvatarRequest(sameSite({ avatar: "avatar-01" }), store("u1", true).deps), { status: 500, body: { error: "save_failed" } });
});
