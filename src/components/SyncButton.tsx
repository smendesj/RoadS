"use client";

import { useEffect, useRef } from "react";
import { ACTION } from "@/lib/text/common";
import { SYNC_NOTICE_MS } from "@/lib/sync-message";

// The one "Sync" button, on the Dashboard and on the Roadmap alike: the same label, the same
// icon, the same sync behind it (GitHub Project #7, then the Roadmap's issues). `tight` is for the top bar: below
// 360px the label is left to screen readers, so the bar keeps one line on the smallest phones.
export function SyncButton({ onClick, isPending, tight = false }: { onClick: () => void; isPending: boolean; tight?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className={`flex items-center gap-2 rounded-full ${tight ? "max-[359px]:px-2.5" : ""} border border-rs-border bg-rs-card px-3.5 py-2 text-[13px] font-bold text-rs-text-soft transition-colors hover:border-rs-brand hover:text-rs-brand-text disabled:opacity-70`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isPending ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" />
      </svg>
      <span className={tight ? "max-[359px]:sr-only" : undefined}>{isPending ? ACTION.syncing : ACTION.sync}</span>
    </button>
  );
}

export type SyncNotice = { text: string; error: boolean } | null;

// The Sync of the top bar, one and the same on the Dashboard and on the Roadmap: the button, and the message the
// last sync left hanging below it (red when it failed) without moving the bar, gone SYNC_NOTICE_MS after it appeared.
export function BarSync({ onSync, isPending, notice, onClear }: { onSync: () => void; isPending: boolean; notice: SyncNotice; onClear: () => void }) {
  const clear = useRef(onClear);
  useEffect(() => {
    clear.current = onClear;
  });
  // Keyed by what is shown, never by the object: a page that rebuilds it on every render must not restart the clock.
  const shown = notice ? `${notice.error ? "!" : ""}${notice.text}` : null;
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => clear.current(), SYNC_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <div className="relative">
      <SyncButton onClick={onSync} isPending={isPending} tight />
      {notice && (
        <span
          className={`absolute right-0 top-full z-30 mt-1 w-max max-w-[260px] rounded-md bg-rs-card px-1.5 py-0.5 text-right text-[11px] ${notice.error ? "text-red-500" : "text-rs-text-faint"}`}
        >
          {notice.text}
        </span>
      )}
    </div>
  );
}
