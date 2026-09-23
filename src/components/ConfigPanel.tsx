"use client";

import { useState } from "react";
import type { AppUser } from "@/lib/types";

const ROLE_LABEL: Record<AppUser["role"], string> = {
  admin: "Admin",
  scrum_master: "SCRUM MASTER",
  dev: "Dev",
};

export function ConfigPanel({ users }: { users: AppUser[] }) {
  const [resetId, setResetId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xl font-extrabold text-rs-text">Usuários</span>
        <span className="text-[13px] text-rs-text-soft">
          Resetar obriga a pessoa a criar uma senha nova no próximo login.
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-rs-border bg-rs-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-rs-border text-[11px] font-bold uppercase tracking-wide text-rs-text-faint">
              <th className="px-5 py-3">Nome</th>
              <th className="px-5 py-3">E-mail</th>
              <th className="px-5 py-3">Cargo</th>
              <th className="px-5 py-3">Papel</th>
              <th className="px-5 py-3">Senha</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-rs-border last:border-0">
                <td className="px-5 py-3.5 font-semibold text-rs-text">{u.name}</td>
                <td className="px-5 py-3.5 text-rs-text-soft">{u.email}</td>
                <td className="px-5 py-3.5 text-rs-text-soft">{u.title}</td>
                <td className="px-5 py-3.5">
                  <span className="rounded-md bg-rs-lane px-2 py-0.5 text-xs font-bold text-rs-text">
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-rs-text-soft">
                  {flagged.has(u.id) ? (
                    <span className="font-semibold text-orange-600 dark:text-orange-400">
                      Precisa criar nova senha
                    </span>
                  ) : (
                    "OK"
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    onClick={() => setResetId(u.id)}
                    className="rounded-lg border border-rs-border px-3 py-1.5 text-xs font-bold text-rs-text-soft"
                  >
                    Resetar senha
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-rs-border bg-rs-card p-6">
            <p className="text-sm text-rs-text">
              Resetar a senha de <b>{users.find((u) => u.id === resetId)?.name}</b>? A pessoa vai
              precisar criar uma senha nova no próximo login.
            </p>
            <p className="rounded-lg bg-rs-lane p-2.5 text-xs text-rs-text-faint">
              Protótipo: isso ainda só marca o status na tela. A chamada real (Supabase Admin API)
              precisa da service_role key, que ainda não tenho.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetId(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-rs-text-soft">
                Cancelar
              </button>
              <button
                onClick={() => {
                  setFlagged((prev) => new Set(prev).add(resetId));
                  setResetId(null);
                }}
                className="rounded-lg bg-rs-brand px-3 py-2 text-xs font-bold text-white"
              >
                Confirmar reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
