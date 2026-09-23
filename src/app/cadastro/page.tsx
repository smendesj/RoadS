"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { emailDomainHint, isAllowedEmail, isValidPassword, PASSWORD_HINT } from "@/lib/validation";

export default function CadastroPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!isAllowedEmail(email)) {
      setError(`Use um e-mail ${emailDomainHint()}.`);
      return;
    }
    if (!isValidPassword(password)) {
      setError(PASSWORD_HINT);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message === "User already registered" ? "Esse e-mail já tem cadastro." : signUpError.message);
      return;
    }

    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // Email confirmation is on for this project — no session until the user clicks the link.
    setNotice("Cadastro criado. Confira seu e-mail para confirmar a conta antes de entrar.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rs-bg p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-rs-border bg-rs-card p-8">
        <div className="flex items-center gap-2.5">
          <div className="h-3.5 w-3.5 rounded-[4px] bg-rs-brand" />
          <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
        </div>

        {notice ? (
          <p className="text-sm text-rs-text">{notice}</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-rs-text-soft">E-mail</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`voce${emailDomainHint()}`}
                className="rounded-lg border border-rs-border bg-rs-bg px-3.5 py-2.5 text-sm text-rs-text"
              />
              <span className="text-xs text-rs-text-faint">Só e-mails {emailDomainHint()}.</span>
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
              <span className="text-xs text-rs-text-faint">{PASSWORD_HINT}</span>
            </label>

            {error && <p className="text-[13px] font-semibold text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-rs-brand py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {loading ? "Criando conta..." : "Cadastrar"}
            </button>
          </form>
        )}

        <p className="text-center text-[13px] text-rs-text-soft">
          Já tem conta?{" "}
          <Link href="/login" className="font-bold text-rs-brand-text">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
