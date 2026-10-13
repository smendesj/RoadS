"use client";

import { useEffect, useRef } from "react";
import { AUTO_SYNC_MS, AUTO_SYNC_MIN_GAP_MS } from "@/lib/auto-sync";

// Runs `sync` when the page opens, when its tab comes back into view and every AUTO_SYNC_MS while it stays in view
// (src/lib/auto-sync.ts has the why). A hidden tab asks nothing, and flipping between tabs asks at most once a
// minute. Off when `enabled` is false (nobody signed in).
export function useAutoSync(sync: () => void, enabled = true) {
  const latest = useRef(sync);
  useEffect(() => {
    latest.current = sync;
  });

  useEffect(() => {
    if (!enabled) return;
    let lastRun = 0;
    const run = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRun < AUTO_SYNC_MIN_GAP_MS) return;
      lastRun = Date.now();
      latest.current();
    };
    run();
    const timer = window.setInterval(run, AUTO_SYNC_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [enabled]);
}
