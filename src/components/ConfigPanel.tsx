"use client";

import { useEffect, useState, useTransition } from "react";
import type { AppUser } from "@/lib/types";
import { listUsersForConfig, resetUserPassword, setUserGithubLogin, updateUserRole } from "@/lib/actions/admin";
import { CONFIG, ROLE_LABEL } from "@/lib/text/account";
import { ACTION } from "@/lib/text/common";

const LOGIN_ERROR: Record<string, string> = {
  invalid_login: CONFIG.invalidLogin,
  login_taken: CONFIG.loginTaken,
  save_failed: CONFIG.notSaved,
};

// The GitHub login of a profile (issue #23): it ties the profile to Assignees and to comments on the issues. Saved
// when the field loses focus or on Enter; empty clears it.
function GithubLoginInput({ user, onSaved }: { user: AppUser; onSaved: () => void }) {
  const [value, setValue] = useState(user.githubLogin ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = () => {
    if (value.trim() === (user.githubLogin ?? "")) return;
    setSaving(true);
    setError(null);
    setUserGithubLogin(user.id, value)
      .then((r) => (r.ok ? onSaved() : setError(LOGIN_ERROR[r.error] ?? LOGIN_ERROR.save_failed)))
      .catch(() => setError(LOGIN_ERROR.save_failed))
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex flex-col gap-1">
      <input
        aria-label={CONFIG.githubLoginOf(user.name)}
        value={value}
        disabled={saving}
        placeholder={CONFIG.loginPlaceholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-36 rounded-lg border border-rs-border bg-rs-bg px-2 py-1.5 text-xs text-rs-text"
      />
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

export function ConfigPanel() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload() {
    listUsersForConfig()
      .then(setUsers)
      .catch((e) => setLoadError(e instanceof Error ? e.message : CONFIG.loadFailed));
  }

  useEffect(reload, []);

  if (loadError === "not_authenticated") {
    return <p className="text-sm text-rs-text-soft">{CONFIG.signInToSee}</p>;
  }
  if (loadError === "not_admin") {
    return <p className="text-sm text-rs-text-soft">{CONFIG.adminOnly}</p>;
  }
  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!users) return <p className="text-sm text-rs-text-soft">{CONFIG.loading}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xl font-extrabold text-rs-text">{CONFIG.users}</span>
        <span className="text-[13px] text-rs-text-soft">
          {CONFIG.resetExplained}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-rs-border bg-rs-card">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-rs-border text-[11px] font-bold uppercase tracking-wide text-rs-text-faint">
              <th className="px-5 py-3">{CONFIG.nameEmail}</th>
              <th className="px-5 py-3">{CONFIG.role}</th>
              <th className="px-5 py-3">{CONFIG.github}</th>
              <th className="px-5 py-3">{CONFIG.password}</th>
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
                    <span className="rounded-md bg-rs-lane px-2 py-0.5 text-xs font-bold text-rs-text">{ROLE_LABEL.admin}</span>
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
                <td className="px-5 py-3.5">
                  <GithubLoginInput user={u} onSaved={reload} />
                </td>
                <td className="px-5 py-3.5 text-rs-text-soft">
                  {u.mustResetPassword ? (
                    <span className="font-semibold text-orange-600 dark:text-orange-400">
                      {CONFIG.needsNewPassword}
                    </span>
                  ) : (
                    CONFIG.passwordOk
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    onClick={() => setResetId(u.id)}
                    className="rounded-lg border border-rs-border px-3 py-1.5 text-xs font-bold text-rs-text-soft"
                  >
                    {CONFIG.resetPassword}
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
              {CONFIG.resetQuestionBefore}
              <b>{users.find((u) => u.id === resetId)?.name}</b>
              {CONFIG.resetQuestionAfter}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetId(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-rs-text-soft">
                {ACTION.cancel}
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  const user = users.find((u) => u.id === resetId);
                  if (!user) return;
                  startTransition(async () => {
                    const result = await resetUserPassword(user.id);
                    setResetId(null);
                    setResetSentTo(result.ok ? result.email : null);
                    setResetError(result.ok ? null : result.error);
                    reload();
                  });
                }}
                className="rounded-lg bg-rs-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                {CONFIG.confirmReset}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetError && (
        <p className="text-[13px] font-semibold text-red-600 dark:text-red-400">
          {resetError}{" "}
          <button onClick={() => setResetError(null)} className="font-bold text-rs-brand-text">
            {CONFIG.dismiss}
          </button>
        </p>
      )}

      {resetSentTo && (
        <p className="text-[13px] text-rs-text-soft">
          {CONFIG.resetSentBefore}
          <b>{resetSentTo}</b>.{" "}
          <button onClick={() => setResetSentTo(null)} className="font-bold text-rs-brand-text">
            {CONFIG.dismiss}
          </button>
        </p>
      )}
    </div>
  );
}
