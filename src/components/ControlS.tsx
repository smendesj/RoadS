"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  revealSubscriptionSecret,
  updateSubscription,
} from "@/lib/actions/subscriptions";
import {
  BILLING_CYCLES,
  SUB_STATUSES,
  biggestSpend,
  byCategory,
  byService,
  formatMoney,
  totals,
  upcomingRenewals,
  type Subscription,
  type SubscriptionInput,
} from "@/lib/controls/subscription";
import { CategoryDonut, ServiceBars } from "@/components/ControlsCharts";
import { ACTION } from "@/lib/text/common";
import { CONTROLS, CYCLE_LABEL, STATUS_LABEL } from "@/lib/text/controls";

const SAVE_ERROR: Record<string, string> = {
  name_required: CONTROLS.nameRequired,
  vault_locked: CONTROLS.vaultLocked,
};

// Midnight today in the viewer's own day, as a UTC instant, so renewal maths lines up with stored dates.
function useToday() {
  return useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);
}

function Card({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-2xl border p-4 sm:p-5 ${accent ? "border-rs-brand/40 bg-rs-brand-soft" : "border-rs-border bg-rs-card"}`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-rs-text-faint">{label}</span>
      <span className={`text-2xl font-extrabold ${accent ? "text-rs-brand-text" : "text-rs-text"}`}>{value}</span>
      {hint && <span className="text-xs text-rs-text-faint">{hint}</span>}
    </div>
  );
}

function StatusPill({ status }: { status: Subscription["status"] }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : status === "to_register"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-rs-lane text-rs-text-soft";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${tone}`}>{STATUS_LABEL[status]}</span>;
}

const panel = "flex flex-col gap-4 rounded-2xl border border-rs-border bg-rs-card p-4 sm:p-6";
const field = "rounded-lg border border-rs-border bg-rs-bg px-3 py-2 text-sm text-rs-text";
const label = "flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-rs-text-faint";

