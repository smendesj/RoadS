import { test } from "node:test";
import assert from "node:assert/strict";
import { createThemeStore } from "./theme-store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const blockedStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("the theme is light when nothing is stored", () => {
  assert.equal(createThemeStore(() => fakeStorage()).getSnapshot(), "light");
});

test("the stored theme is the starting point", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "dark" })).getSnapshot(), "dark");
});

test("a stored value that is not a theme is ignored", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "purple" })).getSnapshot(), "light");
});

test("the server render and hydration always start on light", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "dark" })).getServerSnapshot(), "light");
});

test("choosing a theme persists it and tells subscribers", () => {
  const storage = fakeStorage();
  const store = createThemeStore(() => storage);
  let notified = 0;
  store.subscribe(() => notified++);
  store.set("dark");
  assert.equal(store.getSnapshot(), "dark");
  assert.equal(storage.data["roads-theme"], "dark");
  assert.equal(notified, 1);
});

test("an unsubscribed listener is no longer told", () => {
  const store = createThemeStore(() => fakeStorage());
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  unsubscribe();
  store.set("dark");
  assert.equal(notified, 0);
});

test("toggling flips between light and dark", () => {
  const store = createThemeStore(() => fakeStorage());
  store.toggle();
  assert.equal(store.getSnapshot(), "dark");
  store.toggle();
  assert.equal(store.getSnapshot(), "light");
});

test("with storage blocked, the theme still toggles for the session", () => {
  const store = createThemeStore(() => blockedStorage);
  assert.equal(store.getSnapshot(), "light");
  store.toggle();
  assert.equal(store.getSnapshot(), "dark");
});
