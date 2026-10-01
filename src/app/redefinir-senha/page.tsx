"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionGuard } from "@/components/SessionGuard";
import { completePasswordReset } from "@/lib/actions/account";
import { createClient } from "@/lib/supabase/client";
import { useLogout } from "@/lib/use-logout";
import { isValidPassword, PASSWORD_HINT } from "@/lib/validation";

const LINK_ERROR = "Esse link expirou ou já foi usado. Peça um novo ao admin.";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const logout = useLogout();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Settles once a recovery link's tokens (when the page was opened from one) have become a session.
  const linkSession = useRef<Promise<boolean>>(Promise.resolve(true));

  // A recovery link carries its tokens in the URL fragment, so it works in whichever browser the person
  // opens it. Turn them into a session, then take them out of the address bar and the history.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return;
    linkSession.current = createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        window.history.replaceState(null, "", window.location.pathname);
        if (sessionError) setError(LINK_ERROR);
        return !sessionError;
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidPassword(password)) {
      setError(PASSWORD_HINT);
      return;
    }

    setLoading(true);
    if (!(await linkSession.current)) {
      setError(LINK_ERROR);
      setLoading(false);
      return;
    }

    // The server checks the password again, sets it and clears the "must reset" flag; this page can't.
    const result = await completePasswordReset(password);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-rs-bg p-6">
      <SessionGuard />
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

        <button type="button" onClick={logout} className="text-center text-[13px] font-bold text-rs-brand-text">
          Sair
        </button>
      </div>
    </div>
  );
}
