import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { ConfigPanel } from "@/components/ConfigPanel";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "RoadS — Config" };

// Admin-only. Everyone else is sent back to the Dashboard (the tab never shows for them anyway);
// the server actions ConfigPanel calls re-check admin on their own.
export default async function ConfigPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <NavBar active="config" roleLabel="Admin" showConfig />

      <div className="flex flex-col gap-6 p-10">
        <h1 className="text-3xl font-extrabold text-rs-text">Config</h1>
        <ConfigPanel />
      </div>
    </div>
  );
}
