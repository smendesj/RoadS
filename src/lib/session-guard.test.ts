import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { IDLE_LIMIT_MS } from "./idle.ts";
import { startIdleWatch, watchSessionEnd } from "./session-guard.ts";

afterEach(() => mock.timers.reset());

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

const START = 1_000_000;
const CHECK_MS = 15_000;

function idleWatch(stamp: number | null) {
  mock.timers.enable({ apis: ["setInterval"] });
  const state = { now: START, stamp, touches: 0, expired: 0 };
  const win = fakeTarget();
  const doc = fakeTarget();
  const stop = startIdleWatch({
    win,
    doc,
    now: () => state.now,
    readActivity: () => state.stamp,
    touchActivity: () => {
      state.touches++;
      state.stamp = state.now;
    },
    onExpire: () => {
      state.expired++;
    },
  });
  return { state, win, doc, stop };
}

test("an interaction renews the activity stamp", () => {
  const { state, win } = idleWatch(START);
  state.now += 5_000;
  win.emit("mousemove");
  assert.equal(state.stamp, START + 5_000);
});

test("every kind of interaction counts", () => {
  for (const event of ["mousemove", "mousedown", "keydown", "scroll", "touchstart"]) {
    const { state, win } = idleWatch(START);
    state.now += 5_000;
    win.emit(event);
    assert.equal(state.touches, 1, event);
    mock.timers.reset();
  }
});

test("interactions are stamped at most once per second", () => {
  const { state, win } = idleWatch(START);
  win.emit("mousemove");
  state.now += 500;
  win.emit("mousemove");
  assert.equal(state.touches, 1);
  state.now += 600;
  win.emit("mousemove");
  assert.equal(state.touches, 2);
});

test("nothing expires before 10 idle minutes", () => {
  const { state } = idleWatch(START);
  state.now = START + IDLE_LIMIT_MS - 1;
  mock.timers.tick(CHECK_MS);
  assert.equal(state.expired, 0);
});

test("at 10 idle minutes the next check expires the session", () => {
  const { state } = idleWatch(START);
  state.now = START + IDLE_LIMIT_MS;
  mock.timers.tick(CHECK_MS);
  assert.equal(state.expired, 1);
});

test("an expiry is reported once, however many checks follow", () => {
  const { state } = idleWatch(START);
  state.now = START + IDLE_LIMIT_MS;
  mock.timers.tick(CHECK_MS * 4);
  assert.equal(state.expired, 1);
});

test("a stamp already stale when the page opens expires at once (browser left closed)", () => {
  const { state } = idleWatch(START - IDLE_LIMIT_MS - 1);
  assert.equal(state.expired, 1);
});

test("a missing stamp is re-armed instead of expiring", () => {
  const { state } = idleWatch(null);
  assert.equal(state.touches, 1);
  assert.equal(state.expired, 0);
});

test("coming back to the tab checks right away, without waiting for the timer", () => {
  const { state, doc } = idleWatch(START);
  state.now = START + IDLE_LIMIT_MS;
  doc.emit("visibilitychange");
  assert.equal(state.expired, 1);
});

test("stopping removes every listener and the timer", () => {
  const { state, win, doc, stop } = idleWatch(START);
  stop();
  assert.equal(win.count() + doc.count(), 0);
  state.now = START + IDLE_LIMIT_MS;
  mock.timers.tick(CHECK_MS);
  assert.equal(state.expired, 0);
});

function fakeAuth() {
  const callbacks = new Set<(event: string) => void>();
  return {
    onAuthStateChange(callback: (event: string) => void) {
      callbacks.add(callback);
      return { data: { subscription: { unsubscribe: () => callbacks.delete(callback) } } };
    },
    emit: (event: string) => callbacks.forEach((callback) => callback(event)),
    count: () => callbacks.size,
  };
}

test("the session ending anywhere in the browser sends this tab away", () => {
  const auth = fakeAuth();
  let ended = 0;
  watchSessionEnd(auth, () => ended++);
  auth.emit("SIGNED_OUT");
  assert.equal(ended, 1);
});

test("other auth events leave the tab alone", () => {
  const auth = fakeAuth();
  let ended = 0;
  watchSessionEnd(auth, () => ended++);
  for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) auth.emit(event);
  assert.equal(ended, 0);
});

test("stopping detaches from auth events", () => {
  const auth = fakeAuth();
  const stop = watchSessionEnd(auth, () => {});
  stop();
  assert.equal(auth.count(), 0);
});
