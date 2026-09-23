"use client";

import Link from "next/link";
import { useTheme } from "@/lib/theme-provider";

function SunMoonIcon({ theme }: { theme: "light" | "dark" }) {
  const d =
    theme === "dark"
      ? "M12 3v1M12 20v1M4.2 4.2l.7.7M18.4 18.4l.7.7M3 12h1M20 12h1M4.2 19.8l.7-.7M18.4 5.6l.7-.7M12 7a5 5 0 100 10 5 5 0 000-10z"
      : "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function NavBar({ active, roleLabel }: { active: "dashboard" | "roadmap"; roleLabel: string }) {
  const { theme, toggle } = useTheme();

  const tabClass = (tab: "dashboard" | "roadmap") =>
    `rounded-lg px-4 py-2 text-sm font-bold ${
      active === tab ? "bg-rs-brand text-white" : "text-rs-text-soft"
    }`;

  return (
    <div className="flex h-[72px] items-center justify-between border-b border-rs-border bg-rs-card px-10">
      <div className="flex items-center gap-2.5">
        <div className="h-3.5 w-3.5 rounded-[4px] bg-rs-brand" />
        <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
      </div>

      <div className="flex gap-1.5 rounded-[10px] bg-rs-bg p-1">
        <Link href="/dashboard" className={tabClass("dashboard")}>
          Dashboard
        </Link>
        <Link href="/roadmap" className={tabClass("roadmap")}>
          Roadmap
        </Link>
      </div>

      <div className="flex items-center gap-3.5">
        <button
          onClick={toggle}
          aria-label="Alternar tema"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-rs-border bg-rs-card text-rs-text-soft"
        >
          <SunMoonIcon theme={theme} />
        </button>
        {roleLabel === "Visitante" ? (
          <Link
            href="/login"
            className="rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white"
          >
            Entrar
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rs-brand-soft text-rs-text-soft">
              <UserIcon />
            </div>
            <span className="text-sm font-bold text-rs-text">{roleLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
