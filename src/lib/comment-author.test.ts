import { test } from "node:test";
import assert from "node:assert/strict";

import { commentAuthorName, mayChangeComment } from "./comment-author.ts";

test("a Comment is signed with the profile's name, else its role, and never with the e-mail", () => {
  assert.equal(commentAuthorName({ user_metadata: { name: " Pessoa Teste " } }, "scrum_master"), "Pessoa Teste");
  assert.equal(commentAuthorName({ user_metadata: {} }, "scrum_master"), "Scrum Master");
  assert.equal(commentAuthorName(null, "admin"), "Admin");
});

test("whoever wrote a Comment and the admin may change it; a comment from GitHub only the admin", () => {
  const sm = { id: "u-sm", role: "scrum_master" };
  const admin = { id: "u-admin", role: "admin" };
  assert.equal(mayChangeComment({ authorId: "u-sm" }, sm), true);
  assert.equal(mayChangeComment({ authorId: "u-outro" }, sm), false);
  assert.equal(mayChangeComment({ authorId: "u-outro" }, admin), true);
  assert.equal(mayChangeComment({ authorId: null }, sm), false);
  assert.equal(mayChangeComment({ authorId: null }, admin), true);
  assert.equal(mayChangeComment({ authorId: "u-sm" }, null), false);
});
