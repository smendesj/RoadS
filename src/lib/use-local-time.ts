import { useSyncExternalStore } from "react";
import { formatLocalTime } from "./local-time.ts";

// The time zone can't change while a page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};

// The server doesn't know the viewer's time zone, so it (and the hydration pass) gets null and the
// browser fills the time in right after. Printing it on the server would show UTC, then fail to
// hydrate against the browser's local time and make React discard the server HTML.
export function useLocalTime(iso: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (iso ? formatLocalTime(iso) : null),
    () => null
  );
}
