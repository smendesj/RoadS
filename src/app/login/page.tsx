"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { useRouter } from "next/navigation";
import { touchActivity } from "@/lib/idle-storage";
import { createClient } from "@/lib/supabase/client";
import { AUTH } from "@/lib/text/account";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setError(AUTH.wrongCredentials);
      setLoading(false);
      return;
    }

    touchActivity();

    const { data: profile } = await supabase
      .from("profiles")
      .select("must_reset_password")
      .eq("id", data.user.id)
      .single();

    router.push(profile?.must_reset_password ? "/redefinir-senha" : "/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rs-bg p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-rs-border bg-rs-card p-8">
        <BrandMark />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-rs-text-soft">{AUTH.email}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-rs-border bg-rs-bg px-3.5 py-2.5 text-sm text-rs-text"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-rs-text-soft">{AUTH.password}</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-rs-border bg-rs-bg px-3.5 py-2.5 text-sm text-rs-text"
            />
          </label>

          {error && <p className="text-[13px] font-semibold text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-rs-brand py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? AUTH.signingIn : AUTH.signIn}
          </button>
        </form>

        <p className="text-center text-[13px] text-rs-text-soft">
          {AUTH.noAccount}{" "}
          <Link href="/cadastro" className="font-bold text-rs-brand-text">
            {AUTH.signUp}
          </Link>
        </p>
      </div>
    </div>
  );
}
