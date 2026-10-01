import { test } from "node:test";
import assert from "node:assert/strict";
import { loadViewer, roleLabel } from "./viewer.ts";

const signedOut = {
  getUserId: async () => null,
  getProfile: async () => {
    throw new Error("no profile lookup without a session");
  },
};

const signedIn = (profile: { role?: string | null; avatar?: string | null } | null) => ({
  getUserId: async () => "u1",
  getProfile: async (id: string) => {
    assert.equal(id, "u1");
    return profile;
  },
});

test("nobody signed in means no viewer", async () => {
  assert.equal(await loadViewer(signedOut), null);
});

test("a signed-in admin arrives with their role, id and picture", async () => {
  assert.deepEqual(await loadViewer(signedIn({ role: "admin", avatar: "avatar-06" })), {
    id: "u1",
    role: "admin",
    avatar: "avatar-06",
  });
});

test("a signed-in user without a role is a Dev, never a visitor", async () => {
  assert.equal((await loadViewer(signedIn({ role: null, avatar: null })))?.role, "dev");
});

test("a signed-in user without a profile row is a Dev with no picture", async () => {
  assert.deepEqual(await loadViewer(signedIn(null)), { id: "u1", role: "dev", avatar: null });
});

test("an unknown role falls back to the least-privileged one", async () => {
  assert.equal((await loadViewer(signedIn({ role: "owner" })))?.role, "dev");
});

test("a stored picture outside the shipped set is dropped", async () => {
  assert.equal((await loadViewer(signedIn({ role: "dev", avatar: "../../secret" })))?.avatar, null);
});

test("role labels, with Visitante only for nobody", () => {
  assert.equal(roleLabel(null), "Visitante");
  assert.equal(roleLabel("admin"), "Admin");
  assert.equal(roleLabel("scrum_master"), "Scrum Master");
  assert.equal(roleLabel("dev"), "Dev");
});
