import { test } from "node:test";
import assert from "node:assert/strict";
import { createThemeStore, THEME_INIT_SCRIPT } from "./theme-store.ts";

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

test("the theme is dark when nothing is stored", () => {
  assert.equal(createThemeStore(() => fakeStorage()).getSnapshot(), "dark");
});

test("the stored theme is the starting point", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "light" })).getSnapshot(), "light");
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "dark" })).getSnapshot(), "dark");
});

test("a stored value that is not a theme is ignored", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "purple" })).getSnapshot(), "dark");
});

test("the server render and hydration always start on the dark default", () => {
  assert.equal(createThemeStore(() => fakeStorage({ "roads-theme": "light" })).getServerSnapshot(), "dark");
});

test("choosing a theme persists it and tells subscribers", () => {
  const storage = fakeStorage();
  const store = createThemeStore(() => storage);
  let notified = 0;
  store.subscribe(() => notified++);
  store.set("light");
  assert.equal(store.getSnapshot(), "light");
  assert.equal(storage.data["roads-theme"], "light");
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

test("toggling flips between dark and light", () => {
  const store = createThemeStore(() => fakeStorage());
  store.toggle();
  assert.equal(store.getSnapshot(), "light");
  store.toggle();
  assert.equal(store.getSnapshot(), "dark");
});

test("with storage blocked, the theme still toggles for the session", () => {
  const store = createThemeStore(() => blockedStorage);
  assert.equal(store.getSnapshot(), "dark");
  store.toggle();
  assert.equal(store.getSnapshot(), "light");
});

// The head script runs before first paint, so the dark default never flashes light.
function runHeadScript(stored: string | null | "blocked") {
  const added: string[] = [];
  const win = {
    localStorage: {
      getItem: () => {
        if (stored === "blocked") throw new Error("blocked");
        return stored;
      },
    },
  };
  const doc = { documentElement: { classList: { add: (name: string) => added.push(name) } } };
  new Function("window", "document", THEME_INIT_SCRIPT)(win, doc);
  return added;
}

test("the head script paints dark straight away by default", () => {
  assert.deepEqual(runHeadScript("dark"), ["dark"]);
  assert.deepEqual(runHeadScript(null), ["dark"]);
  assert.deepEqual(runHeadScript("purple"), ["dark"]);
});

test("the head script keeps light only when light was chosen", () => {
  assert.deepEqual(runHeadScript("light"), []);
});

test("the head script never throws when storage is blocked, and stays dark", () => {
  assert.deepEqual(runHeadScript("blocked"), ["dark"]);
});
