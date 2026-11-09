import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { ControlS } from "@/components/ControlS";
import { vaultKey } from "@/lib/controls/vault";
import { getViewerOrReset, isControlsMember } from "@/lib/get-viewer";
import { CONTROLS } from "@/lib/text/controls";

export const metadata: Metadata = { title: CONTROLS.pageTitle };

// ControlS is limited to its two members (the e-mail allowlist, same boundary RLS enforces). Anyone else —
// signed in or not — is sent back to the Dashboard; the tab never shows for them anyway, and every server
// action re-checks membership on its own.
export default async function ControlsPage() {
  const viewer = await getViewerOrReset();
  if (!viewer) redirect("/login");
  const member = await isControlsMember();
  if (!member) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <NavBar active="controls" role={viewer.role} avatar={viewer.avatar} showConfig={viewer.role === "admin"} showControls />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:gap-8 lg:p-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">{CONTROLS.heading}</h1>
          <p className="text-[15px] text-rs-text-soft">{CONTROLS.subtitle}</p>
        </div>

        <ControlS initialVaultReady={vaultKey() !== null} />
      </div>
    </div>
  );
}
