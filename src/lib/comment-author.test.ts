import { test } from "node:test";
import assert from "node:assert/strict";

import { commentAuthorName } from "./comment-author.ts";

test("a Comment is signed with the profile's name, else its role, and never with the e-mail", () => {
  assert.equal(commentAuthorName({ user_metadata: { name: " Pessoa Teste " } }, "scrum_master"), "Pessoa Teste");
  assert.equal(commentAuthorName({ user_metadata: {} }, "scrum_master"), "Scrum Master");
  assert.equal(commentAuthorName(null, "admin"), "Admin");
});
