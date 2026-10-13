"use client";

import { useEffect, useRef } from "react";
import { AUTO_SYNC_MS } from "@/lib/auto-sync";

// Runs `sync` when the page opens, when its tab comes back into view and every AUTO_SYNC_MS while it stays in view
// (src/lib/auto-sync.ts has the why). A hidden tab asks nothing. Off when `enabled` is false (nobody signed in).
export function useAutoSync(sync: () => void, enabled = true) {
  const latest = useRef(sync);
  useEffect(() => {
    latest.current = sync;
  });

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const onVisibility = () => run();
    run();
    const timer = window.setInterval(run, AUTO_SYNC_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
