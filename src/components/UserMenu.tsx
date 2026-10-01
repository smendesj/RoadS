"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { updateMyAvatar } from "@/lib/actions/profile";
import { AVATAR_IDS, avatarSrc, isAvatarId } from "@/lib/avatars";
import { isIdleExpired } from "@/lib/idle";
import { clearActivity, readActivity, touchActivity } from "@/lib/idle-storage";
import { createClient } from "@/lib/supabase/client";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
const CHECK_EVERY_MS = 15_000;

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

// Signs out and does a full navigation, so no signed-in page state survives in memory.
export async function logout() {
  clearActivity();
  await createClient().auth.signOut();
  window.location.assign("/login");
}

export function UserMenu({ roleLabel }: { roleLabel: string }) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      supabase
        .from("profiles")
        .select("avatar")
        .eq("id", data.user.id)
        .single()
        .then(({ data: profile }) => {
          if (isAvatarId(profile?.avatar)) setAvatar(profile.avatar);
        });
    });
  }, []);

  // Idle logout: 10 minutes without interaction, tracked across tabs and across closed browsers.
  useEffect(() => {
    if (readActivity() === null) touchActivity();
    const check = () => {
      if (isIdleExpired(readActivity(), Date.now())) logout();
    };
    check();

    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < 1000) return;
      lastWrite = now;
      touchActivity();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = useCallback((id: string) => {
    const previous = avatar;
    setAvatar(id);
    updateMyAvatar(id).catch((e) => {
      console.error("updateMyAvatar failed", e);
      setAvatar(previous);
    });
  }, [avatar]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu do usuário"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-rs-brand-soft text-rs-text-soft">
          {avatar ? <img src={avatarSrc(avatar)} alt="" className="h-full w-full object-cover" /> : <UserIcon />}
        </span>
        <span className="hidden text-sm font-bold text-rs-text sm:inline">{roleLabel}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-3 rounded-xl border border-rs-border bg-rs-card p-3 shadow-lg">
          <span className="text-[13px] font-semibold text-rs-text-soft">Foto do perfil</span>
          <div className="grid grid-cols-6 gap-2">
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                onClick={() => choose(id)}
                aria-label={`Foto ${id.replace("avatar-", "")}`}
                aria-pressed={avatar === id}
                className={`h-8 w-8 overflow-hidden rounded-full border-2 ${avatar === id ? "border-rs-brand" : "border-transparent"}`}
              >
                <img src={avatarSrc(id)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-rs-border py-2 text-sm font-bold text-rs-text hover:bg-rs-bg"
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
