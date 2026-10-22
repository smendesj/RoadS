"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { SessionGuard } from "@/components/SessionGuard";
import { UserMenu } from "@/components/UserMenu";
import { useTheme } from "@/lib/theme-provider";
import { AUTH, NAV } from "@/lib/text/account";
import { RESUMO_NAME } from "@/lib/text/resumo";
import type { Role } from "@/lib/types";
import { roleLabel } from "@/lib/viewer";

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

type Tab = "dashboard" | "roadmap" | "resumo" | "config";

// showConfig is only ever true for admin — the Config tab doesn't render for anyone else. The Resumo
// tab follows the role (admin and scrum master only). `role` is null for a visitor; what is shown is decided on the
// role itself, never on its on-screen label, so translating a label can't change who sees what. `actions` is a page's own
// button (the Roadmap's Sync), shown right before the theme toggle.
export function NavBar({
  active,
  role,
  avatar = null,
  showConfig = false,
  actions = null,
}: {
  active: Tab;
  role: Role | null;
  avatar?: string | null;
  showConfig?: boolean;
  actions?: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const showResumo = role === "admin" || role === "scrum_master";
  // Four tabs (admin) do not fit a 320px phone at the usual size: tighter below sm, and the bar scrolls
  // inside itself rather than ever widening the page.
  const crowded = showResumo && showConfig;

  // Below md the tabs share the bar's width, each label centered in its tab on one line.
  const tabClass = (tab: Tab) =>
    `flex flex-1 items-center justify-center whitespace-nowrap rounded-lg py-2 text-center font-bold md:flex-none md:px-4 ${
      crowded ? "px-1.5 text-xs sm:px-3 sm:text-sm" : "px-3 text-sm"
    } ${active === tab ? "bg-rs-brand text-white" : "text-rs-text-soft"}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-rs-border bg-rs-card px-4 py-3 sm:px-6 md:h-[72px] md:flex-nowrap md:py-0 lg:px-10">
      <BrandMark />

      <div
        className={`order-last flex w-full justify-center gap-1.5 rounded-[10px] bg-rs-bg p-1 md:order-none md:w-auto ${
          crowded ? "overflow-x-auto" : ""
        }`}
      >
        <Link href="/dashboard" className={tabClass("dashboard")}>
          Dashboard
        </Link>
        <Link href="/roadmap" className={tabClass("roadmap")}>
          Roadmap
        </Link>
        {showResumo && (
          <Link href="/resumo" className={tabClass("resumo")}>
            {RESUMO_NAME}
          </Link>
        )}
        {showConfig && (
          <Link href="/config" className={tabClass("config")}>
            Config
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3.5">
        {actions}
        <button
          onClick={toggle}
          aria-label={NAV.toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-rs-border bg-rs-card text-rs-text-soft"
        >
          <SunMoonIcon theme={theme} />
        </button>
        {role === null ? (
          <Link
            href="/login"
            className="rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white"
          >
            {AUTH.signIn}
          </Link>
        ) : (
          <>
            <SessionGuard />
            <UserMenu roleLabel={roleLabel(role)} avatar={avatar} />
          </>
        )}
      </div>
    </div>
  );
}