// The vault cell: a password stays masked until the member reveals it, fetched on demand by its own action.
function VaultCell({ sub, vaultReady }: { sub: Subscription; vaultReady: boolean }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, startLoading] = useTransition();

  if (!sub.hasSecret) return <span className="text-xs text-rs-text-faint">{CONTROLS.noPassword}</span>;

  const reveal = () => {
    setError(null);
    startLoading(async () => {
      const r = await revealSubscriptionSecret(sub.id);
      if (r.ok) setRevealed(r.secret ?? "");
      else setError(r.error === "vault_locked" ? CONTROLS.vaultLocked : CONTROLS.revealFailed);
    });
  };
  const copy = () => {
    if (revealed == null) return;
    navigator.clipboard?.writeText(revealed).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };

  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-rs-lane px-2 py-1 font-mono text-xs text-rs-text">
        {revealed == null ? CONTROLS.vaultHidden : revealed || CONTROLS.none}
      </code>
      {revealed == null ? (
        <button onClick={reveal} disabled={loading || !vaultReady} className="text-xs font-bold text-rs-brand-text disabled:opacity-50">
          {CONTROLS.reveal}
        </button>
      ) : (
        <>
          <button onClick={() => setRevealed(null)} className="text-xs font-bold text-rs-text-soft">
            {CONTROLS.hide}
          </button>
          <button onClick={copy} className="text-xs font-bold text-rs-brand-text">
            {copied ? CONTROLS.copied : CONTROLS.copy}
          </button>
        </>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

type FormState = SubscriptionInput & { secretInput: string; clearSecret: boolean };

function emptyForm(): FormState {
  return {
    name: "",
    category: "",
    accessUrl: "",
    loginIdentifier: "",
    loginEmail: "",
    amount: null,
    currency: "BRL",
    billingCycle: "monthly",
    billingDay: null,
    nextChargeDate: "",
    status: "active",
    notes: "",
    secretInput: "",
    clearSecret: false,
  };
}

function formFrom(sub: Subscription): FormState {
  return {
    name: sub.name,
    category: sub.category ?? "",
    accessUrl: sub.accessUrl ?? "",
    loginIdentifier: sub.loginIdentifier ?? "",
    loginEmail: sub.loginEmail ?? "",
    amount: sub.amount,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    billingDay: sub.billingDay,
    nextChargeDate: sub.nextChargeDate ?? "",
    status: sub.status,
    notes: sub.notes ?? "",
    secretInput: "",
    clearSecret: false,
  };
}

function SubscriptionForm({
  initial,
  editing,
  vaultReady,
  onCancel,
  onSaved,
}: {
  initial: FormState;
  editing: Subscription | null;
  vaultReady: boolean;
  onCancel: () => void;
  onSaved: (sub: Subscription) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    if (!form.name.trim()) {
      setError(CONTROLS.nameRequired);
      return;
    }
    setError(null);
    const input: SubscriptionInput = {
      name: form.name,
      category: form.category,
      accessUrl: form.accessUrl,
      loginIdentifier: form.loginIdentifier,
      loginEmail: form.loginEmail,
      amount: form.amount,
      currency: form.currency,
      billingCycle: form.billingCycle,
      billingDay: form.billingDay,
      nextChargeDate: form.nextChargeDate,
      status: form.status,
      notes: form.notes,
    };
    const typed = form.secretInput.trim() ? form.secretInput : null;

    startSaving(async () => {
      // Vault intent: a typed value sets it; on an edit, "clear" empties it, otherwise the stored one is kept.
      const r = editing
        ? await updateSubscription(editing.id, input, typed ?? (form.clearSecret ? null : undefined))
        : await createSubscription(input, typed);
      if (r.ok) onSaved(r.subscription);
      else setError(SAVE_ERROR[r.error] ?? CONTROLS.saveFailed);
    });
  };

  const numberOrNull = (value: string) => {
    const n = Number(value.replace(",", "."));
    return value.trim() === "" || Number.isNaN(n) ? null : n;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-rs-border bg-rs-card p-5 sm:p-7">
        <h2 className="text-lg font-extrabold text-rs-text">{editing ? CONTROLS.editSubscription : CONTROLS.newSubscription}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>
            {CONTROLS.name}
            <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </label>
          <label className={label}>
            {CONTROLS.category}
            <input className={field} value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} />
          </label>
          <label className={label}>
            {CONTROLS.status}
            <select className={field} value={form.status} onChange={(e) => set("status", e.target.value as FormState["status"])}>
              {SUB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            {CONTROLS.accessUrl}
            <input className={field} value={form.accessUrl ?? ""} onChange={(e) => set("accessUrl", e.target.value)} placeholder="https://" />
          </label>
          <label className={label}>
            {CONTROLS.loginIdentifier}
            <input className={field} value={form.loginIdentifier ?? ""} onChange={(e) => set("loginIdentifier", e.target.value)} />
          </label>
          <label className={label}>
            {CONTROLS.loginEmail}
            <input className={field} value={form.loginEmail ?? ""} onChange={(e) => set("loginEmail", e.target.value)} />
          </label>
          <label className={label}>
            {CONTROLS.amount}
            <input
              className={field}
              inputMode="decimal"
              defaultValue={form.amount ?? ""}
              onChange={(e) => set("amount", numberOrNull(e.target.value))}
              placeholder={CONTROLS.none}
            />
          </label>
          <label className={label}>
            {CONTROLS.currency}
            <select className={field} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {["BRL", "USD", "EUR"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {CONTROLS.billingCycle}
            <select className={field} value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value as FormState["billingCycle"])}>
              {BILLING_CYCLES.map((c) => (
                <option key={c} value={c}>
                  {CYCLE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {CONTROLS.billingDay}
            <input
              className={field}
              inputMode="numeric"
              defaultValue={form.billingDay ?? ""}
              onChange={(e) => {
                const n = numberOrNull(e.target.value);
                set("billingDay", n == null ? null : Math.round(n));
              }}
              placeholder="1–31"
            />
          </label>
          <label className={label}>
            {CONTROLS.nextChargeDate}
            <input className={field} type="date" value={form.nextChargeDate ?? ""} onChange={(e) => set("nextChargeDate", e.target.value)} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            {CONTROLS.notes}
            <textarea className={`${field} min-h-[64px]`} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </label>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={label}>{CONTROLS.password}</span>
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              value={form.secretInput}
              onChange={(e) => set("secretInput", e.target.value)}
              placeholder={editing ? (editing.hasSecret ? CONTROLS.keepPassword : CONTROLS.setPassword) : CONTROLS.setPassword}
              disabled={!vaultReady}
            />
            {!vaultReady && <span className="text-xs text-amber-600 dark:text-amber-400">{CONTROLS.vaultLocked}</span>}
            {editing && editing.hasSecret && vaultReady && (
              <label className="flex items-center gap-2 text-xs font-semibold text-rs-text-soft">
                <input type="checkbox" checked={form.clearSecret} onChange={(e) => set("clearSecret", e.target.checked)} />
                {CONTROLS.clearPassword}
              </label>
            )}
          </div>
        </div>

        {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-bold text-rs-text-soft">
            {ACTION.cancel}
          </button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {saving ? ACTION.saving : ACTION.save}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ControlS({ initialVaultReady }: { initialVaultReady: boolean }) {
  const today = useToday();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [vaultReady, setVaultReady] = useState(initialVaultReady);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<{ editing: Subscription | null } | null>(null);
  const [deleting, setDeleting] = useState<Subscription | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload() {
    listSubscriptions()
      .then((r) => {
        setSubs(r.subscriptions);
        setVaultReady(r.vaultReady);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : CONTROLS.loadFailed));
  }

  useEffect(reload, []);

  const model = useMemo(() => {
    if (!subs) return null;
    const renewals = upcomingRenewals(subs, today);
    return {
      t: totals(subs),
      categories: byCategory(subs),
      services: byService(subs),
      biggest: biggestSpend(subs),
      renewals,
      renewalDays: new Map(renewals.map((r) => [r.id, r.daysUntil])),
    };
  }, [subs, today]);

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{CONTROLS.loadFailed}</p>;
  if (!subs || !model) return <p className="text-sm text-rs-text-soft">{CONTROLS.loading}</p>;

  const currency = subs.find((s) => s.amount != null)?.currency ?? "BRL";

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label={CONTROLS.monthlyTotal} value={formatMoney(model.t.monthly, currency)} hint={CONTROLS.monthlyTotalHint} accent />
        <Card label={CONTROLS.annualTotal} value={formatMoney(model.t.annual, currency)} hint={CONTROLS.annualTotalHint} />
        <Card label={CONTROLS.activeCount} value={String(model.t.activeCount)} hint={CONTROLS.oneOffTotal + ": " + formatMoney(model.t.oneOffTotal, currency)} />
        {model.biggest ? (
          <button
            onClick={() => {
              const sub = subs.find((s) => s.id === model.biggest!.id);
              if (sub?.accessUrl) window.open(sub.accessUrl, "_blank", "noopener,noreferrer");
            }}
            className="text-left"
          >
            <Card label={CONTROLS.biggestSpend} value={model.biggest.name} hint={formatMoney(model.biggest.monthly, currency)} />
          </button>
        ) : (
          <Card label={CONTROLS.biggestSpend} value={CONTROLS.none} hint={CONTROLS.noPricedSub} />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={panel}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-rs-text-soft">{CONTROLS.byCategory}</h2>
          <CategoryDonut slices={model.categories} currency={currency} />
        </section>
        <section className={panel}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-rs-text-soft">{CONTROLS.byService}</h2>
          <ServiceBars bars={model.services} currency={currency} />
        </section>
      </div>

      {/* Upcoming renewals */}
      <section className={panel}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-rs-text-soft">{CONTROLS.upcomingRenewals}</h2>
        {model.renewals.length === 0 ? (
          <p className="text-sm text-rs-text-faint">{CONTROLS.noRenewals}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {model.renewals.map((r) => {
              const sub = subs.find((s) => s.id === r.id);
              const inner = (
                <span className="flex items-center gap-2 rounded-xl border border-rs-brand/40 bg-rs-brand-soft px-3 py-2 text-sm">
                  <span className="font-bold text-rs-brand-text">{r.name}</span>
                  <span className="text-xs font-semibold text-rs-text-soft">
                    {r.daysUntil === 0 ? CONTROLS.dueToday : CONTROLS.dueInDays(r.daysUntil)} · {r.date}
                  </span>
                </span>
              );
              return sub?.accessUrl ? (
                <a key={r.id} href={sub.accessUrl} target="_blank" rel="noopener noreferrer">
                  {inner}
                </a>
              ) : (
                <span key={r.id}>{inner}</span>
              );
            })}
          </ul>
        )}
      </section>

      {/* List */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-rs-text">{CONTROLS.subscriptions}</h2>
          <button onClick={() => setFormOpen({ editing: null })} className="rounded-lg bg-rs-brand px-4 py-2 text-sm font-bold text-white">
            {CONTROLS.add}
          </button>
        </div>

        {subs.length === 0 ? (
          <p className="text-sm text-rs-text-soft">{CONTROLS.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-rs-border bg-rs-card">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-rs-border text-[11px] font-bold uppercase tracking-wide text-rs-text-faint">
                  <th className="px-4 py-3">{CONTROLS.name}</th>
                  <th className="px-4 py-3">{CONTROLS.category}</th>
                  <th className="px-4 py-3">{CONTROLS.amount}</th>
                  <th className="px-4 py-3">{CONTROLS.billingCycle}</th>
                  <th className="px-4 py-3">{CONTROLS.nextChargeDate}</th>
                  <th className="px-4 py-3">{CONTROLS.status}</th>
                  <th className="px-4 py-3">{CONTROLS.loginIdentifier}</th>
                  <th className="px-4 py-3">{CONTROLS.password}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const days = model.renewalDays.get(s.id);
                  return (
                    <tr key={s.id} className={`border-b border-rs-border last:border-0 ${days != null ? "bg-rs-brand-soft/50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {s.accessUrl ? (
                            <a href={s.accessUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-rs-text hover:text-rs-brand-text">
                              {s.name}
                            </a>
                          ) : (
                            <span className="font-semibold text-rs-text">{s.name}</span>
                          )}
                          {days != null && (
                            <span className="rounded-md bg-rs-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                              {days === 0 ? CONTROLS.dueToday : CONTROLS.dueInDays(days)}
                            </span>
                          )}
                        </div>
                        {s.notes && <div className="mt-0.5 max-w-xs truncate text-xs text-rs-text-faint">{s.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-rs-text-soft">{s.category ?? CONTROLS.none}</td>
                      <td className="px-4 py-3 font-semibold text-rs-text">{s.amount == null ? CONTROLS.none : formatMoney(s.amount, s.currency)}</td>
                      <td className="px-4 py-3 text-rs-text-soft">{CYCLE_LABEL[s.billingCycle]}</td>
                      <td className="px-4 py-3 text-rs-text-soft">{s.nextChargeDate ?? (s.billingDay != null ? `Day ${s.billingDay}` : CONTROLS.none)}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-rs-text-soft">
                        <div className="max-w-[160px] truncate">{s.loginIdentifier ?? s.loginEmail ?? CONTROLS.none}</div>
                      </td>
                      <td className="px-4 py-3">
                        <VaultCell sub={s} vaultReady={vaultReady} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setFormOpen({ editing: s })} className="rounded-lg border border-rs-border px-2.5 py-1.5 text-xs font-bold text-rs-text-soft">
                            {ACTION.edit}
                          </button>
                          <button onClick={() => setDeleting(s)} className="rounded-lg border border-rs-border px-2.5 py-1.5 text-xs font-bold text-red-600 dark:text-red-400">
                            {ACTION.delete}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen && (
        <SubscriptionForm
          initial={formOpen.editing ? formFrom(formOpen.editing) : emptyForm()}
          editing={formOpen.editing}
          vaultReady={vaultReady}
          onCancel={() => setFormOpen(null)}
          onSaved={() => {
            setFormOpen(null);
            reload();
          }}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-rs-border bg-rs-card p-6">
            <p className="text-sm text-rs-text">
              {CONTROLS.confirmDeleteBefore}
              <b>{deleting.name}</b>
              {CONTROLS.confirmDeleteAfter}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-rs-text-soft">
                {ACTION.cancel}
              </button>
              <button
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteSubscription(deleting.id);
                    setDeleting(null);
                    reload();
                  })
                }
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                {ACTION.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
