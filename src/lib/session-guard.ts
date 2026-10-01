import { isIdleExpired } from "./idle.ts";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

type Listenable = {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type IdleWatch = {
  win: Listenable;
  doc: Listenable;
  now: () => number;
  readActivity: () => number | null;
  touchActivity: () => void;
  onExpire: () => void;
  checkEveryMs?: number;
  throttleMs?: number;
};

// Stamps every interaction (at most once per throttleMs) and reports once when the stamp has
// gone 10 minutes stale: on the periodic check, when the tab becomes visible again, and right
// away if the page opens already stale (browser left closed). A missing stamp is re-armed, never
// treated as expired. Returns a function that stops everything.
export function startIdleWatch({
  win,
  doc,
  now,
  readActivity,
  touchActivity,
  onExpire,
  checkEveryMs = 15_000,
  throttleMs = 1000,
}: IdleWatch): () => void {
  let expired = false;
  const check = () => {
    if (expired) return;
    if (isIdleExpired(readActivity(), now())) {
      expired = true;
      onExpire();
    }
  };

  if (readActivity() === null) touchActivity();
  check();

  let lastStamp = 0;
  const onActivity = () => {
    const t = now();
    if (t - lastStamp < throttleMs) return;
    lastStamp = t;
    touchActivity();
  };

  ACTIVITY_EVENTS.forEach((event) => win.addEventListener(event, onActivity, { passive: true }));
  doc.addEventListener("visibilitychange", check);
  const timer = setInterval(check, checkEveryMs);

  return () => {
    ACTIVITY_EVENTS.forEach((event) => win.removeEventListener(event, onActivity));
    doc.removeEventListener("visibilitychange", check);
    clearInterval(timer);
  };
}

type AuthEvents = {
  onAuthStateChange(callback: (event: string) => void): { data: { subscription: { unsubscribe: () => void } } };
};

// The auth client tells every tab of the browser when the session ends (explicit logout, idle
// logout, or a refresh that no longer works) — a tab that missed it would keep showing the app.
export function watchSessionEnd(auth: AuthEvents, onEnd: () => void): () => void {
  const {
    data: { subscription },
  } = auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") onEnd();
  });
  return () => subscription.unsubscribe();
}
