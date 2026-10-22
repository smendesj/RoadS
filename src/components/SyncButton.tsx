"use client";

import { ACTION } from "@/lib/text/common";

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
