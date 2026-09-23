"use client";

import { useEffect, useState, useTransition } from "react";
import type { AppUser, Role } from "@/lib/types";
import { listUsersForConfig, resetUserPassword, updateUserRole } from "@/lib/actions/admin";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  scrum_master: "Scrum Master",
  dev: "Dev",
};

export function ConfigPanel() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload() {
    listUsersForConfig()
      .then(setUsers)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Erro ao carregar usuários."));
  }

  useEffect(reload, []);

  if (loadError === "not_authenticated") {
    return <p className="text-sm text-rs-text-soft">Faça login para ver esta página.</p>;
  }
  if (loadError === "not_admin") {
    return <p className="text-sm text-rs-text-soft">Só admin acessa Config.</p>;
  }
  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!users) return <p className="text-sm text-rs-text-soft">Carregando...</p>;

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
              <th className="px-5 py-3">Nome / e-mail</th>
              <th className="px-5 py-3">Papel</th>
              <th className="px-5 py-3">Senha</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-rs-border last:border-0">
                <td className="px-5 py-3.5">
                  <div className="font-semibold text-rs-text">{u.name}</div>
                  <div className="text-xs text-rs-text-faint">{u.email}</div>
                </td>
                <td className="px-5 py-3.5">
                  {u.role === "admin" ? (
                    <span className="rounded-md bg-rs-lane px-2 py-0.5 text-xs font-bold text-rs-text">Admin</span>
                  ) : (
                    <select
                      defaultValue={u.role}
                      disabled={isPending}
                      onChange={(e) => {
                        const role = e.target.value as "dev" | "scrum_master";
                        startTransition(async () => {
                          await updateUserRole(u.id, role);
                          reload();
                        });
                      }}
                      className="rounded-lg border border-rs-border bg-rs-bg px-2 py-1.5 text-xs font-bold text-rs-text"
                    >
                      <option value="dev">{ROLE_LABEL.dev}</option>
                      <option value="scrum_master">{ROLE_LABEL.scrum_master}</option>
                    </select>
                  )}
                </td>
                <td className="px-5 py-3.5 text-rs-text-soft">
                  {u.mustResetPassword ? (
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
              Resetar a senha de <b>{users.find((u) => u.id === resetId)?.name}</b>? A senha atual
              para de funcionar e a pessoa recebe um e-mail para criar uma nova.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetId(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-rs-text-soft">
                Cancelar
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  const user = users.find((u) => u.id === resetId);
                  if (!user) return;
                  startTransition(async () => {
                    await resetUserPassword(user.id, user.email);
                    setResetSentTo(user.email);
                    setResetId(null);
                    reload();
                  });
                }}
                className="rounded-lg bg-rs-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                Confirmar reset
              </button>
            </div>
          </div>
        </div>
      )}

      {resetSentTo && (
        <p className="text-[13px] text-rs-text-soft">
          E-mail de redefinição enviado para <b>{resetSentTo}</b>.{" "}
          <button onClick={() => setResetSentTo(null)} className="font-bold text-rs-brand-text">
            Ok
          </button>
        </p>
      )}
    </div>
  );
}
