import { test } from "node:test";
import assert from "node:assert/strict";
import { AVATAR_IDS, avatarSrc, isAvatarId } from "./avatars.ts";

test("there are at least 15 generic avatars, all distinct", () => {
  assert.ok(AVATAR_IDS.length >= 15);
  assert.equal(new Set(AVATAR_IDS).size, AVATAR_IDS.length);
});

test("only known avatar ids are accepted", () => {
  assert.equal(isAvatarId(AVATAR_IDS[0]), true);
  assert.equal(isAvatarId("../../etc/passwd"), false);
  assert.equal(isAvatarId("avatar-99"), false);
  assert.equal(isAvatarId(null), false);
  assert.equal(isAvatarId(42), false);
});

test("an avatar id maps to its public image path", () => {
  assert.equal(avatarSrc("avatar-01"), "/avatars/avatar-01.svg");
});
