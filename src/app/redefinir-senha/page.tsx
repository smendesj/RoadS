"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isValidPassword, PASSWORD_HINT } from "@/lib/validation";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidPassword(password)) {
      setError(PASSWORD_HINT);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data: userData } = await supabase.auth.getUser();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    if (userData.user) {
      await supabase.from("profiles").update({ must_reset_password: false }).eq("id", userData.user.id);
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rs-bg p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-rs-border bg-rs-card p-8">
        <div className="flex items-center gap-2.5">
          <div className="h-3.5 w-3.5 rounded-[4px] bg-rs-brand" />
          <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
        </div>

        <p className="text-sm text-rs-text">
          Sua senha foi resetada por um admin. Crie uma senha nova para continuar.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-rs-text-soft">Nova senha</span>
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
            {loading ? "Salvando..." : "Salvar e continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
