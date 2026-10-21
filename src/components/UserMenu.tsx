"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AVATAR_IDS, avatarSrc } from "@/lib/avatars";
import { AUTH, NAV } from "@/lib/text/account";
import { useLogout } from "@/lib/use-logout";

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

// avatar comes from the server with the page, so the picture is there from the first paint.
export function UserMenu({ roleLabel, avatar: initialAvatar }: { roleLabel: string; avatar: string | null }) {
  const [avatar, setAvatar] = useState(initialAvatar);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logout = useLogout();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The picture changes at once; if the save fails it goes back to the last one that was saved.
  // Only the latest click decides what is shown when its save settles, so quick successive picks
  // can't leave the screen on a picture that isn't the saved one. The save is its own request, sent at
  // once (src/lib/profile.ts has why it is not a server action), and keepalive lets it finish even if
  // the page is reloaded or closed right after the click.
  const saved = useRef(initialAvatar);
  const latestPick = useRef(0);
  function choose(id: string) {
    const pick = ++latestPick.current;
    setAvatar(id);
    fetch("/api/profile/avatar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatar: id }),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        saved.current = id;
      })
      .catch((e) => {
        console.error("avatar save failed", e);
      })
      .finally(() => {
        if (pick === latestPick.current) setAvatar(saved.current);
      });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={NAV.userMenu}
        aria-expanded={open}
        className="-m-1.5 flex items-center gap-2.5 rounded-full p-1.5 sm:m-0 sm:p-0"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-rs-brand-soft text-rs-text-soft">
          {avatar ? <Image src={avatarSrc(avatar)} alt="" width={32} height={32} className="h-full w-full object-cover" /> : <UserIcon />}
        </span>
        <span className="hidden text-sm font-bold text-rs-text sm:inline">{roleLabel}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-3 rounded-xl border border-rs-border bg-rs-card p-3 shadow-lg">
          <span className="text-[13px] font-semibold text-rs-text-soft">{NAV.profilePicture}</span>
          {/* 44px touch targets on phones (4 per row), the compact 6-per-row grid from sm up. */}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                onClick={() => choose(id)}
                aria-label={NAV.picture(id.replace("avatar-", ""))}
                aria-pressed={avatar === id}
                className={`h-11 w-11 justify-self-center overflow-hidden rounded-full border-2 sm:h-8 sm:w-8 ${avatar === id ? "border-rs-brand" : "border-transparent"}`}
              >
                <Image src={avatarSrc(id)} alt="" width={32} height={32} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-rs-border py-3 text-sm font-bold text-rs-text hover:bg-rs-bg sm:py-2"
          >
            {AUTH.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
