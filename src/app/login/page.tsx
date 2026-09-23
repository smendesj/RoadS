"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
      setError("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }

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
        <div className="flex items-center gap-2.5">
          <div className="h-3.5 w-3.5 rounded-[4px] bg-rs-brand" />
          <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-rs-text-soft">E-mail</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-rs-border bg-rs-bg px-3.5 py-2.5 text-sm text-rs-text"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-rs-text-soft">Senha</span>
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
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-[13px] text-rs-text-soft">
          Não tem conta?{" "}
          <Link href="/cadastro" className="font-bold text-rs-brand-text">
            Cadastrar
          </Link>
        </p>
      </div>
    </div>
  );
}
