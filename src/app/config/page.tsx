import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { ConfigPanel } from "@/components/ConfigPanel";
import { getViewer } from "@/lib/get-viewer";

export const metadata: Metadata = { title: "RoadS — Config" };

// Admin-only. Everyone else is sent back to the Dashboard (the tab never shows for them anyway);
// the server actions ConfigPanel calls re-check admin on their own.
export default async function ConfigPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <NavBar active="config" roleLabel="Admin" avatar={viewer.avatar} showConfig />

      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <h1 className="text-2xl font-extrabold text-rs-text sm:text-3xl">Config</h1>
        <ConfigPanel />
      </div>
    </div>
  );
}
