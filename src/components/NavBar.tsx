"use client";

import Link from "next/link";
import { SessionGuard } from "@/components/SessionGuard";
import { UserMenu } from "@/components/UserMenu";
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

type Tab = "dashboard" | "roadmap" | "config";

// showConfig is only ever true for admin — the Config tab doesn't render for anyone else.
export function NavBar({
  active,
  roleLabel,
  avatar = null,
  showConfig = false,
}: {
  active: Tab;
  roleLabel: string;
  avatar?: string | null;
  showConfig?: boolean;
}) {
  const { theme, toggle } = useTheme();

  const tabClass = (tab: Tab) =>
    `flex-1 rounded-lg px-3 py-2 text-center text-sm font-bold md:flex-none md:px-4 ${
      active === tab ? "bg-rs-brand text-white" : "text-rs-text-soft"
    }`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-rs-border bg-rs-card px-4 py-3 sm:px-6 md:h-[72px] md:flex-nowrap md:py-0 lg:px-10">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-[42px] w-[42px] shrink-0 items-center justify-center">
          <div className="absolute h-[30px] w-[30px] rotate-[45deg] rounded-[9px] bg-linear-to-br from-rs-brand to-rs-brand-text" />
          <svg width="27" height="21" viewBox="0 0 20 16" fill="none" className="relative">
            <path d="M1 2 L8 8 L1 14" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M10 2 L17 8 L10 14" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
      </div>

      <div className="order-last flex w-full gap-1.5 rounded-[10px] bg-rs-bg p-1 md:order-none md:w-auto">
        <Link href="/dashboard" className={tabClass("dashboard")}>
          Dashboard
        </Link>
        <Link href="/roadmap" className={tabClass("roadmap")}>
          Roadmap
        </Link>
        {showConfig && (
          <Link href="/config" className={tabClass("config")}>
            Config
          </Link>
        )}
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
          <>
            <SessionGuard />
            <UserMenu roleLabel={roleLabel} avatar={avatar} />
          </>
        )}
      </div>
    </div>
  );
}
